import fs from "node:fs/promises";
import path from "node:path";

export interface ConsolidationLogEntry {
  ts?: string;
  phase: string;
  [key: string]: unknown;
}

export async function appendConsolidationLog(
  logPath: string,
  entry: ConsolidationLogEntry,
): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const line = JSON.stringify({
    ts: entry.ts ?? new Date().toISOString(),
    ...entry,
  });
  await fs.appendFile(logPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readRecentConsolidationLogs(
  logPath: string,
  limit = 5,
): Promise<ConsolidationLogEntry[]> {
  let text: string;
  try {
    text = await fs.readFile(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim())
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line) as ConsolidationLogEntry;
      } catch {
        return { phase: "invalid_log_line", raw: line };
      }
    });
}
