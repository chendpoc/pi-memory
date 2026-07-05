---
"@chendpoc/pi-memory": minor
---

Redact secrets before Ground Truth memory writes, and land the internal architecture refactor for 0.3.x.

### Added

- Secret and token redaction on incremental append paths via `prepareEntryForWrite` (Path A).

### Changed

- Extension lifecycle is orchestrated by `MemoryRuntime`; `pi-extension.ts` is a thin entry module.
- `MemoryStore` delegates to `writePath`, `ingestEntries`, and `ConsolidateStoreAccess`; consolidate merge no longer creates a store cycle.
- Sidecar owns `syncIndex` and `queryCache`; vec store internals are split for schema, query, reindex, and spawn lock handling.
- `/memory-status` formatting lives in shared `status/` for CLI and TUI.

### Fixed

- Preflight sidecar queries honour turn `AbortSignal` instead of waiting for the sidecar timeout.
- `appendMany` returns the actual number of entries written so shutdown drain stats and reindex triggers reflect dedupe/redaction skips.
