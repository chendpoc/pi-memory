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
  saveMemorySettings,
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
/**
 * Per-turn preflight result, set by before_agent_start and consumed by context.
 * userPayload = raw event.prompt (no host scaffolding).
 * privateContext = <private_memory> block to inject.
 */
let turnPreflight: { userPayload: string; privateContext: string } | null = null;

/**
 * True on the very first turn of a session; used to force the intent helper
 * (bypassing the lexical gate) so the first message always checks memory.
 */
let isFirstTurn = false;

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
    turnPreflight = null;
    isFirstTurn = true;
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
    turnPreflight = null;
    isFirstTurn = false;
  });

  pi.on("model_select", async (_event, ctx) => {
    await refreshMemoryHelper(ctx, pi);
  });

  pi.on("agent_start", () => {
    turnPreflight = null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const service = sharedService;
    const cfg = sessionCfg;
    if (!service || !cfg || cfg.provider === "disabled") return;

    const userPayload = String(((event as unknown) as { prompt?: string }).prompt ?? "").trim();
    if (!userPayload) return;

    const forceHelper = isFirstTurn;
    isFirstTurn = false;

    const workingUi = ctx.hasUI
      ? {
          show: (msg: string) => ctx.ui.setWorkingMessage(msg),
          update: (msg: string) => ctx.ui.setWorkingMessage(msg),
          clear: () => ctx.ui.setWorkingMessage(),
        }
      : null;

    try {
      workingUi?.show("Recalling memory…");
      const result = await runMemoryPreflight(userPayload, service, {
        helper: sharedHelper,
        forceHelper,
        fallback,
        signal: ctx.signal,
        rerankOpts: getRerankOpts(),
        onProgress: workingUi?.update,
      });
      turnPreflight = result?.privateContext
        ? { userPayload, privateContext: result.privateContext }
        : null;
    } finally {
      workingUi?.clear();
    }
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
    description: "Show pi-memory status and bundle info",
    handler: async (_args, ctx) => {
      const service = sharedService;
      if (!service) {
        ctx.ui.notify("pi-memory: service not started", "warning");
        return;
      }
      ctx.ui.notify(formatMemoryStatus(service), "info");
    },
  });

  pi.registerCommand("memory-setup", {
    description: "Configure pi-memory LLM backend (Ollama model, remote API, or disable)",
    handler: async (_args, ctx) => {
      const backend = await ctx.ui.select("Select LLM backend for pi-memory:", [
        "ollama  — Local Ollama (recommended for edge)",
        "remote  — Remote API (deepseek-v4-flash)",
        "none    — No LLM (regex only, zero dependencies)",
      ]);
      if (!backend) return;

      const choice = backend.split(/\s/)[0]!;

      if (choice === "none") {
        saveMemorySettings({ helperModel: undefined, ollama: undefined, vllm: undefined });
        settingsOllama = null;
        settingsVllm = null;
        settingsHelperModel = undefined;
        sharedHelper = null;
        sharedLLMClient = null;
        ctx.ui.notify("LLM disabled. Memory will use regex-only intent detection.", "info");
        return;
      }

      if (choice === "remote") {
        const model = await ctx.ui.input(
          "Remote model (provider/model):",
          "deepseek/deepseek-v4-flash",
        );
        if (!model?.trim()) return;
        saveMemorySettings({
          helperModel: model.trim(),
          ollama: undefined,
          vllm: undefined,
        });
        settingsOllama = null;
        settingsVllm = null;
        settingsHelperModel = model.trim();
        try {
          await refreshMemoryHelper(ctx, pi);
          ctx.ui.notify(`Remote LLM set to: ${model.trim()}`, "info");
        } catch {
          ctx.ui.notify(`Model set but auth failed. Check API key for ${model.trim()}.`, "warning");
        }
        return;
      }

      if (choice === "ollama") {
        const baseUrl = await ctx.ui.input("Ollama base URL:", "http://localhost:11434");
        if (!baseUrl?.trim()) return;

        const healthy = await ollamaHealthCheck(baseUrl.trim());
        if (!healthy) {
          const proceed = await ctx.ui.confirm(
            "Ollama not reachable",
            `Cannot connect to ${baseUrl.trim()}. Save config anyway?`,
          );
          if (!proceed) return;
        }

        const model = await ctx.ui.select("Select Ollama model:", [
          "qwen3.5:0.8b  — 500MB, 2GB RAM (minimal edge)",
          "qwen3.5:2b    — 1.5GB, 4GB RAM (recommended)",
          "qwen3.5:4b    — 2.5GB, 8GB RAM (stronger)",
          "qwen3.5:9b    — 5GB, 16GB RAM (desktop)",
          "custom        — Enter model name manually",
        ]);
        if (!model) return;

        let modelName: string;
        if (model.startsWith("custom")) {
          const custom = await ctx.ui.input("Ollama model name:", "qwen3.5:2b");
          if (!custom?.trim()) return;
          modelName = custom.trim();
        } else {
          modelName = model.split(/\s/)[0]!;
        }

        const ollamaCfg = { baseUrl: baseUrl.trim(), model: modelName };
        saveMemorySettings({
          helperModel: `ollama/${modelName}`,
          ollama: ollamaCfg,
          vllm: undefined,
        });
        settingsOllama = ollamaCfg;
        settingsVllm = null;
        settingsHelperModel = `ollama/${modelName}`;

        try {
          await refreshMemoryHelper(ctx, pi);
          ctx.ui.notify(
            `Ollama configured: ${modelName} at ${baseUrl.trim()}\n` +
            (sharedHelper ? "Helper LLM active." : "Ollama offline — using regex fallback."),
            sharedHelper ? "info" : "warning",
          );
        } catch {
          ctx.ui.notify(`Config saved. Ollama offline — will retry on next session start.`, "warning");
        }
        return;
      }
    },
  });

  pi.registerTool({
    name: MEMORY_RECALL_NAME,
    label: "Memory Recall",
    description: MEMORY_RECALL_DESCRIPTION,
    promptSnippet: MEMORY_RECALL_PROMPT_SNIPPET,
    promptGuidelines: [...MEMORY_RECALL_PROMPT_GUIDELINES],
    parameters: MemoryRecallParams,
    async execute(_toolCallId, params, signal, onUpdate) {
      const service = sharedService;
      if (!service) {
        return {
          content: [{ type: "text", text: "Memory service not started." }],
          details: { truncated: false },
          isError: true,
        };
      }
      const onProgress = onUpdate
        ? (msg: string) =>
            (onUpdate as (u: { content: unknown[]; details: Record<string, unknown> }) => void)?.({
              content: [{ type: "text", text: msg }],
              details: { phase: "querying" },
            })
        : undefined;
      const tool = createMemoryRecallTool(service, fallback, getRerankOpts());
      const result = await tool.run(JSON.stringify(params), signal, onProgress);
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

    const scaffolded = getUserMessageText(event.messages[userIndex]!);
    if (!scaffolded?.trim()) return;

    let privateContext: string | undefined;
    let userPayload: string;

    if (turnPreflight?.privateContext) {
      // Happy path: before_agent_start already ran preflight.
      // userPayload is the raw prompt; scaffolded may have host-added prefix.
      privateContext = turnPreflight.privateContext;
      userPayload = turnPreflight.userPayload;
    } else {
      // Fallback: before_agent_start didn't fire (e.g. first context after
      // session restore). Run preflight inline; no scaffold separation.
      const userTurnCount = event.messages.filter((m) => m.role === "user").length;
      const preflight = await runMemoryPreflight(scaffolded, service, {
        helper: sharedHelper,
        forceHelper: userTurnCount === 1,
        fallback,
        signal: ctx.signal,
        rerankOpts: getRerankOpts(),
      });
      if (!preflight?.privateContext) return;
      privateContext = preflight.privateContext;
      userPayload = scaffolded;
      // Cache so tool-call follow-up context calls reuse without re-running.
      turnPreflight = { userPayload: scaffolded, privateContext };
    }

    const injectedText = injectPrivateMemoryContext(
      scaffolded,
      userPayload,
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
