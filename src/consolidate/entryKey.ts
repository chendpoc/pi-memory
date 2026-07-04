/** Stable dedupe key for memory entries (section + trimmed content). */
export function entryDedupeKey(entry: { section: string; content: string }): string {
  return `${entry.section}\0${entry.content.trim()}`;
}
