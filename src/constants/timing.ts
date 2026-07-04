export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** HTTP / LLM adapters. */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_LLM_COMPAT_TIMEOUT_MS = 120_000;

/** Preflight episodic retrieval. */
export const DEFAULT_PREFLIGHT_TIMEOUT_MS = 800;

/** Debounced sidecar reindex after MEMORY writes. */
export const DEFAULT_REINDEX_DEBOUNCE_MS = 500;

/** Debounced consolidate check after MEMORY writes. */
export const DEFAULT_CONSOLIDATE_DEBOUNCE_MS = 2_000;

/** Session-alive periodic shouldConsolidate tick (7-day catch-up). */
export const DEFAULT_CONSOLIDATE_CHECK_INTERVAL_MS = MS_PER_DAY;

/** OS scheduler daily consolidate slot. */
export const CONSOLIDATE_CRON_HOUR = 3;
export const CONSOLIDATE_CRON_MINUTE = 0;

/** Sidecar process lifecycle. */
export const SIDECAR_START_TIMEOUT_MS = 5_000;
export const SIDECAR_SPAWN_LOCK_STALE_MS = 10_000;
export const SIDECAR_FORCE_KILL_DELAY_MS = 5_000;

/** Sidecar client RPC timeouts. */
export const SIDECAR_PING_TIMEOUT_MS = 1_000;
export const SIDECAR_QUERY_TIMEOUT_MS = 3_000;
export const SIDECAR_REINDEX_TIMEOUT_MS = 10_000;

/** proper-lockfile on MEMORY.md. */
export const MEMORY_LOCK_RETRIES = 5;
export const MEMORY_LOCK_MIN_TIMEOUT_MS = 100;
export const MEMORY_LOCK_MAX_TIMEOUT_MS = 500;
