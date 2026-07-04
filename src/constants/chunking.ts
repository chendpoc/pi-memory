/** Max characters per vector chunk before splitting a Memory Entry. */
export const DEFAULT_CHUNK_MAX_CHARS = 512;

export const MIN_CHUNK_MAX_CHARS = 128;
export const MAX_CHUNK_MAX_CHARS = 4_000;

/** Values <= 0 disable splitting (one chunk per entry, still section-prefixed). */
export const CHUNKING_DISABLED_MAX_CHARS = 0;
