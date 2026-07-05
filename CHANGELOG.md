# @chendpoc/pi-memory

## 0.3.0

### Minor Changes

- Redact secrets and tokens before Ground Truth writes (Path A via `prepareEntryForWrite`).
- Refactor extension lifecycle around `MemoryRuntime`; slim `MemoryStore` with `writePath`, `ingestEntries`, and consolidate decoupling.
- Extract shared `status/` module for CLI and `/memory-status` TUI widget.
- Split sidecar vec internals (`schema`, `chunkQuery`, `chunkReindex`, `embeddingCodec`) and `spawnLock`.

### Patch Changes

- Honour turn `AbortSignal` in sidecar IPC so cancelled Preflight queries do not wait for sidecar timeout.
- Return actual write counts from `appendMany` so shutdown drain stats and reindex triggers stay accurate.
- Replace `lodash` with `es-toolkit`.

## 0.2.4

### Breaking Changes

- Narrow the `@chendpoc/pi-memory` main export (`index.ts`): drop barrel re-exports of `constants/*`, `utils/*`, and sidecar IPC helpers. Public surface is now workspace bootstrap, agent-dir resolution, `MemoryStore` / `createMemoryStore`, maintenance jobs (`runConsolidateJob`, `runDrainShutdownQueueJob`), LLM adapter, and a small set of domain path/section constants.

### Patch Changes

- Add `pi.image` gallery metadata for the [Pi package catalog](https://pi.dev/packages/@chendpoc/pi-memory) preview.

## 0.2.3

### Patch Changes

- Ship compiled extension only: `pi.extensions` → `./dist/pi-extension.js`; drop `src/**/*.ts` from npm tarball.
- Add `tsconfig.dist.json` (no source maps / declaration maps) for publish builds; `prepare` skips rebuild when `dist/` is present.
- Remove `assets/pi-memory-logo.png`, `doc/`, and `UBIQUITOUS_LANGUAGE.md` from npm `files` (README logo uses GitHub raw URL).

## 0.2.2

### Patch Changes

- Document that `pi-memory init` runs automatically via postinstall and first session; manual init is optional.
- Add package logo asset and polish README/README-zh (branding, `pi install npm:` path, runtime choices).

## 0.2.1

### Patch Changes

- Preflight latency: split `forceEpisodic` / `forceIntent`, on-demand QueryIntent (default 0 retries), sidecar warm start, and per-session intent LRU cache.
- Add `PI_MEMORY_INTENT_RETRIES`, `PI_MEMORY_WARM_SIDECAR`, and `PI_MEMORY_INTENT_CACHE` env toggles.
- Skip episodic Preflight when MEMORY is empty; debug logs include `intent_skipped` and `intent_cache_hit`.
- Rewrite README with positioning, before/after agent behavior, competitor comparison, and roadmap; add `doc/README-zh.md`, `doc/ROADMAP.md`, and `doc/ROADMAP-zh.md`.

## 0.2.0

### Minor Changes

- Rewrite episodic memory around **MEMORY.md ground truth**, a **UDS JSONL sidecar** (`memory.vec.sqlite`), and **Preflight** injection before each user turn.
- Add **`pi-memory init`**, **`pi-memory status`**, **`/memory-status`**, and **`/remember`** for workspace bootstrap and diagnostics.
- Add **`pi-memory maintenance --cron`** to run consolidate then **drain the shutdown queue** (`.memory_shutdown_queue.jsonl`) in one scheduler window; templates updated for cron / launchd / schtasks.
- Split long Memory Entry bodies into vector **chunks** (default `PI_MEMORY_CHUNK_MAX_CHARS=512`).
- Tune vector retrieval defaults: **top-3**, **MMR λ=0.8**, **min relevance 0.4**; override via `PI_MEMORY_TOP_K`, `PI_MEMORY_MMR_LAMBDA`, `PI_MEMORY_MIN_RELEVANCE`.
- Refactor Preflight to a shared **800ms budget** (`PI_MEMORY_PREFLIGHT_BUDGET_MS`) split between QueryIntent and sidecar query.
- Detect embedding model changes and **rebuild the vector index**; LRU **query cache** invalidated on reindex.
- Subagent sessions: **Memory Cap only** (skip episodic Preflight); compact delta ingest on shutdown metadata queue.

### Patch Changes

- Fix `/memory-status` embedder comparison to use the same factory as the sidecar (`hash/dev`, 768d).
- Move `@earendil-works/pi-tui` to devDependencies in the lockfile.
- Require **Node.js >=24** (see `engines` in package.json).

## 0.1.13

### Patch Changes

- [`7dd7ba5`](https://github.com/Facefall/pi-memory/commit/7dd7ba513e64014ccbd1382ace795fe1c18116b4) Thanks [@Facefall](https://github.com/Facefall)! - Add offline Write → Consolidate → Retrieve loop: session enqueue on shutdown, stage1/phase2 pipeline, MEMORY.md indexing, OS scheduler, and `/memory --verbose` diagnostics.
