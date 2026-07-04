import { basename } from "node:path";

import { OVERFLOW_POINTER_RE } from "../constants.js";
import { MEMORY_SECTIONS, type MemorySection, type ParsedEntry } from "../types.js";

const SECTION_RE = /^##\s+(Preferences|Conventions|Findings|Todos)\s*$/;
const ENTRY_META_RE = /<!--\s*id:([^\s]+)(?:\s+user)?(?:\s+ts:([^\s]+))?\s*-->/;
const USER_PREFIX_RE = /^\[user\]\s+/;

export function parseMemoryMarkdown(content: string, sourceFile: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let section: MemorySection | undefined;
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1] as MemorySection;
      continue;
    }

    if (!line.startsWith("- ") || !section) continue;

    const pointerMatch = line.match(OVERFLOW_POINTER_RE);
    if (pointerMatch) continue;

    const metaMatch = line.match(ENTRY_META_RE);
    const id = metaMatch?.[1] ?? `${basename(sourceFile)}:${i + 1}`;
    const timestamp = metaMatch?.[2] ?? new Date(0).toISOString();
    let body = line.slice(2).replace(ENTRY_META_RE, "").trim();
    const userAuthored = USER_PREFIX_RE.test(body);
    if (userAuthored) body = body.replace(USER_PREFIX_RE, "").trim();

    if (!body) continue;

    entries.push({
      id,
      section,
      content: body,
      userAuthored: userAuthored || undefined,
      timestamp,
      sourceFile,
      line: i + 1,
    });
  }

  return entries;
}

export function listOverflowPointers(content: string): string[] {
  const files: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(OVERFLOW_POINTER_RE);
    if (match?.[1]) files.push(match[1]);
  }
  return files;
}

export function isKnownSection(name: string): name is MemorySection {
  return (MEMORY_SECTIONS as readonly string[]).includes(name);
}
