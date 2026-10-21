---
"@chendpoc/pi-memory": patch
---

Skip re-embedding unchanged memory files on reindex, and stop blocking session startup on the initial reindex.

Sidecar `reindex` now computes a content fingerprint (sha256 over sorted chunk ids + contents + embedder identity) and short-circuits when it matches the last full reindex, returning `skipped: "fingerprint_match"` instead of re-embedding every chunk. The first `runNow()` in `bootstrapSidecar` is fire-and-forget so `session_start` no longer waits on a full re-embed; preflight already falls back to MEMORY.md while the index rebuilds.

Measured with a 128-chunk memory file and the ollama `bge-m3` embedder: repeated reindex calls went from ~7.3-7.8s each to ~2ms, and session startup cost attributable to pi-memory dropped by roughly 7s per attach / new chat.
