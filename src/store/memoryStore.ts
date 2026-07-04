import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { parseMemoryExport } from "../compact/parseMemoryExport.js";
import {
  filterCompactionDelta,
  shouldSkipSubagentCompactionIngest,
} from "../compact/subagentDelta.js";
import { dedupeEntries } from "../consolidate/mergeEntries.js";
import { mergeEntriesWithLlm } from "../consolidate/mergeWithLlm.js";
import { MarkdownMemoryBackend } from "./backend.js";
import {
  AUTO_FILE_PREFIX,
  COMPACTION_STATE_FILE,
  CONSOLIDATE_GC_INTERVAL_DAYS,
  CONSOLIDATE_OVERFLOW_FILE_THRESHOLD,
  DEFAULT_FALLBACK_MAX_CHARS,
  DEFAULT_MAX_LINES,
  DEFAULT_MEMORY_FILE,
  MEMORY_GC_FILE,
} from "../constants/memory.js";
import { MS_PER_DAY } from "../constants/timing.js";
import { countLines, formatEntryLine, formatSectionHeader } from "./markdown/format.js";
import { listOverflowPointers, parseMemoryMarkdown } from "./markdown/parse.js";
import { defaultMemoryTemplate } from "./markdown/template.js";
import { getAgentPaths, resolveAgentDir } from "./paths.js";
import type {
  IndexDocument,
  IntegrityReport,
  LlmClient,
  MemoryStats,
  MemoryStoreOptions,
  ParsedEntry,
  ResolvedMemory,
  StoreMemoryEntry,
} from "./types.js";
import { MEMORY_SECTIONS } from "./types.js";

type CompactionState = {
  processed: string[];
};

export class MemoryStore {
  private readonly paths: ReturnType<typeof getAgentPaths>;
  private readonly backend: MarkdownMemoryBackend;
  private readonly maxLines: number;
  private readonly fallbackMaxChars: number;
  private readonly syncToSidecarListeners = new Set<() => void>();
  private readonly consolidateCheckListeners = new Set<() => void>();
  private consolidating = false;

  constructor(opts: MemoryStoreOptions) {
    const agentDir = resolveAgentDir(opts.agentDir);
    this.paths = getAgentPaths(agentDir, opts.memoryFileName ?? DEFAULT_MEMORY_FILE);
    this.backend = new MarkdownMemoryBackend(this.paths.memoryFile);
    this.maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
    this.fallbackMaxChars = opts.defaultFallbackMaxChars ?? DEFAULT_FALLBACK_MAX_CHARS;
  }

  get agentDir(): string {
    return this.paths.agentDir;
  }

  async ensureInitialized(): Promise<void> {
    await this.backend.ensureAgentDir();
    const raw = await this.backend.readText(this.paths.memoryFile);
    if (!raw.trim()) {
      await this.backend.writeText(this.paths.memoryFile, defaultMemoryTemplate());
    }
  }

  async isEmpty(): Promise<boolean> {
    const entries = await this.listEntries();
    return entries.length === 0;
  }

  async getStats(): Promise<MemoryStats> {
    const raw = await this.readRaw();
    const entries = await this.listEntries();
    const overflowFileCount = (await this.backend.listAutoFiles(this.paths.agentDir)).length;
    const lastConsolidatedAt = await this.readGcTimestamp();
    return {
      lineCount: countLines(raw),
      overflowFileCount,
      entryCount: entries.length,
      lastConsolidatedAt,
    };
  }

  async readRaw(): Promise<string> {
    return this.backend.readText(this.paths.memoryFile);
  }

  async listEntries(): Promise<ParsedEntry[]> {
    const resolved = await this.readResolved();
    return resolved.entries;
  }

  async readResolved(): Promise<ResolvedMemory> {
    await this.ensureInitialized();
    const main = await this.backend.readText(this.paths.memoryFile);
    const entries = [...parseMemoryMarkdown(main, this.paths.memoryFile)];

    for (const fileName of listOverflowPointers(main)) {
      const path = this.backend.autoFilePath(this.paths.agentDir, fileName);
      const overflow = await this.backend.readText(path);
      entries.push(...parseMemoryMarkdown(overflow, path));
    }

    const autoFiles = await this.backend.listAutoFiles(this.paths.agentDir);
    for (const fileName of autoFiles) {
      if (listOverflowPointers(main).includes(fileName)) continue;
      const path = this.backend.autoFilePath(this.paths.agentDir, fileName);
      const orphan = await this.backend.readText(path);
      entries.push(...parseMemoryMarkdown(orphan, path));
    }

    return { content: main, entries };
  }

  async readForFallback(maxChars = this.fallbackMaxChars): Promise<string> {
    const resolved = await this.readResolved();
    if (resolved.entries.length === 0) return "";

    const blocks = resolved.entries.map((entry) => {
      const tag = entry.userAuthored ? "[user] " : "";
      return `- ${tag}${entry.content}`;
    });

    let text = blocks.join("\n");
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n…`;
  }

  async exportForIndex(): Promise<IndexDocument[]> {
    const resolved = await this.readResolved();
    return resolved.entries.map((entry) => ({
      id: entry.id,
      content: entry.content,
      source: basename(entry.sourceFile),
      timestamp: entry.timestamp,
    }));
  }

  async append(entry: StoreMemoryEntry): Promise<void> {
    await this.backend.withMemoryLock(async () => {
      await this.appendUnlocked(entry);
    });
    this.notifyAfterWrite();
  }

  async appendUser(entry: Omit<StoreMemoryEntry, "userAuthored">): Promise<void> {
    await this.backend.withMemoryLock(async () => {
      await this.appendUnlocked({ ...entry, userAuthored: true });
    });
    this.notifyAfterWrite();
  }

  async appendMany(entries: StoreMemoryEntry[], opts?: { mode?: "ifAbsent" }): Promise<void> {
    await this.backend.withMemoryLock(async () => {
      for (const entry of entries) {
        if (opts?.mode === "ifAbsent") {
          const added = await this.appendIfAbsentUnlocked(entry);
          if (!added) continue;
        } else {
          await this.appendUnlocked(entry);
        }
      }
    });
    if (entries.length > 0) this.notifyAfterWrite();
  }

  async appendIfAbsent(entry: StoreMemoryEntry): Promise<boolean> {
    let added = false;
    await this.backend.withMemoryLock(async () => {
      added = await this.appendIfAbsentUnlocked(entry);
    });
    if (added) this.notifyAfterWrite();
    return added;
  }

  /** Fire-and-forget: parse Memory Export from compact summary → appendIfAbsent. */
  appendFromCompaction(opts: {
    compactionId: string;
    summary: string;
    subagent?: boolean;
    onComplete?: () => void | Promise<void>;
  }): void {
    void this.ingestCompactionSummary(opts).catch(() => {});
  }

  private async ingestCompactionSummary(opts: {
    compactionId: string;
    summary: string;
    subagent?: boolean;
    onComplete?: () => void | Promise<void>;
  }): Promise<void> {
    if (await this.hasProcessedCompaction(opts.compactionId)) return;

    await this.ensureInitialized();
    const parsed = parseMemoryExport(opts.summary);

    if (opts.subagent) {
      const existing = await this.listEntries();
      const delta = filterCompactionDelta(parsed, existing);
      if (shouldSkipSubagentCompactionIngest(parsed, delta)) {
        await this.markCompactionProcessed(opts.compactionId);
        await opts.onComplete?.();
        return;
      }
      if (delta.length > 0) {
        await this.appendMany(delta, { mode: "ifAbsent" });
      }
    } else if (parsed.length > 0) {
      await this.appendMany(parsed, { mode: "ifAbsent" });
    }

    await this.markCompactionProcessed(opts.compactionId);
    await opts.onComplete?.();
  }

  async updateEntry(id: string, patch: Partial<StoreMemoryEntry>): Promise<void> {
    await this.backend.withMemoryLock(async () => {
      const resolved = await this.readResolvedUnlocked();
      const target = resolved.entries.find((entry) => entry.id === id);
      if (!target) throw new Error(`Memory entry not found: ${id}`);

      const next: StoreMemoryEntry = {
        ...target,
        ...patch,
        id: target.id,
        section: patch.section ?? target.section,
        content: patch.content ?? target.content,
        timestamp: patch.timestamp ?? target.timestamp,
        userAuthored: patch.userAuthored ?? target.userAuthored,
      };

      await this.rewriteEntriesUnlocked(resolved.entries.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)));
    });
    this.notifyAfterWrite();
  }

  async removeEntry(id: string, opts?: { force?: boolean }): Promise<void> {
    await this.backend.withMemoryLock(async () => {
      const resolved = await this.readResolvedUnlocked();
      const target = resolved.entries.find((entry) => entry.id === id);
      if (!target) return;
      if (target.userAuthored && !opts?.force) {
        throw new Error(`Cannot remove user-authored entry without force: ${id}`);
      }
      await this.rewriteEntriesUnlocked(resolved.entries.filter((entry) => entry.id !== id));
    });
    this.notifyAfterWrite();
  }

  async rewrite(content: string): Promise<void> {
    await this.backend.withMemoryLock(async () => {
      await this.backend.writeText(this.paths.memoryFile, content);
    });
    this.notifyAfterWrite({ skipConsolidateCheck: true });
  }

  async shouldConsolidate(now = new Date(), cronFired = false): Promise<boolean> {
    const stats = await this.getStats();
    if (stats.overflowFileCount >= CONSOLIDATE_OVERFLOW_FILE_THRESHOLD) return true;
    if (cronFired) return true;
    if (!stats.lastConsolidatedAt) return stats.entryCount > 0;
    const days = (now.getTime() - Date.parse(stats.lastConsolidatedAt)) / MS_PER_DAY;
    return days >= CONSOLIDATE_GC_INTERVAL_DAYS;
  }

  async consolidate(llm: LlmClient): Promise<void> {
    if (this.consolidating) return;

    this.consolidating = true;
    try {
      await this.backend.withMemoryLock(async () => {
        const resolved = await this.readResolvedUnlocked();
        let entries = dedupeEntries(resolved.entries);

        try {
          entries = await mergeEntriesWithLlm(entries, llm);
        } catch {
          // rule-based dedupe only
        }

        await this.rewriteEntriesUnlocked(entries);
        await writeFile(this.paths.memoryGcFile, `${new Date().toISOString()}\n`);
      });
      this.notifySyncToSidecar();
    } finally {
      this.consolidating = false;
    }
  }

  consolidateInBackground(
    llm: LlmClient,
    opts: { onComplete?: () => void | Promise<void> } = {},
  ): void {
    void this.consolidate(llm)
      .then(() => opts.onComplete?.())
      .catch(() => {});
  }

  async forceConsolidate(llm: LlmClient): Promise<void> {
    await this.consolidate(llm);
  }

  async hasProcessedCompaction(compactionId: string): Promise<boolean> {
    const state = await this.readCompactionState();
    return state.processed.includes(compactionId);
  }

  async markCompactionProcessed(compactionId: string): Promise<void> {
    const state = await this.readCompactionState();
    if (!state.processed.includes(compactionId)) {
      state.processed.push(compactionId);
    }
    await writeFile(this.paths.compactionStateFile, JSON.stringify(state, null, 2), "utf8");
  }

  async verifyIntegrity(): Promise<IntegrityReport> {
    const issues: string[] = [];
    const main = await this.backend.readText(this.paths.memoryFile);
    const pointers = listOverflowPointers(main);

    for (const fileName of pointers) {
      const path = this.backend.autoFilePath(this.paths.agentDir, fileName);
      try {
        await readFile(path, "utf8");
      } catch {
        issues.push(`Missing overflow file referenced by MEMORY.md: ${fileName}`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  /** Register a listener to sync MEMORY.md changes to the sidecar vector index. */
  onSyncToSidecar(listener: () => void): () => void {
    this.syncToSidecarListeners.add(listener);
    return () => this.syncToSidecarListeners.delete(listener);
  }

  /** Register a listener invoked after writes to check shouldConsolidate. */
  onConsolidateCheck(listener: () => void): () => void {
    this.consolidateCheckListeners.add(listener);
    return () => this.consolidateCheckListeners.delete(listener);
  }

  private notifyAfterWrite(opts?: { skipConsolidateCheck?: boolean }): void {
    this.notifySyncToSidecar();
    if (!opts?.skipConsolidateCheck && !this.consolidating) {
      this.notifyConsolidateCheck();
    }
  }

  private notifySyncToSidecar(): void {
    for (const listener of this.syncToSidecarListeners) listener();
  }

  private notifyConsolidateCheck(): void {
    for (const listener of this.consolidateCheckListeners) listener();
  }

  private async appendUnlocked(entry: StoreMemoryEntry): Promise<void> {
    const normalized = this.normalizeEntry(entry);
    const main = await this.backend.readText(this.paths.memoryFile);
    if (countLines(main) >= this.maxLines) {
      await this.appendToOverflowUnlocked(normalized, main);
      return;
    }

    const next = this.insertEntryIntoMarkdown(main, normalized);
    if (countLines(next) > this.maxLines) {
      await this.appendToOverflowUnlocked(normalized, main);
      return;
    }

    await this.backend.writeText(this.paths.memoryFile, next);
  }

  private async appendIfAbsentUnlocked(entry: StoreMemoryEntry): Promise<boolean> {
    const resolved = await this.readResolvedUnlocked();
    const exists = resolved.entries.some(
      (item) => item.section === entry.section && item.content.trim() === entry.content.trim(),
    );
    if (exists) return false;
    await this.appendUnlocked(entry);
    return true;
  }

  private async appendToOverflowUnlocked(entry: StoreMemoryEntry, main: string): Promise<void> {
    const autoFiles = await this.backend.listAutoFiles(this.paths.agentDir);
    let targetName = autoFiles.at(-1);
    let targetPath = targetName
      ? this.backend.autoFilePath(this.paths.agentDir, targetName)
      : this.newAutoFilePath();

    if (!targetName) {
      targetName = basename(targetPath);
      await this.backend.writeText(targetPath, `${formatSectionHeader(entry.section)}\n\n`);
    }

    let overflowContent = await this.backend.readText(targetPath);
    const line = formatEntryLine(entry);
    overflowContent = overflowContent.trimEnd() + `\n${line}\n`;
    await this.backend.writeText(targetPath, overflowContent);

    const pointer = `- (overflow) → ${targetName}`;
    if (!main.includes(pointer)) {
      const withPointer = `${main.trimEnd()}\n${pointer}\n`;
      await this.backend.writeText(this.paths.memoryFile, withPointer);
    }
  }

  private insertEntryIntoMarkdown(content: string, entry: StoreMemoryEntry): string {
    const lines = content.split("\n");
    const header = formatSectionHeader(entry.section);
    const headerIdx = lines.findIndex((line) => line.trim() === header);
    const line = formatEntryLine(entry);

    if (headerIdx === -1) {
      const trimmed = content.trimEnd();
      return `${trimmed}\n\n${header}\n\n${line}\n`;
    }

    let insertAt = headerIdx + 1;
    while (insertAt < lines.length && lines[insertAt]?.trim() === "") insertAt++;

    while (insertAt < lines.length) {
      const current = lines[insertAt]!;
      if (current.startsWith("## ")) break;
      insertAt++;
    }

    const next = [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)];
    return `${next.join("\n").trimEnd()}\n`;
  }

  private async rewriteEntriesUnlocked(entries: ParsedEntry[]): Promise<void> {
    const grouped = new Map<string, ParsedEntry[]>();
    for (const section of MEMORY_SECTIONS) grouped.set(section, []);
    for (const entry of entries) {
      grouped.get(entry.section)?.push(entry);
    }

    const lines: string[] = [];
    for (const section of MEMORY_SECTIONS) {
      lines.push(formatSectionHeader(section), "");
      for (const entry of grouped.get(section) ?? []) {
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

    await this.backend.writeText(this.paths.memoryFile, `${lines.join("\n").trimEnd()}\n`);
    const autoFiles = await this.backend.listAutoFiles(this.paths.agentDir);
    await Promise.all(
      autoFiles.map((fileName) =>
        this.backend.deleteAutoFile(this.backend.autoFilePath(this.paths.agentDir, fileName)),
      ),
    );
  }

  private async readResolvedUnlocked(): Promise<ResolvedMemory> {
    const main = await this.backend.readText(this.paths.memoryFile);
    const entries = [...parseMemoryMarkdown(main, this.paths.memoryFile)];
    for (const fileName of listOverflowPointers(main)) {
      const path = this.backend.autoFilePath(this.paths.agentDir, fileName);
      entries.push(...parseMemoryMarkdown(await this.backend.readText(path), path));
    }
    return { content: main, entries };
  }

  private normalizeEntry(entry: StoreMemoryEntry): StoreMemoryEntry {
    return {
      ...entry,
      id: entry.id || this.newEntryId(),
      timestamp: entry.timestamp || new Date().toISOString(),
    };
  }

  private newEntryId(): string {
    return randomBytes(6).toString("hex");
  }

  private newAutoFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    const suffix = randomBytes(3).toString("hex");
    return join(this.paths.agentDir, `${AUTO_FILE_PREFIX}${date}-${suffix}.md`);
  }

  private async readGcTimestamp(): Promise<string | null> {
    try {
      const raw = await readFile(this.paths.memoryGcFile, "utf8");
      return raw.trim() || null;
    } catch {
      return null;
    }
  }

  private async readCompactionState(): Promise<CompactionState> {
    try {
      const raw = await readFile(this.paths.compactionStateFile, "utf8");
      return JSON.parse(raw) as CompactionState;
    } catch {
      return { processed: [] };
    }
  }
}

export function createMemoryStore(opts: MemoryStoreOptions): MemoryStore {
  return new MemoryStore(opts);
}
