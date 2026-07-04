# @chendpoc/pi-memory

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
