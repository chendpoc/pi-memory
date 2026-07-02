import fs from "node:fs/promises";

import { projectScope } from "../scope.js";
import type { PendingSession, Stage1Output } from "../types.js";
import type { SessionTurn } from "../../trainer/sessionLoader.js";

const OPERATING_SIGNAL_RE =
  /\b(prefer|preference|always|default|remember|convention|build command|test command)\b|(?:偏好|默认|以后|记住|约定|构建|测试命令)/i;

function cleanLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function summarizeTurns(turns: SessionTurn[], max = 4): string {
  return turns
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .slice(0, max)
    .map((turn) => `- ${turn.role}: ${cleanLine(turn.content).slice(0, 240)}`)
    .join("\n");
}

function extractOperatingLines(turns: SessionTurn[]): string {
  const lines: string[] = [];
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const text = cleanLine(turn.content);
    if (!OPERATING_SIGNAL_RE.test(text)) continue;
    lines.push(`- ${text}`);
  }
  return lines.join("\n");
}

export async function extractSessionToStage1(
  pending: PendingSession,
  turns: SessionTurn[],
  opts: { now?: string } = {},
): Promise<Stage1Output> {
  const generatedAt = opts.now ?? new Date().toISOString();
  const stat = await fs.stat(pending.session_file);
  const rawMemory = extractOperatingLines(turns);
  const rolloutSummary = summarizeTurns(turns);
  const hasOutput = rawMemory.trim() || rolloutSummary.trim();

  return {
    session_id: pending.session_id,
    session_file: pending.session_file,
    source_mtime_ms: Math.trunc(stat.mtimeMs),
    generated_at: generatedAt,
    raw_memory: rawMemory.trim(),
    rollout_summary: rolloutSummary.trim(),
    scope: projectScope(pending.project_hash),
    status: hasOutput ? "done" : "skipped",
    selected_for_phase2: false,
    usage_count: 0,
    last_usage: generatedAt,
    error_message: null,
  };
}
