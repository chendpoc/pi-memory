import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  createOllamaLLMClient,
  createOllamaMemoryHelper,
  ollamaHealthCheck,
  type OllamaConfig,
} from "./adapters/ollamaClient.js";
import {
  createOpenAICompatLLMClient,
  createOpenAICompatMemoryHelper,
  openaiCompatHealthCheck,
  type OpenAICompatConfig,
} from "./adapters/openaiCompatClient.js";
import {
  createPiLLMClient,
  DEFAULT_HELPER_MODEL,
  DEFAULT_HELPER_PROVIDER,
  resolveMemoryHelperLLM,
} from "./adapters/piComplete.js";
import type { MemoryConfig } from "./config.js";
import {
  loadMemorySettings,
  resolveHelperModelSpec,
} from "./settings.js";
import { createFallbackQuery } from "./fallback/index.js";
import type { RerankOptions } from "./fallback/llmRerank.js";
import type { MemoryHelperLLM } from "./preflight/detectIntents.js";
import { runMemoryPreflight } from "./preflight/hook.js";
import { injectPrivateMemoryContext } from "./preflight/strip.js";
import { MemoryService } from "./service.js";
import type { LLMClient } from "./trainer/llmExtractor.js";
import {
  createMemoryAppendTool,
  MEMORY_APPEND_DESCRIPTION,
  MEMORY_APPEND_NAME,
  MEMORY_APPEND_PROMPT_GUIDELINES,
  MEMORY_APPEND_PROMPT_SNIPPET,
} from "./tools/memoryAppend.js";
import {
  createMemoryRecallTool,
  MEMORY_RECALL_DESCRIPTION,
  MEMORY_RECALL_NAME,
  MEMORY_RECALL_PROMPT_GUIDELINES,
  MEMORY_RECALL_PROMPT_SNIPPET,
} from "./tools/memoryRecall.js";

const MemoryRecallParams = Type.Object({
  mode: Type.Optional(
    StringEnum(["direct_relation", "path_query", "typed_neighborhood"] as const),
  ),
  anchor_mentions: Type.Array(Type.String()),
  relation_constraints: Type.Optional(Type.Array(Type.String())),
  candidate_type: Type.Optional(Type.String()),
  scope_filter: Type.Optional(Type.Array(Type.String())),
  target_slot: Type.Optional(StringEnum(["head", "tail"] as const)),
  time_window: Type.Optional(Type.String()),
  evidence_budget: Type.Optional(Type.Number()),
  result_limit: Type.Optional(Type.Number()),
});

const MemoryAppendParams = Type.Object({
  content: Type.String({ description: "New entries to append (markdown bullet points)." }),
});

const RECALL_MAX_LINES = 200;
const RECALL_MAX_BYTES = 32_000;

let sharedService: MemoryService | null = null;
let sessionCfg: MemoryConfig | null = null;
let settingsHelperModel: string | undefined;
let settingsOllama: OllamaConfig | null = null;
let settingsVllm: OpenAICompatConfig | null = null;
let sharedHelper: MemoryHelperLLM | null = null;
let sharedLLMClient: LLMClient | null = null;
let preflightCache: { userText: string; privateContext: string } | null = null;

export function getSharedMemoryService(): MemoryService | null {
  return sharedService;
}

function getHelperModelSpec(pi: ExtensionAPI): string | undefined {
  return resolveHelperModelSpec(pi.getFlag("memory-helper-model"), settingsHelperModel);
}

function isOllamaModel(spec: string | undefined): boolean {
  return !!spec?.startsWith("ollama/");
}

async function refreshMemoryHelper(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
  const helperModel = getHelperModelSpec(pi);

  if (settingsVllm) {
    const vllmOk = await openaiCompatHealthCheck(settingsVllm.baseUrl);
    if (vllmOk) {
      sharedHelper = createOpenAICompatMemoryHelper(settingsVllm);
      sharedLLMClient = createOpenAICompatLLMClient(settingsVllm);
      return;
    }
  }

  if ((isOllamaModel(helperModel) || settingsOllama) && settingsOllama) {
    const ollamaOk = await ollamaHealthCheck(settingsOllama.baseUrl);
    if (ollamaOk) {
      sharedHelper = createOllamaMemoryHelper(settingsOllama);
      sharedLLMClient = createOllamaLLMClient(settingsOllama);
      return;
    }
  }

  sharedHelper = await resolveMemoryHelperLLM(ctx, helperModel);
  sharedLLMClient = createPiLLMClient(ctx, helperModel);
}

function getRerankOpts(): RerankOptions | null {
  if (!sharedLLMClient) return null;
  return { client: sharedLLMClient };
}

function getUserMessageText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  const user = message as UserMessage;
  if (typeof user.content === "string") return user.content;
  return user.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function setUserMessageText(message: UserMessage, text: string): UserMessage {
  return { ...message, content: text };
}

function findLastUserMessageIndex(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function formatMemoryStatus(service: MemoryService): string {
  const snap = service.getStatus();
  const lines = [
    `status: ${snap.status}`,
    snap.mode ? `mode: ${snap.mode}` : null,
    snap.reason ? `reason: ${snap.reason}` : null,
    sharedHelper
      ? `helper: ${settingsVllm ? `vllm/${settingsVllm.model}` : settingsOllama ? `ollama/${settingsOllama.model}` : (settingsHelperModel ?? "pi-ai")}`
      : "helper: none (regex only)",
    settingsVllm ? `vllm: ${settingsVllm.baseUrl} (${settingsVllm.model})` : null,
    settingsOllama ? `ollama: ${settingsOllama.baseUrl} (${settingsOllama.model})` : null,
    snap.health ? `health: ${JSON.stringify(snap.health)}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export default function piMemoryExtension(pi: ExtensionAPI): void {
  pi.registerFlag("memory-helper-model", {
    description: `Model for memory intent helper (default: ${DEFAULT_HELPER_PROVIDER}/${DEFAULT_HELPER_MODEL})`,
    type: "string",
  });

  pi.on("session_start", async (_event, ctx) => {
    const loaded = loadMemorySettings();
    const cfg = loaded.config;
    settingsHelperModel = loaded.helperModel;
    settingsOllama = loaded.ollama;
    settingsVllm = loaded.vllm;
    sessionCfg = cfg;
    preflightCache = null;
    sharedHelper = null;

    if (cfg.provider === "disabled") return;

    const service = new MemoryService(cfg);
    sharedService = service;

    await service.start();
    service.startSessionIndex();
    if (cfg.trainer.auto_interval) {
      service.startAutoTrainer();
    }
    try {
      await refreshMemoryHelper(ctx, pi);
    } catch {
      /* helper unavailable — regex-only preflight */
    }
  });

  pi.on("session_shutdown", async () => {
    if (sharedService) {
      await sharedService.stop();
      sharedService = null;
    }
    sessionCfg = null;
    settingsHelperModel = undefined;
    settingsOllama = null;
    settingsVllm = null;
    sharedHelper = null;
    sharedLLMClient = null;
    preflightCache = null;
  });

  pi.on("model_select", async (_event, ctx) => {
    await refreshMemoryHelper(ctx, pi);
  });

  pi.on("agent_start", () => {
    preflightCache = null;
  });

  const initialSettings = loadMemorySettings();
  settingsHelperModel = initialSettings.helperModel;
  settingsOllama = initialSettings.ollama;
  settingsVllm = initialSettings.vllm;

  const fallback = createFallbackQuery({
    sessionsDir: initialSettings.config.sessionsDir,
    memoryMdPaths: initialSettings.config.memoryMdPaths,
  });

  pi.registerCommand("memory", {
    description: "Show pi-memory sidecar status and bundle info",
    handler: async (_args, ctx) => {
      const service = sharedService;
      if (!service) {
        ctx.ui.notify("pi-memory: service not started", "warning");
        return;
      }
      ctx.ui.notify(formatMemoryStatus(service), "info");
    },
  });

  pi.registerTool({
    name: MEMORY_RECALL_NAME,
    label: "Memory Recall",
    description: MEMORY_RECALL_DESCRIPTION,
    promptSnippet: MEMORY_RECALL_PROMPT_SNIPPET,
    promptGuidelines: [...MEMORY_RECALL_PROMPT_GUIDELINES],
    parameters: MemoryRecallParams,
    async execute(_toolCallId, params, signal) {
      const service = sharedService;
      if (!service) {
      return {
        content: [{ type: "text", text: "Memory service not started." }],
        details: { truncated: false },
        isError: true,
      };
      }
      const tool = createMemoryRecallTool(service, fallback, getRerankOpts());
      const result = await tool.run(JSON.stringify(params), signal);
      const truncated = truncateHead(result.content, {
        maxLines: RECALL_MAX_LINES,
        maxBytes: RECALL_MAX_BYTES,
      });
      let text = truncated.content;
      if (truncated.truncated) {
        text += `\n\n[truncated: ${truncated.totalLines} lines, ${truncated.totalBytes} bytes]`;
      }
      return {
        content: [{ type: "text", text }],
        details: { truncated: truncated.truncated },
        isError: result.isError ?? false,
      };
    },
  });

  const memoryMdPath = initialSettings.config.memoryMdPaths[0];
  if (memoryMdPath) {
    const appendTool = createMemoryAppendTool(memoryMdPath);
    pi.registerTool({
      name: MEMORY_APPEND_NAME,
      label: "Memory Append",
      description: MEMORY_APPEND_DESCRIPTION,
      promptSnippet: MEMORY_APPEND_PROMPT_SNIPPET,
      promptGuidelines: [...MEMORY_APPEND_PROMPT_GUIDELINES],
      parameters: MemoryAppendParams,
      async execute(_toolCallId, params) {
        const result = await appendTool.run(JSON.stringify(params));
        return {
          content: [{ type: "text", text: result.content }],
          details: {},
          isError: result.isError ?? false,
        };
      },
    });
  }

  pi.on("context", async (event, ctx) => {
    const service = sharedService;
    const cfg = sessionCfg;
    if (!service || !cfg || cfg.provider === "disabled") return;

    const userIndex = findLastUserMessageIndex(event.messages);
    if (userIndex < 0) return;

    const userText = getUserMessageText(event.messages[userIndex]!);
    if (!userText?.trim()) return;

    let privateContext: string | undefined;
    if (preflightCache?.userText === userText) {
      privateContext = preflightCache.privateContext;
    } else {
      const userTurnCount = event.messages.filter((m) => m.role === "user").length;
      const preflight = await runMemoryPreflight(userText, service, {
        helper: sharedHelper,
        forceHelper: userTurnCount === 1,
        fallback,
        signal: ctx.signal,
        rerankOpts: getRerankOpts(),
      });
      if (!preflight?.privateContext) return;
      privateContext = preflight.privateContext;
      preflightCache = { userText, privateContext };
    }

    const injectedText = injectPrivateMemoryContext(
      userText,
      userText,
      privateContext,
    );

    const messages = [...event.messages];
    messages[userIndex] = setUserMessageText(
      messages[userIndex] as UserMessage,
      injectedText,
    );

    return { messages };
  });
}

export { piMemoryExtension };
