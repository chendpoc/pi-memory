import orderBy from "lodash/orderBy.js";

import { entryDedupeKey } from "./entryKey.js";
import type { ParsedEntry } from "../store/types.js";
import { MEMORY_SECTIONS } from "../store/types.js";

const SECTION_RANK = new Map(MEMORY_SECTIONS.map((section, index) => [section, index]));

/** Rule-based dedupe before optional LLM merge. Prefer user-authored on conflict. */
export function dedupeEntries(entries: ParsedEntry[]): ParsedEntry[] {
  const byKey = new Map<string, ParsedEntry>();

  for (const entry of entries) {
    const key = entryDedupeKey(entry);
    const existing = byKey.get(key);
    if (!existing || entry.userAuthored) {
      byKey.set(key, entry);
    }
  }

  return orderBy([...byKey.values()], [(entry) => SECTION_RANK.get(entry.section) ?? MEMORY_SECTIONS.length]);
}
