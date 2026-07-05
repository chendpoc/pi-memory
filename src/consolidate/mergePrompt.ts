import { groupBy } from "es-toolkit";

import type { ParsedEntry } from "../store/types.js";
import { formatEntryLine, formatSectionHeader } from "../store/markdown/format.js";
import { MEMORY_SECTIONS } from "../store/types.js";

export function formatEntriesForConsolidation(entries: ParsedEntry[]): string {
  const grouped = groupBy(entries, (entry) => entry.section);
  const lines: string[] = [];

  for (const section of MEMORY_SECTIONS) {
    const sectionEntries = grouped[section] ?? [];
    if (sectionEntries.length === 0) continue;
    lines.push(formatSectionHeader(section), "");
    for (const entry of sectionEntries) {
      lines.push(
        formatEntryLine({
          id: entry.id,
          section: entry.section,
          content: entry.content,
          userAuthored: entry.userAuthored,
          timestamp: entry.timestamp,
        }),
      );
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function buildConsolidateMergePrompt(entriesMarkdown: string): string {
  return `You are consolidating a durable MEMORY.md note file for a coding agent.

Merge the entries below:
- Remove exact duplicates and near-duplicates (keep the clearer wording).
- Remove completed or obsolete TODO items.
- NEVER remove or rewrite lines marked [user] (user-authored).
- Keep Preferences, Conventions, Findings, and Todos factual and concise.
- Output ONLY valid markdown with sections: ## Preferences, ## Conventions, ## Findings, ## Todos
- Each item is a bullet line using the same format as input (with <!-- id:... --> metadata when present).

<memory>
${entriesMarkdown}
</memory>`;
}
