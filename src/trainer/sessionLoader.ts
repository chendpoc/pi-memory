import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { messageText, parseJsonlSession as parseActiveBranchJsonl } from "../session/activeBranch.js";

export interface SessionTurn {
  role: string;
  content: string;
  turnIndex: number;
}

export interface LoadedSession {
  id: string;
  title: string;
  createdAt: string;
  filePath: string;
  modifiedAt: Date;
  parentSessionFile?: string;
  parentSessionId?: string;
  turns: SessionTurn[];
}

interface PiSessionMessage {
  role?: string;
  content?: unknown;
}

interface PiSessionFile {
  id?: string;
  title?: string;
  created_at?: string;
  messages?: PiSessionMessage[];
}

export interface SessionLoaderOptions {
  sessionsDir: string;
  modifiedAfter?: Date | null;
}

/**
 * Collect all session files recursively (supports project subdirectories).
 * Returns both .json and .jsonl files.
 */
async function collectSessionFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let st;
    try { st = await fs.stat(full); } catch { continue; }
    if (st.isDirectory()) {
      const sub = await collectSessionFiles(full);
      files.push(...sub);
    } else if (st.isFile() && (name.endsWith(".json") || name.endsWith(".jsonl"))) {
      files.push(full);
    }
  }
  return files;
}

function parseJsonSession(raw: string, filePath: string): LoadedSession | null {
  let session: PiSessionFile;
  try {
    session = JSON.parse(raw) as PiSessionFile;
  } catch {
    return null;
  }

  if (!session.messages || session.messages.length === 0) return null;

  const turns: SessionTurn[] = [];
  for (let i = 0; i < session.messages.length; i++) {
    const msg = session.messages[i]!;
    const text = messageText(msg.content);
    if (!text.trim()) continue;
    turns.push({ role: msg.role ?? "unknown", content: text, turnIndex: i });
  }

  if (turns.length === 0) return null;

  return {
    id: session.id ?? path.basename(filePath, ".json"),
    title: session.title ?? "",
    createdAt: session.created_at ?? "",
    filePath,
    modifiedAt: new Date(),
    turns,
  };
}

function parseJsonlSession(raw: string, filePath: string): LoadedSession | null {
  const parsed = parseActiveBranchJsonl(raw, filePath);
  if (!parsed) return null;
  return {
    ...parsed,
    filePath,
    modifiedAt: new Date(),
  };
}

/**
 * Scan session files (JSON + JSONL, recursive subdirectories), parse Pi session
 * format, optionally filter by modified-after timestamp for incremental training.
 */
export async function loadSessions(
  opts: SessionLoaderOptions,
): Promise<LoadedSession[]> {
  const { sessionsDir, modifiedAfter } = opts;
  if (!sessionsDir.trim()) return [];

  const filePaths = await collectSessionFiles(sessionsDir);
  const sessions: LoadedSession[] = [];

  for (const filePath of filePaths) {
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (modifiedAfter && st.mtime <= modifiedAfter) continue;

    const parsed = await loadSessionFile(filePath);

    if (!parsed) continue;
    parsed.modifiedAt = st.mtime;
    sessions.push(parsed);
  }

  sessions.sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());
  return deduplicateSessions(sessions);
}

export async function loadSessionFile(filePath: string): Promise<LoadedSession | null> {
  let st: Awaited<ReturnType<typeof fs.stat>>;
  try {
    st = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const parsed = filePath.endsWith(".jsonl")
    ? parseJsonlSession(raw, filePath)
    : parseJsonSession(raw, filePath);
  if (!parsed) return null;
  parsed.modifiedAt = st.mtime;
  return parsed;
}

function deduplicateSessions(sessions: LoadedSession[]): LoadedSession[] {
  const seen = new Set<string>();
  return sessions.filter((s) => {
    const fingerprint = createHash("sha256")
      .update(s.turns.map((t) => t.content).join("\n"))
      .digest("hex")
      .slice(0, 16);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}
