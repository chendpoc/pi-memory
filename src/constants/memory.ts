export const DEFAULT_MEMORY_FILE = "MEMORY.md";
export const MEMORY_GC_FILE = ".memory_gc";
export const COMPACTION_STATE_FILE = ".memory_compactions.json";
export const AUTO_FILE_PREFIX = "auto-";

export const OVERFLOW_POINTER_RE =
  /^-\s*\(overflow\)\s*→\s*(auto-[\w-]+\.md)\s*(?:<!--.*?-->)?\s*$/;

export const MEMORY_SECTIONS = ["Preferences", "Conventions", "Findings", "Todos"] as const;
export type MemorySection = (typeof MEMORY_SECTIONS)[number];

/** MEMORY.md line cap before spilling to auto-*.md. */
export const DEFAULT_MAX_LINES = 150;

/** Max chars for MEMORY.md fallback injection in preflight. */
export const DEFAULT_FALLBACK_MAX_CHARS = 8_000;

/** Consolidate triggers (OR). */
export const CONSOLIDATE_OVERFLOW_FILE_THRESHOLD = 12;
export const CONSOLIDATE_GC_INTERVAL_DAYS = 7;
