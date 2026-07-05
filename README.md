<p align="center">
  <img src="https://raw.githubusercontent.com/chendpoc/pi-memory/main/assets/pi-memory-logo.png" alt="pi-memory logo" width="720" />
</p>

# @chendpoc/pi-memory

<p align="center">
  <a href="README.md">English</a> |
  <a href="doc/README-zh.md">简体中文</a>
</p>

Cross-session episodic memory for the [Pi coding agent](https://pi.dev).

`pi-memory` gives Pi a local, auditable memory layer across sessions. It keeps durable facts in **`MEMORY.md` as the source of truth**, derives a vector index in `memory.vec.sqlite`, and injects relevant private context through Preflight before the main model answers.

## 🧠 What It Does

Pi already has compaction for long sessions. That solves "this conversation is too long"; it does not solve "a new session forgot my preferences, project conventions, prior decisions, and unresolved todos."

`pi-memory` fills that gap:

```text
durable facts -> MEMORY.md -> derived vector index -> per-turn Preflight recall
```

It provides:

- ✍️ **Explicit memory** through `/remember`.
- 🔁 **Automatic durable fact export** from Pi compaction.
- 📥 **Shutdown queue recovery** for short or missed sessions.
- 🔦 **Per-turn private recall** before the main model runs.
- 📄 **Human-editable storage** in Markdown, with vector search as a rebuildable index.
- 🔌 **Local UDS sidecar** for vector retrieval and reindexing, without opening an HTTP port.
- ⏳ **Daemon-friendly maintenance**: shutdown enqueues metadata, while consolidation and queue draining can run offline.

## 📦 Installation

Requirements:

- Node.js `>=24 <25`
- pnpm
- Pi extension runtime packages supplied by Pi

Install from Pi:

```bash
pi install npm:@chendpoc/pi-memory
```

For local development from this repository:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Enable the extension through Pi's extension loading mechanism. This package declares:

```json
{
  "pi": {
    "extensions": ["./dist/pi-extension.js"]
  }
}
```

Published npm packages ship precompiled `dist/`; `pi install npm:@chendpoc/pi-memory` loads the compiled extension entry directly.

### 🌱 Memory workspace (automatic)

You usually **do not need to run `pi-memory init` manually**. The same bootstrap (`initializeMemoryWorkspace`) runs automatically and **never overwrites a non-empty `MEMORY.md`**:

| When | What happens |
| --- | --- |
| **`pnpm install`** | `postinstall` runs `pi-memory init` (or a pre-build fallback) |
| **First Pi session** | `session_start` → `MemoryStore.ensureInitialized()` |
| **Manual (optional)** | `pi-memory init` |

Run `pi-memory init` explicitly only when:

- You set **`PI_MEMORY_AGENT_DIR`** after install (postinstall may have seeded the default path).
- Install scripts were skipped (`--ignore-scripts` or corporate policy).
- You want to bootstrap before opening Pi, or verify setup with `pi-memory status`.

```bash
pi-memory init   # optional; see above
```

## ✨ Why Choose `pi-memory`

### 🔄 Agent Before / After

| Situation | Without `pi-memory` | With `pi-memory` |
| --- | --- | --- |
| New session asks "continue the plan from last time" | Agent has to ask for context or guess from the current repo. | Preflight recalls matching `MEMORY.md` facts and injects private reference context. |
| User says "remember that this repo uses Vitest" | The fact may stay only in the current session summary. | `/remember` writes a `[user]` entry that consolidate must preserve. |
| Long session compacts | Compaction helps continue that session but does not create durable cross-session facts. | One dual-purpose compact summary keeps session context and exports durable facts. |
| Subagent is spawned | It may over-recall or duplicate the parent session's memory writes. | Subagents get Memory Cap only and write Compact Delta facts. |
| Vector sidecar is down | A hard dependency would break the turn. | Preflight silently falls back to Markdown or injects nothing; the model still runs. |
| Memory grows | A file can become noisy and unbounded. | 150-line `MEMORY.md` cap, `auto-*.md` overflow, consolidate merge/dedupe. |

### 🌟 Key Advantages

- 📓 **Markdown Ground Truth**: `MEMORY.md` and `auto-*.md` can be opened, reviewed, edited, grepped, copied, or versioned.
- 🏗️ **Derived index, not hidden state**: `memory.vec.sqlite` can be deleted and rebuilt from Markdown.
- 🔎 **Preflight recall**: Memory is injected before the main model answers instead of hoping the model calls a search tool.
- ⏱️ **Hot-path budget**: Default Preflight budget is **800ms**, with QueryIntent, sidecar query, and fallback all bounded.
- 🔒 **Protected user notes**: `/remember` writes `[user]` entries that consolidate must not remove or rewrite.
- 🛡️ **Secret redaction on write**: API keys and tokens are stripped at the `prepareEntryForWrite` gate before they reach `MEMORY.md` or the vector index.
- 🔗 **UDS, not HTTP**: the agent talks to the sidecar over `node:net` Unix domain sockets with JSONL frames, so there is no local HTTP server or port to secure.
- 🏭 **Sidecar process isolation**: embedding, vector scan, MMR, stats, and reindex run in a spawned Node process, while writes stay owned by `MemoryStore`.
- 💤 **Daemon-safe writes**: `session_shutdown` only appends metadata; heavier consolidation and shutdown-queue draining are intended for `pi-memory maintenance` or background scheduling.
- 👥 **Subagent policy**: root sessions get Memory Cap + Episodic Preflight; subagents get Memory Cap only by default.
- ☂️ **Graceful fallback**: if sidecar recall is empty, timed out, or unavailable, the turn still runs.

### ⚙️ Runtime Choices

| Choice | Why it matters |
| --- | --- |
| `MEMORY.md` as Ground Truth | Durable memory remains inspectable and editable instead of becoming opaque database state. |
| UDS JSONL over `node:net` | Local IPC stays private to the machine, avoids HTTP ports, and keeps request/response framing simple. |
| Spawned sidecar process | Vector query/reindex work is isolated from the Pi extension process; failures degrade to Markdown fallback. |
| Offline `maintenance` job | Consolidation and shutdown-queue draining can run outside the interactive agent turn. |
| Bounded Preflight | QueryIntent, sidecar query, cache, and fallback all share a tight latency budget. |

### ⚖️ Comparison

`pi-memory` is not trying to be every memory system. The value is a specific Pi-native loop: Markdown ground truth, Preflight injection, sidecar retrieval, compaction export, and offline maintenance.

| System | Strength | Difference From `@chendpoc/pi-memory` |
| --- | --- | --- |
| Cursor Rules / OpenCode `AGENTS.md` | Static project instructions, predictable injection. | Mostly user-authored rules; no automatic durable fact extraction or per-turn episodic Preflight. |
| Claude Code Auto Memory | Agent can write local memory files. | File-based memory, but no sidecar vector recall or Pi compact/shutdown integration. |
| `pi-hermes-memory` | Rich Pi package with FTS5, failure memory, correction learning, security scanning. | More automated and feature-heavy; no `<private_memory>` Preflight loop or sidecar-derived vector index. |
| OpenClaw memory-core | Mature file + index design, dreaming, hybrid search, local embeddings. | Broader memory platform; `pi-memory` is narrower and Pi-extension focused. |
| Mem0 / Zep | Managed memory APIs with hybrid search, graph, temporal modeling. | Stronger retrieval infrastructure, but external service/database oriented and not Markdown-ground-truth first. |
| Letta | Context engineering with git-backed memory repos and sleep-time compute. | Powerful for autonomous memory management; heavier mental model than Pi's extension lifecycle. |
| Cognee | Knowledge engine with graph/vector/relational stores and many retrieval modes. | Better for knowledge graphs; overkill for lightweight coding-agent preferences and conventions. |

Where other systems are stronger:

- `pi-hermes-memory`: failure memory, correction detector, tool quirks, secret scanning.
- OpenClaw: dreaming stages, memory wiki, hybrid FTS/vector search, local embedding providers.
- Zep/Cognee: temporal graph reasoning and multi-hop graph retrieval.
- Mem0: hosted multi-tenant memory API.
- Letta: autonomous context repositories and sleep-time memory work.

## ⚙️ How It Works

### 🏗️ Architecture

```text
Pi extension process (MemoryRuntime)
  |- session_start
  |    |- initialize MEMORY.md
  |    |- start/warm sidecar
  |    |- reindex derived vector index
  |    `- preload Memory Cap
  |
  |- before_agent_start / context
  |    `- Preflight recall (AbortSignal-aware sidecar query) -> <private_memory>
  |
  |- /remember
  |    `- append [user] Memory Entry
  |
  |- session_before_compact / session_compact
  |    `- dual-purpose summary -> Memory Export ingest
  |
  |- session_shutdown
  |    `- append shutdown metadata only
  |
  `- consolidate scheduler
       `- merge/dedupe -> rewrite Ground Truth -> reindex

Sidecar process over UDS JSONL (`node:net`, no HTTP port)
  |- ping
  |- stats
  |- query: embed -> cosine scan -> MMR
  `- reindex: upsert chunks into memory.vec.sqlite
```

### 🔎 Read Path

Root session:

```text
Memory Cap from Ground Truth
  + Episodic Preflight for the current user message
  -> merged <private_memory>
```

Subagent session:

```text
Memory Cap only
  -> no episodic QueryIntent / sidecar query by default
```

Fallback chain:

```text
Sidecar results
  -> if empty/error/timeout: MEMORY.md fallback
  -> if empty: no injection
```

### ✍️ Write Paths

| Path | Trigger | LLM? | Blocking? | Purpose |
| --- | --- | --- | --- | --- |
| `/remember` | User command | No | Yes | Explicit durable note |
| Compaction | `session_before_compact` + `session_compact` | One summary call | Summary blocks; ingest is background | Continue current session and export durable facts |
| Shutdown Queue | `session_shutdown` + `pi-memory maintenance` | Only offline, when no compaction summary exists | No during shutdown | Recover facts from short or missed sessions |
| Consolidate | overflow >= 12, 7 days, or daily cron | Optional | Offline/background | Dedupe, merge, prune obsolete todos |

## 💾 Data And Memory Format

All artifacts live under one memory agent directory.

Resolution order:

1. `--agent-dir` CLI flag
2. `PI_MEMORY_AGENT_DIR`
3. default `~/.pi/pi-memory-data`

| File | Role |
| --- | --- |
| `MEMORY.md` | Ground Truth file |
| `auto-*.md` | Overflow files after the 150-line cap |
| `.memory_gc` | Last consolidate timestamp |
| `.memory_compactions.json` | Compaction idempotency state |
| `.memory_shutdown_queue.jsonl` | Append-only shutdown metadata |
| `.memory_shutdown_processed.json` | Drain idempotency state |
| `memory.vec.sqlite` | Derived Vector Index |
| `memory.sock` | Sidecar Unix domain socket |

Canonical scaffold: [`templates/MEMORY.md.example`](./templates/MEMORY.md.example)

```markdown
# Memory

## Preferences

## Conventions

## Findings

## Todos
```

Entries are single Markdown bullets:

```markdown
- [user] Prefer pnpm over npm <!-- id:abc123 user ts:2026-07-04T09:00:00.000+08:00 -->
- Project tests use Vitest <!-- id:def456 ts:2026-07-04T09:05:00.000+08:00 -->
```

Rules:

- `/remember` writes `[user]` entries.
- Consolidate must not remove or rewrite `[user]` entries.
- `MEMORY.md` is capped at 150 lines.
- Overflow entries spill to `auto-*.md`, with a pointer in `MEMORY.md`.
- Vector chunks are derived from entries; by default long entries split beyond `PI_MEMORY_CHUNK_MAX_CHARS=512`.

## 🎛️ Configuration

Optional env file locations are loaded in this order:

1. `PI_MEMORY_ENV_FILE`
2. project `.env`
3. project `.env.local`
4. `~/.pi/agent/pi-memory.env`

Common variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PI_MEMORY_AGENT_DIR` | `~/.pi/pi-memory-data` | Memory data root |
| `PI_MEMORY_EMBEDDER` | `hash` | `hash`, `ollama`, or `openai` |
| `PI_MEMORY_HELPER_MODEL` | `deepseek/deepseek-v4-flash` | Helper model spec for QueryIntent and consolidate |
| `PI_MEMORY_PREFLIGHT_BUDGET_MS` | `800` | Shared Preflight budget, clamped to 250-1500ms |
| `PI_MEMORY_INTENT_RETRIES` | `0` | Helper LLM retries after the first attempt |
| `PI_MEMORY_WARM_SIDECAR` | `1` | Warm sidecar at `session_start` |
| `PI_MEMORY_INTENT_CACHE` | `1` | Cache QueryIntent per session |
| `PI_MEMORY_REINDEX_DEBOUNCE_MS` | `500` | Debounce sidecar reindex after writes |
| `PI_MEMORY_TOP_K` | `3` | Vector recall result count |
| `PI_MEMORY_MMR_LAMBDA` | `0.8` | MMR relevance/diversity balance |
| `PI_MEMORY_MIN_RELEVANCE` | `0.4` | Minimum cosine similarity |
| `PI_MEMORY_CHUNK_MAX_CHARS` | `512` | Split long entries for indexing; `0` disables |
| `PI_MEMORY_DEBUG` | unset | `1` prints debug timing logs |

See [`.env.example`](./.env.example) for the full list.

### 🛰️ Embedders

| Embedder | Use When | Notes |
| --- | --- | --- |
| `hash` | Zero-config local development | Offline, deterministic, lower semantic quality |
| `ollama` | Local semantic embeddings | Uses `PI_MEMORY_OLLAMA_BASE_URL` and `PI_MEMORY_OLLAMA_EMBED_MODEL` |
| `openai` | Higher-quality cloud embeddings | Requires `PI_MEMORY_OPENAI_API_KEY` or `OPENAI_API_KEY` |

The Vector Index stores embedding provider, model, and dimension metadata. When they change, old chunks are cleared and rebuilt.

## ⌨️ Commands

Inside Pi:

```text
/remember [section] <content>
/memory-status [refresh|expand|collapse|hide]
```

CLI:

```bash
pi-memory status
pi-memory maintenance --cron --verbose
pi-memory consolidate --force --verbose
pi-memory drain-shutdown-queue --verbose
pi-memory init   # optional — usually automatic after install + first session
```

`maintenance` is the recommended scheduler entrypoint:

```text
consolidate -> drain-shutdown-queue
```

Scheduler templates:

- [`templates/com.pi.memory.consolidate.plist.example`](./templates/com.pi.memory.consolidate.plist.example)
- [`templates/crontab.example`](./templates/crontab.example)
- [`templates/consolidate.cmd.example`](./templates/consolidate.cmd.example)
- [`templates/schtasks.example.txt`](./templates/schtasks.example.txt)

## 🩺 Diagnostics

Use `/memory-status` or `pi-memory status` to inspect:

- memory agent directory
- `MEMORY.md` line count
- entry count
- overflow count
- last consolidate timestamp
- sidecar socket status
- vector index generation and chunk count
- configured embedder
- index embedder mismatch

Use `PI_MEMORY_DEBUG=1` to log Preflight timings:

```json
{
  "phase": "preflight",
  "event": "recall",
  "intent_ms": 0,
  "intent_skipped": true,
  "intent_cache_hit": false,
  "sidecar_ms": 42,
  "cache_hit": true,
  "total_ms": 45,
  "fallback": false,
  "results": 3
}
```

## 🚫 Non-Goals

- Replacing Pi compaction.
- Replacing session search; use a dedicated session-search extension for old conversations.
- Maintaining a graph database inside this package.
- Making the sidecar authoritative.
- Storing full chat transcripts as memory.
- Adding multi-second reflection to every user turn.

## 🛠️ Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

The sidecar IPC test opens a Unix domain socket. If it fails with `listen EPERM` inside a restricted sandbox, run the test in a normal local shell.

## 📚 Docs

- [Chinese README](./doc/README-zh.md)
- [Roadmap](./doc/ROADMAP.md)
- [Architecture refactor plan](./dev-doc/architecture-refactor-plan.md)
- [UBIQUITOUS_LANGUAGE.md](./UBIQUITOUS_LANGUAGE.md) - domain glossary

## 📜 License

MIT
