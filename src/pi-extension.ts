import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createLlmClient, type LlmClient } from "./adapters/llm/index.js";
import { loadEnv, readPiMemoryEnv, resolveMemoryAgentDir } from "./config/index.js";
import { readPreflightRuntimeConfig } from "./config/preflight.js";
import { createConsolidateScheduler, startConsolidateInterval, type ConsolidateScheduler } from "./consolidate/scheduler.js";
import { registerCommands } from "./commands/index.js";
import { registerCompactHandlers } from "./compact/register.js";
import { runEpisodicPreflight } from "./preflight/episodic.js";
import { queryIntentCache } from "./preflight/intentCache.js";
import { mergePrivateMemoryBlocks, renderMemoryCapPrivateMemory } from "./preflight/render.js";
import { isSubagentSession } from "./preflight/session.js";
import { injectPrivateMemoryContext } from "./preflight/strip.js";
import { enqueueShutdownMetadata, readParentSession } from "./shutdown/enqueue.js";
import { resolveSidecarPaths } from "./sidecar/paths.js";
import { formatTimestamp } from "./utils/time.js";
import { createReindexScheduler, type ReindexScheduler } from "./sidecar/reindexBridge.js";
import { warmSidecar } from "./sidecar/warmup.js";
import { ensureSidecarRunning, stopSidecar } from "./sidecar/sidecarManager.js";
import { MemoryStore } from "./store/memoryStore.js";

loadEnv();

type TurnPreflight = {
  userPayload: string;
  privateContext: string;
};

let memoryStore: MemoryStore | null = null;
let sidecarPaths: ReturnType<typeof resolveSidecarPaths> | null = null;
let reindexScheduler: ReindexScheduler | null = null;
let consolidateScheduler: ConsolidateScheduler | null = null;
let stopConsolidateInterval: (() => void) | null = null;
let llmClient: LlmClient | null = null;
let sessionMemoryCap: string | null = null;
let turnPreflight: TurnPreflight | null = null;
let isFirstTurn = false;
let isSubagent = false;
let sessionId: string | null = null;

function getUserMessageText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function setUserMessageText(message: AgentMessage, text: string): AgentMessage {
  if (message.role !== "user") return message;
  return { ...message, content: text } as AgentMessage;
}

function findLastUserMessageIndex(messages: AgentMessage[]): number {
  return messages.findLastIndex((message) => message.role === "user");
}

async function refreshLlm(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
  const env = readPiMemoryEnv();
  const flagModel = pi.getFlag("memory-helper-model");
  const modelSpec = typeof flagModel === "string" ? flagModel : env.helperModel;
  llmClient = await createLlmClient({ ctx, modelSpec, env });
}

async function bootstrapSidecar(): Promise<void> {
  if (!memoryStore || !sidecarPaths) return;

  await memoryStore.ensureInitialized();
  await ensureSidecarRunning({
    socketPath: sidecarPaths.socketPath,
    dbPath: sidecarPaths.dbPath,
  });

  if (readPreflightRuntimeConfig().warmSidecar) {
    try {
      await warmSidecar(sidecarPaths.socketPath);
    } catch {
      // warm is best-effort
    }
  }

  reindexScheduler ??= createReindexScheduler({
    sidecar: sidecarPaths,
    agentDir: memoryStore.agentDir,
    getDocuments: () => memoryStore!.exportForIndex(),
    debounceMs: readPiMemoryEnv().reindexDebounceMs,
  });

  memoryStore.onSyncToSidecar(() => reindexScheduler?.schedule());

  await reindexScheduler.runNow();
}

function bootstrapConsolidate(): void {
  if (!memoryStore) return;

  consolidateScheduler = createConsolidateScheduler({
    getStore: () => memoryStore,
    getAgentDir: () => memoryStore?.agentDir ?? null,
    getLlm: () => llmClient,
    debounceMs: readPiMemoryEnv().consolidateDebounceMs,
    onComplete: preloadSessionMemoryCap,
  });

  memoryStore.onConsolidateCheck(() => consolidateScheduler?.schedule());

  stopConsolidateInterval?.();
  stopConsolidateInterval = startConsolidateInterval(() => {
    void consolidateScheduler?.runNow();
  });

  void consolidateScheduler.runNow();
}

async function preloadSessionMemoryCap(): Promise<void> {
  if (!memoryStore) return;
  const fallback = await memoryStore.readForFallback();
  sessionMemoryCap = renderMemoryCapPrivateMemory(fallback) || null;
}

export default function piMemoryExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const agentDir = resolveMemoryAgentDir();
    memoryStore = new MemoryStore({ agentDir });
    sidecarPaths = resolveSidecarPaths(agentDir);
    isSubagent = isSubagentSession(ctx);
    isFirstTurn = true;
    turnPreflight = null;
    sessionId = ctx.sessionManager.getSessionFile() ?? null;

    await refreshLlm(ctx, pi);

    try {
      await bootstrapSidecar();
      bootstrapConsolidate();
      await preloadSessionMemoryCap();
    } catch {
      // sidecar optional; preflight falls back to MEMORY.md
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (memoryStore) {
      const header = ctx.sessionManager.getHeader() as unknown as Record<string, unknown> | null;
      void enqueueShutdownMetadata(memoryStore.agentDir, {
        sessionFile: ctx.sessionManager.getSessionFile() ?? "",
        parentSession: readParentSession(header),
        reason: event.reason,
        isSubagent,
        enqueuedAt: formatTimestamp(),
      }).catch(() => {});
    }

    if (sessionId) {
      queryIntentCache.clearSession(sessionId);
    }

    stopConsolidateInterval?.();
    stopConsolidateInterval = null;
    consolidateScheduler = null;
    reindexScheduler = null;
    memoryStore = null;
    sidecarPaths = null;
    llmClient = null;
    sessionMemoryCap = null;
    turnPreflight = null;
    isFirstTurn = false;
    isSubagent = false;
    sessionId = null;

    try {
      await stopSidecar();
    } catch {
      // ignore shutdown errors
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    await refreshLlm(ctx, pi);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!memoryStore || !sidecarPaths) return;

    const userPayload = String(event.prompt ?? "").trim();
    if (!userPayload) return;

    const forceHelper = isFirstTurn;
    isFirstTurn = false;

    if (isSubagent) {
      turnPreflight = { userPayload, privateContext: sessionMemoryCap ?? "" };
      return;
    }

    const workingUi = ctx.hasUI
      ? {
          show: (msg: string) => ctx.ui.setWorkingMessage(msg),
          update: (msg: string) => ctx.ui.setWorkingMessage(msg),
          clear: () => ctx.ui.setWorkingMessage(),
        }
      : null;

    try {
      workingUi?.show("Recalling memory…");
      const env = readPiMemoryEnv();
      const result = await runEpisodicPreflight(userPayload, {
        socketPath: sidecarPaths.socketPath,
        agentDir: memoryStore.agentDir,
        store: memoryStore,
        llm: llmClient,
        forceEpisodic: forceHelper,
        sessionId: sessionId ?? undefined,
        budgetMs: env.preflightBudgetMs,
        signal: ctx.signal,
        onProgress: workingUi?.update,
      });

      const episodicContext = result?.privateContext ?? null;
      const combined = mergePrivateMemoryBlocks(sessionMemoryCap, episodicContext);
      turnPreflight = { userPayload, privateContext: combined ?? "" };
    } finally {
      workingUi?.clear();
    }
  });

  pi.on("context", async (event, ctx) => {
    if (!memoryStore || !sidecarPaths) return;

    const userIndex = findLastUserMessageIndex(event.messages);
    if (userIndex < 0) return;

    const scaffolded = getUserMessageText(event.messages[userIndex]!);
    if (!scaffolded?.trim()) return;

    let privateContext: string | undefined;
    let userPayload: string;

    if (turnPreflight && turnPreflight.userPayload === scaffolded.trim()) {
      privateContext = turnPreflight.privateContext || undefined;
      userPayload = turnPreflight.userPayload;
    } else {
      const userTurnCount = event.messages.filter((message) => message.role === "user").length;
      const env = readPiMemoryEnv();

      if (isSubagent) {
        privateContext = sessionMemoryCap ?? undefined;
        userPayload = scaffolded;
        turnPreflight = { userPayload: scaffolded, privateContext: privateContext ?? "" };
      } else {
        const preflight = await runEpisodicPreflight(scaffolded, {
          socketPath: sidecarPaths.socketPath,
          agentDir: memoryStore.agentDir,
          store: memoryStore,
          llm: llmClient,
          forceEpisodic: userTurnCount === 1,
          sessionId: sessionId ?? undefined,
          budgetMs: env.preflightBudgetMs,
          signal: ctx.signal,
        });
        privateContext = mergePrivateMemoryBlocks(
          sessionMemoryCap,
          preflight?.privateContext,
        ) || undefined;
        userPayload = scaffolded;
        turnPreflight = { userPayload: scaffolded, privateContext: privateContext ?? "" };
      }
    }

    if (!privateContext) return;

    const injectedText = injectPrivateMemoryContext(scaffolded, userPayload, privateContext);
    const messages = [...event.messages];
    messages[userIndex] = setUserMessageText(messages[userIndex]!, injectedText);
    return { messages };
  });

  registerCommands(pi, {
    getMemoryStore: () => memoryStore,
    onRemembered: preloadSessionMemoryCap,
    getAgentDir: () => memoryStore?.agentDir ?? resolveMemoryAgentDir(),
  });

  registerCompactHandlers(pi, {
    getMemoryStore: () => memoryStore,
    getLlmClient: () => llmClient,
    onCompactionIngested: preloadSessionMemoryCap,
  });
}

export { piMemoryExtension };
