import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createLlmClient, type LlmClient } from "../adapters/llm/index.js";
import { readPiMemoryEnv, resolveMemoryAgentDir } from "../config/index.js";
import { runEpisodicPreflight } from "../preflight/episodic.js";
import { queryIntentCache } from "../preflight/intentCache.js";
import { injectPrivateMemoryContext } from "../preflight/strip.js";
import { enqueueShutdownMetadata } from "../shutdown/enqueue.js";
import { resolveSidecarPaths } from "../sidecar/paths.js";
import { stopSidecar } from "../sidecar/sidecarManager.js";
import { isSubagentSession, readParentSession } from "../utils/session/index.js";
import { formatTimestamp } from "../utils/time.js";
import { MemoryStore } from "../store/memoryStore.js";
import type { ConsolidateScheduler } from "../consolidate/scheduler.js";
import { syncMaintenanceScheduler } from "../scheduler/sync.js";
import type { ReindexScheduler } from "../sidecar/reindexBridge.js";
import type { SidecarPaths } from "../sidecar/paths.js";

import {
  bootstrapConsolidate,
  bootstrapSidecar,
  loadSessionMemoryCap,
  mergePrivateMemoryBlocks,
} from "./lifecycle.js";
import {
  findLastUserMessageIndex,
  getUserMessageText,
  setUserMessageText,
} from "./messageUtils.js";
import type { CreateMemoryRuntimeOptions, MemoryRuntime, TurnPreflight } from "./types.js";

class MemoryRuntimeImpl implements MemoryRuntime {
  readonly store: MemoryStore;
  readonly sidecarPaths: SidecarPaths;
  readonly sessionId: string | null;
  readonly isSubagent: boolean;

  private llmClient: LlmClient | null = null;
  private sessionMemoryCap: string | null = null;
  private turnPreflight: TurnPreflight | null = null;
  private isFirstTurn = true;

  private reindexScheduler: ReindexScheduler | null = null;
  private consolidateScheduler: ConsolidateScheduler | null = null;
  private stopConsolidateInterval: (() => void) | null = null;
  private unsubSyncToSidecar: (() => void) | null = null;
  private unsubConsolidateCheck: (() => void) | null = null;

  constructor(opts: CreateMemoryRuntimeOptions) {
    const agentDir = opts.agentDir ?? resolveMemoryAgentDir();
    this.store = new MemoryStore({ agentDir });
    this.sidecarPaths = resolveSidecarPaths(agentDir);
    this.isSubagent = isSubagentSession(opts.ctx);
    this.sessionId = opts.ctx.sessionManager.getSessionFile() ?? null;
  }

  getLlm(): LlmClient | null {
    return this.llmClient;
  }

  getSessionMemoryCap(): string | null {
    return this.sessionMemoryCap;
  }

  getTurnPreflight(): TurnPreflight | null {
    return this.turnPreflight;
  }

  async bootstrap(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
    this.isFirstTurn = true;
    this.turnPreflight = null;

    await this.refreshLlm(ctx, pi);
    await this.store.ensureInitialized();
    void syncMaintenanceScheduler({ agentDir: this.store.agentDir });

    try {
      const sidecar = await bootstrapSidecar({
        store: this.store,
        sidecarPaths: this.sidecarPaths,
        reindexScheduler: this.reindexScheduler,
      });
      this.reindexScheduler = sidecar.reindexScheduler;
      this.unsubSyncToSidecar = sidecar.unsubSyncToSidecar;

      const consolidate = bootstrapConsolidate({
        store: this.store,
        getLlm: () => this.llmClient,
        onComplete: () => this.reloadSessionMemoryCap(),
        stopExistingInterval: this.stopConsolidateInterval,
      });
      this.consolidateScheduler = consolidate.consolidateScheduler;
      this.stopConsolidateInterval = consolidate.stopConsolidateInterval;
      this.unsubConsolidateCheck = consolidate.unsubConsolidateCheck;

      await this.reloadSessionMemoryCap();
    } catch {
      // sidecar optional; preflight falls back to MEMORY.md
    }
  }

  async refreshLlm(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
    const env = readPiMemoryEnv();
    const flagModel = pi.getFlag("memory-helper-model");
    const modelSpec = typeof flagModel === "string" ? flagModel : env.helperModel;
    this.llmClient = await createLlmClient({ ctx, modelSpec, env });
  }

  async runBeforeAgentStart(event: { prompt?: unknown }, ctx: ExtensionContext): Promise<void> {
    const userPayload = String(event.prompt ?? "").trim();
    if (!userPayload) return;

    const forceHelper = this.isFirstTurn;
    this.isFirstTurn = false;

    if (this.isSubagent) {
      this.turnPreflight = { userPayload, privateContext: this.sessionMemoryCap ?? "" };
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
        socketPath: this.sidecarPaths.socketPath,
        agentDir: this.store.agentDir,
        store: this.store,
        llm: this.llmClient,
        forceEpisodic: forceHelper,
        sessionId: this.sessionId ?? undefined,
        budgetMs: env.preflightBudgetMs,
        signal: ctx.signal,
        onProgress: workingUi?.update,
      });

      const episodicContext = result?.privateContext ?? null;
      const combined = mergePrivateMemoryBlocks(this.sessionMemoryCap, episodicContext);
      this.turnPreflight = { userPayload, privateContext: combined ?? "" };
    } finally {
      workingUi?.clear();
    }
  }

  async runContext(
    event: { messages: AgentMessage[] },
    ctx: ExtensionContext,
  ): Promise<{ messages: AgentMessage[] } | undefined> {
    const userIndex = findLastUserMessageIndex(event.messages);
    if (userIndex < 0) return;

    const scaffolded = getUserMessageText(event.messages[userIndex]!);
    if (!scaffolded?.trim()) return;

    let privateContext: string | undefined;
    let userPayload: string;

    if (this.turnPreflight && this.turnPreflight.userPayload === scaffolded.trim()) {
      privateContext = this.turnPreflight.privateContext || undefined;
      userPayload = this.turnPreflight.userPayload;
    } else {
      const userTurnCount = event.messages.filter((message) => message.role === "user").length;
      const env = readPiMemoryEnv();

      if (this.isSubagent) {
        privateContext = this.sessionMemoryCap ?? undefined;
        userPayload = scaffolded;
        this.turnPreflight = { userPayload: scaffolded, privateContext: privateContext ?? "" };
      } else {
        const preflight = await runEpisodicPreflight(scaffolded, {
          socketPath: this.sidecarPaths.socketPath,
          agentDir: this.store.agentDir,
          store: this.store,
          llm: this.llmClient,
          forceEpisodic: userTurnCount === 1,
          sessionId: this.sessionId ?? undefined,
          budgetMs: env.preflightBudgetMs,
          signal: ctx.signal,
        });
        privateContext =
          mergePrivateMemoryBlocks(this.sessionMemoryCap, preflight?.privateContext) || undefined;
        userPayload = scaffolded;
        this.turnPreflight = { userPayload: scaffolded, privateContext: privateContext ?? "" };
      }
    }

    if (!privateContext) return;

    const injectedText = injectPrivateMemoryContext(scaffolded, userPayload, privateContext);
    const messages = [...event.messages];
    messages[userIndex] = setUserMessageText(messages[userIndex]!, injectedText);
    return { messages };
  }

  async shutdown(
    event: Parameters<MemoryRuntime["shutdown"]>[0],
    ctx: ExtensionContext,
  ): Promise<void> {
    const header = ctx.sessionManager.getHeader() as unknown as Record<string, unknown> | null;
    void enqueueShutdownMetadata(this.store.agentDir, {
      sessionFile: ctx.sessionManager.getSessionFile() ?? "",
      parentSession: readParentSession(header),
      reason: event.reason,
      isSubagent: this.isSubagent,
      enqueuedAt: formatTimestamp(),
    }).catch(() => {});

    if (this.sessionId) {
      queryIntentCache.clearSession(this.sessionId);
    }
  }

  async reloadSessionMemoryCap(): Promise<void> {
    this.sessionMemoryCap = await loadSessionMemoryCap(this.store);
  }

  async dispose(): Promise<void> {
    this.stopConsolidateInterval?.();
    this.stopConsolidateInterval = null;

    this.unsubSyncToSidecar?.();
    this.unsubSyncToSidecar = null;
    this.unsubConsolidateCheck?.();
    this.unsubConsolidateCheck = null;

    this.consolidateScheduler = null;
    this.reindexScheduler = null;
    this.llmClient = null;
    this.sessionMemoryCap = null;
    this.turnPreflight = null;
    this.isFirstTurn = false;

    try {
      await stopSidecar();
    } catch {
      // ignore shutdown errors
    }
  }
}

export function createMemoryRuntime(opts: CreateMemoryRuntimeOptions): MemoryRuntime {
  return new MemoryRuntimeImpl(opts);
}

export type { CreateMemoryRuntimeOptions, MemoryRuntime, TurnPreflight } from "./types.js";
