import type { MemorySection, StoreMemoryEntry } from "../types.js";

export function formatEntryLine(entry: StoreMemoryEntry): string {
  const prefix = entry.userAuthored ? "[user] " : "";
  const meta = `<!-- id:${entry.id}${entry.userAuthored ? " user" : ""} ts:${entry.timestamp} -->`;
  return `- ${prefix}${entry.content.trim()} ${meta}`;
}

export function formatSectionHeader(section: MemorySection): string {
  return `## ${section}`;
}

export function countLines(content: string): number {
  if (!content) return 0;
  return content.split("\n").length;
}
