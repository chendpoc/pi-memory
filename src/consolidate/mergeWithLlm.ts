import keyBy from "lodash/keyBy.js";

import type { LlmClient } from "../adapters/llm/types.js";
import { parseMemoryMarkdown } from "../store/markdown/parse.js";
import type { ParsedEntry } from "../store/types.js";
import { entryDedupeKey } from "./entryKey.js";
import { buildConsolidateMergePrompt, formatEntriesForConsolidation } from "./mergePrompt.js";
import { dedupeEntries } from "./mergeEntries.js";

function preserveUserAuthored(original: ParsedEntry[], merged: ParsedEntry[]): ParsedEntry[] {
  const userByContent = keyBy(
    original.filter((entry) => entry.userAuthored),
    entryDedupeKey,
  );

  return merged.map((entry) => {
    const user = userByContent[entryDedupeKey(entry)];
    if (user) {
      return { ...entry, id: user.id, userAuthored: true, timestamp: user.timestamp };
    }
    return entry;
  });
}

export async function mergeEntriesWithLlm(
  entries: ParsedEntry[],
  llm: LlmClient,
  signal?: AbortSignal,
): Promise<ParsedEntry[]> {
  const deduped = dedupeEntries(entries);
  if (deduped.length === 0) return deduped;

  const prompt = buildConsolidateMergePrompt(formatEntriesForConsolidation(deduped));
  const raw = await llm.complete(prompt, signal);
  const parsed = parseMemoryMarkdown(raw, "consolidate-llm");
  if (parsed.length === 0) return deduped;

  return preserveUserAuthored(deduped, parsed);
}
