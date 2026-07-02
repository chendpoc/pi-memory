import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { openSessionIndex, type SessionIndex } from "./sessionIndex.js";

/** Mirrors Kocoro session.SearchResult for fallback hits. */
export interface SessionSearchHit {
  session_id: string;
  session_title: string;
  role: string;
  snippet: string;
  msg_index: number;
  created_at: string;
}

let cachedIndex: SessionIndex | null = null;
let cachedDbPath: string | null = null;

function getSessionIndex(dbPath: string): SessionIndex | null {
  if (cachedIndex && cachedDbPath === dbPath) return cachedIndex;
  if (!fsSync.existsSync(dbPath)) return null;
  cachedIndex = openSessionIndex(dbPath);
  cachedDbPath = dbPath;
  return cachedIndex;
}

/** Default session DB path. */
export function defaultSessionDbPath(sessionsDir: string): string {
  return path.join(path.dirname(sessionsDir), "memory", "sessions.db");
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

const SNIPPET_MAX = 240;

async function collectFiles(dir: string): Promise<string[]> {
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
      files.push(...await collectFiles(full));
    } else if (st.isFile() && (name.endsWith(".json") || name.endsWith(".jsonl"))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Keyword search over Pi-style session files (JSON + JSONL, recursive subdirectories).
 * Uses FTS5 index when available, falls back to file scan.
 * All whitespace-separated terms must match (case-insensitive AND).
 */
export async function sessionKeywordSearch(
  sessionsDir: string,
  query: string,
  limit: number,
): Promise<SessionSearchHit[]> {
  if (!sessionsDir.trim()) return [];
  const q = query.trim();
  if (!q) return [];
  if (limit <= 0) limit = 20;

  const dbPath = defaultSessionDbPath(sessionsDir);
  const idx = getSessionIndex(dbPath);
  if (idx) {
    const results = idx.search(q, limit);
    if (results.length > 0) return results;
  }

  const terms = splitTerms(q);
  if (terms.length === 0) return [];

  const filePaths = await collectFiles(sessionsDir);
  const hits: SessionSearchHit[] = [];

  for (const filePath of filePaths) {
    let st;
    try {
      st = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    if (filePath.endsWith(".jsonl")) {
      scanJsonlFile(raw, filePath, terms, hits, limit);
    } else {
      scanJsonFile(raw, filePath, terms, hits, limit);
    }

    if (hits.length >= limit) return hits;
  }
  return hits;
}

function scanJsonFile(
  raw: string,
  filePath: string,
  terms: string[],
  hits: SessionSearchHit[],
  limit: number,
): void {
  let session: PiSessionFile;
  try {
    session = JSON.parse(raw) as PiSessionFile;
  } catch {
    return;
  }

  const sessionId = session.id ?? path.basename(filePath, ".json");
  const title = session.title ?? "";
  const createdAt = session.created_at ?? "";

  for (let i = 0; i < (session.messages?.length ?? 0); i++) {
    const msg = session.messages![i]!;
    const text = messageText(msg.content);
    if (!text || !allTermsMatch(text, terms)) continue;
    hits.push({
      session_id: sessionId,
      session_title: title,
      role: msg.role ?? "unknown",
      snippet: makeSnippet(text, terms[0]!),
      msg_index: i,
      created_at: createdAt,
    });
    if (hits.length >= limit) return;
  }
}

function scanJsonlFile(
  raw: string,
  filePath: string,
  terms: string[],
  hits: SessionSearchHit[],
  limit: number,
): void {
  const lines = raw.split("\n").filter((l) => l.trim());
  let sessionId = path.basename(filePath, ".jsonl");
  let title = "";
  let createdAt = "";
  let msgIndex = 0;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (obj.type === "session") {
      sessionId = (obj.id as string) ?? sessionId;
      title = (obj.title as string) ?? "";
      createdAt = (obj.timestamp as string) ?? "";
      continue;
    }

    if (obj.type === "message") {
      const msg = (obj as { message?: PiSessionMessage }).message;
      if (!msg?.role || !msg.content) continue;
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const text = messageText(msg.content);
      if (!text || !allTermsMatch(text, terms)) continue;
      hits.push({
        session_id: sessionId,
        session_title: title,
        role: msg.role,
        snippet: makeSnippet(text, terms[0]!),
        msg_index: msgIndex,
        created_at: createdAt,
      });
      msgIndex++;
      if (hits.length >= limit) return;
    }
  }
}

function splitTerms(query: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of query) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) {
        out.push(cur.toLowerCase());
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur.toLowerCase());
  return out;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (typeof b.text === "string") parts.push(b.text);
      else if (typeof b.content === "string") parts.push(b.content);
    }
  }
  return parts.join("\n");
}

function allTermsMatch(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.every((t) => lower.includes(t));
}

function makeSnippet(text: string, firstTerm: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(firstTerm.toLowerCase());
  if (idx < 0) {
    return text.length <= SNIPPET_MAX ? text : text.slice(0, SNIPPET_MAX) + "...";
  }
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + firstTerm.length + 120);
  let snip = text.slice(start, end);
  if (start > 0) snip = "..." + snip;
  if (end < text.length) snip += "...";
  return snip;
}
