# @chendpoc/pi-memory Roadmap

<p align="center">
  <a href="ROADMAP.md">English</a> |
  <a href="ROADMAP-zh.md">简体中文</a>
</p>

This roadmap tracks product direction for `@chendpoc/pi-memory`. The README stays focused on positioning, installation, and the current architecture.

## Current Foundation

- `MEMORY.md` Ground Truth with overflow.
- `/remember` and `/memory-status`.
- Sidecar over UDS JSONL.
- `memory.vec.sqlite` vector index.
- QueryIntent with raw-query fallback.
- 800ms shared Preflight budget with AbortSignal-aware sidecar query.
- Warm sidecar, intent cache, query cache.
- Dual-purpose compaction summary.
- Shutdown Queue + `maintenance`.
- Consolidate + reindex.
- Subagent Memory Cap + Compact Delta.
- Secret redaction before Ground Truth writes (Path A).
- `MemoryRuntime` extension lifecycle and refactored store/sidecar modules.

## P0: Trust And Safety

**Target: 0.3.x** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/1)

- ✅ Secret and token redaction before memory writes (design: [`dev-doc/redaction-design.md`](../dev-doc/redaction-design.md)) — **shipped in 0.3.0**.
- ✅ Module architecture refactor: dedupe shared logic, slim MemoryStore, unified ingest pipeline (plan: [`dev-doc/architecture-refactor-plan.md`](../dev-doc/architecture-refactor-plan.md)) — **shipped in 0.3.0**.
- Prompt-injection guardrails for LLM-generated Memory Export.
- Correction detector for explicit user corrections (design: [`dev-doc/remember-correction-design.md`](../dev-doc/remember-correction-design.md) — scoped to the `/remember` path; **not implemented yet**).
- Better diagnostics for skipped writes and fallback reasons.

## P1: Recall Quality

**Target: 0.4.x** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/2)

- Hybrid lexical + vector recall for `MEMORY.md` entries (planned: **SQLite FTS5** virtual table alongside existing `memory_chunks` embeddings, RRF merge inside the sidecar, then MMR; see [`dev-doc/fts5-hybrid-recall-design.md`](../dev-doc/fts5-hybrid-recall-design.md), tracked in [issue #6](https://github.com/chendpoc/pi-memory/issues/6)).
- Recall eval fixtures for common coding-agent questions ([#7](https://github.com/chendpoc/pi-memory/issues/7)).
- Debug metrics split by intent, embed, scan, MMR, render ([#8](https://github.com/chendpoc/pi-memory/issues/8)).
- Optional reranker after MMR when latency budget allows ([#9](https://github.com/chendpoc/pi-memory/issues/9), nice-to-have).
- Local embedding provider improvements beyond Ollama.

## P2: Memory Lifecycle

**Target: 0.5.x** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/3)

- Failure and tool-quirk categories.
- Human-reviewable memory draft or diary before promotion.
- Usage-weighted promotion and pruning.
- Safer consolidate previews before rewrite.
- Explicit stale fact handling instead of simple TODO pruning.

## P3: Product Surface

**Target: 1.0** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/4)

- Better TUI status panel.
- Memory edit/review commands.
- Import/export between Pi installations.
- Documentation recipes for common Pi setups.
