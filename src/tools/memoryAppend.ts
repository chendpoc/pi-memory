import fs from "node:fs/promises";
import { open } from "node:fs/promises";
import path from "node:path";

import { openConsolidationStore } from "../consolidation/stage1/store.js";
import type { MemoryScope } from "../consolidation/scope.js";
import type { ToolResult } from "../types.js";

export const MEMORY_APPEND_NAME = "memory_append";

export const MEMORY_APPEND_DESCRIPTION =
  "Persist durable memory only when the user explicitly asks to remember something. " +
  "Writes go through the pi-memory consolidation stage instead of direct file edits when configured.";

export const MEMORY_APPEND_PROMPT_SNIPPET = "Persist explicit user memory";

export const MEMORY_APPEND_PROMPT_GUIDELINES = [
  "Use memory_append only when the user explicitly asks to remember a preference or durable fact — not for transient task state.",
] as const;

export const MEMORY_APPEND_PARAMETERS = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description:
        "New entries to append (markdown bullet points). Write in English by default.",
    },
  },
  required: ["content"],
} as const;

const LOCK_RETRIES = 50;
const LOCK_DELAY_MS = 20;

async function withAppendLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  let handle;
  for (let i = 0; i < LOCK_RETRIES; i++) {
    try {
      handle = await open(lockPath, "wx");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, LOCK_DELAY_MS));
    }
  }
  if (!handle) {
    throw new Error("could not acquire MEMORY.md append lock");
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch(() => {});
  }
}

export async function appendToMemoryMd(
  memoryMdPath: string,
  content: string,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("content must not be empty");
  }
  await fs.mkdir(path.dirname(memoryMdPath), { recursive: true, mode: 0o700 });
  const lockPath = `${memoryMdPath}.append.lock`;
  const block = content.endsWith("\n") ? content : `${content}\n`;
  await withAppendLock(lockPath, async () => {
    await fs.appendFile(memoryMdPath, block, { encoding: "utf8", mode: 0o600 });
  });
}

export interface Stage1AppendOptions {
  dbPath: string;
  sessionId?: string;
  sessionFile?: string;
  scope?: MemoryScope;
  now?: string;
}

export async function appendToStage1(
  content: string,
  opts: Stage1AppendOptions,
): Promise<string> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("content must not be empty");
  const store = openConsolidationStore(opts.dbPath);
  if (!store) throw new Error("could not open consolidation store");
  const now = opts.now ?? new Date().toISOString();
  const sessionId = opts.sessionId
    ? `manual_${opts.sessionId}_${Date.now()}`
    : `manual_${Date.now()}`;
  try {
    store.upsertStage1Output({
      session_id: sessionId,
      session_file: opts.sessionFile ?? "manual-memory-append",
      source_mtime_ms: Date.now(),
      generated_at: now,
      raw_memory: trimmed,
      rollout_summary: trimmed,
      scope: opts.scope ?? "global",
      status: "done",
      selected_for_phase2: false,
      usage_count: 0,
      last_usage: now,
      error_message: null,
    });
    return sessionId;
  } finally {
    store.close();
  }
}

export class MemoryAppendTool {
  constructor(
    private readonly memoryMdPath: string,
    private readonly stage1?: Stage1AppendOptions,
  ) {}

  info() {
    return {
      name: MEMORY_APPEND_NAME,
      description: MEMORY_APPEND_DESCRIPTION,
      parameters: MEMORY_APPEND_PARAMETERS,
    };
  }

  async run(argsJson: string): Promise<ToolResult> {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(argsJson) as Record<string, unknown>;
    } catch (e) {
      return {
        content: `invalid arguments: ${e instanceof Error ? e.message : e}`,
        isError: true,
      };
    }
    const content = typeof raw.content === "string" ? raw.content : "";
    if (!content.trim()) {
      return { content: "content must not be empty", isError: true };
    }
    try {
      if (this.stage1) {
        const id = await appendToStage1(content, this.stage1);
        return { content: `queued memory for consolidation: ${id}` };
      }
      await appendToMemoryMd(this.memoryMdPath, content);
      return { content: `appended to ${this.memoryMdPath}` };
    } catch (e) {
      return {
        content: `error appending: ${e instanceof Error ? e.message : e}`,
        isError: true,
      };
    }
  }
}

export function createMemoryAppendTool(
  memoryMdPath: string,
  stage1?: Stage1AppendOptions,
): MemoryAppendTool {
  return new MemoryAppendTool(memoryMdPath, stage1);
}
