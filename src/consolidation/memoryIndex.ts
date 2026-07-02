import fs from "node:fs";
import fsPromises from "node:fs/promises";

import {
  lineMatchesScope,
  type MemoryScope,
} from "./scope.js";

export interface MemoryIndexCapOptions {
  maxLines?: number;
  maxBytes?: number;
  scopes?: readonly MemoryScope[];
}

export interface MemoryIndexStats {
  path: string;
  exists: boolean;
  lines: number;
  bytes: number;
  cappedLines: number;
  cappedBytes: number;
}

const DEFAULT_MAX_LINES = 200;
const DEFAULT_MAX_BYTES = 25_600;

function capLines(
  text: string,
  opts: Required<Pick<MemoryIndexCapOptions, "maxLines" | "maxBytes">> & {
    scopes?: readonly MemoryScope[];
  },
): string {
  const out: string[] = [];
  let bytes = 0;
  for (const line of text.split("\n")) {
    if (out.length >= opts.maxLines) break;
    if (!lineMatchesScope(line, opts.scopes)) continue;
    const nextBytes = Buffer.byteLength(line + "\n", "utf8");
    if (bytes + nextBytes > opts.maxBytes) break;
    out.push(line);
    bytes += nextBytes;
  }
  return out.join("\n").trim();
}

function normalizedOptions(opts: MemoryIndexCapOptions = {}) {
  return {
    maxLines: opts.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
    scopes: opts.scopes,
  };
}

export function readMemoryIndexCap(
  paths: string[],
  opts: MemoryIndexCapOptions = {},
): string {
  const normalized = normalizedOptions(opts);
  for (const p of paths) {
    let text: string;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const capped = capLines(text, normalized);
    if (capped) return capped;
  }
  return "";
}

export async function memoryIndexSnippet(
  paths: string[],
  query: string,
  opts: MemoryIndexCapOptions = {},
): Promise<string> {
  const q = query.trim().toLowerCase();
  if (!q) return "";
  const normalized = normalizedOptions(opts);

  for (const p of paths) {
    let text: string;
    try {
      text = await fsPromises.readFile(p, "utf8");
    } catch {
      continue;
    }
    const matches: string[] = [];
    let bytes = 0;
    for (const line of text.split("\n")) {
      if (!lineMatchesScope(line, normalized.scopes)) continue;
      if (!line.toLowerCase().includes(q)) continue;
      const nextBytes = Buffer.byteLength(line + "\n", "utf8");
      if (bytes + nextBytes > normalized.maxBytes) break;
      matches.push(line);
      bytes += nextBytes;
      if (matches.length >= normalized.maxLines) break;
    }
    if (matches.length > 0) return matches.join("\n");
  }
  return "";
}

export function getMemoryIndexStats(
  paths: string[],
  opts: MemoryIndexCapOptions = {},
): MemoryIndexStats[] {
  const normalized = normalizedOptions(opts);
  return paths.map((p) => {
    let text = "";
    let exists = true;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      exists = false;
    }
    const capped = exists ? capLines(text, normalized) : "";
    return {
      path: p,
      exists,
      lines: exists ? text.split("\n").length : 0,
      bytes: exists ? Buffer.byteLength(text, "utf8") : 0,
      cappedLines: capped ? capped.split("\n").length : 0,
      cappedBytes: Buffer.byteLength(capped, "utf8"),
    };
  });
}
