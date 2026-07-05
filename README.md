<p align="center">
  <img src="https://raw.githubusercontent.com/chendpoc/pi-memory/main/assets/pi-memory-logo.png" alt="pi-memory logo" width="720" />
</p>

# @chendpoc/pi-memory

<p align="center">
  <a href="README.md">English</a> |
  <a href="doc/README-zh.md">简体中文</a>
</p>

Local memory for the [Pi coding agent](https://pi.dev), so Pi can remember your preferences, project conventions, decisions, and open todos across sessions.

`pi-memory` keeps long-lived notes in local Markdown, recalls the relevant ones before Pi answers, and redacts common secrets before they are saved. The goal is simple: a new Pi session should start with the context you meant it to remember, without turning memory into an opaque hosted service.

## 🧠 What It Does

Pi already has compaction for long sessions. That helps continue a long conversation; it does not make a future session remember your stable preferences, project rules, prior decisions, or unresolved todos.

`pi-memory` fills that gap:

```text
things worth remembering -> local Markdown memory -> private context for future turns
```

It provides:

- ✍️ **Save explicit notes** with `/remember`.
- 🔁 **Carry durable facts forward** from Pi compaction.
- 📥 **Recover useful facts from short sessions** with shutdown queue draining.
- 🔦 **Recall relevant memory before each answer**, privately and automatically.
- 🛡️ **Redact common secrets and tokens before saving memory**.
- 📄 **Keep memory inspectable and editable** in Markdown.
- ☂️ **Degrade gracefully** when recall is unavailable, so Pi can keep working.
- ⏳ **Keep maintenance out of the interactive turn** with offline cleanup jobs.

## 🚀 What's New in 0.3.0

- **Safer memory writes**: common API keys, bearer tokens, private keys, service-account JSON, connection URLs, and `.env`-style secrets are redacted before memory is saved.
- **More reliable recall**: when a Pi turn is cancelled, memory lookup is cancelled with it instead of waiting for an internal timeout.
- **Clearer status and maintenance output**: `/memory-status`, `pi-memory status`, queue draining, and reindex triggers now report more consistent counts.
- **Healthier foundation for future releases**: internals were simplified and split into smaller pieces. This is mostly a maintainer-facing change, but it reduces the risk of future feature work.

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

You usually **do not need to run `pi-memory init` manually**. The memory workspace is prepared automatically and **never overwrites a non-empty `MEMORY.md`**:

| When | What happens |
| --- | --- |
| **`pnpm install`** | `postinstall` runs `pi-memory init` (or a pre-build fallback) |
| **First Pi session** | Pi verifies or creates the memory workspace |
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
| Subagent is spawned | It may inherit too much context or duplicate the parent session's memory writes. | Subagents receive a smaller scoped memory view by default, reducing noise and duplicate writes. |
| Memory recall is unavailable | A hard dependency would break the turn. | Pi falls back to Markdown or no memory injection; the model still runs. |
| Memory grows | A file can become noisy and unbounded. | 150-line `MEMORY.md` cap, `auto-*.md` overflow, consolidate merge/dedupe. |

### 🌟 Key Advantages

- 📓 **Auditable memory**: `MEMORY.md` and `auto-*.md` can be opened, reviewed, edited, grepped, copied, or versioned.
- 🔎 **Context appears before the answer**: Pi gets relevant private memory before the main model responds, so you do not have to manually paste old context.
- 🔒 **User notes stay protected**: `/remember` entries are marked as user-authored and consolidation must preserve them.
- 🛡️ **Safer by default**: common secrets and tokens are replaced before they reach durable memory.
- ☂️ **No hard dependency on recall**: if memory recall is empty, slow, or unavailable, the turn still runs.
- 💤 **Less interruption**: heavier cleanup runs through maintenance jobs instead of blocking ordinary Pi turns.
- 🧹 **Bounded growth**: the main memory file stays capped, overflow goes into reviewable files, and consolidation merges duplicates.
- 👥 **Subagent-aware behavior**: root sessions get fuller recall; subagents use a smaller memory view by default to reduce noise.

### ⚖️ Comparison

`pi-memory` is not trying to be every memory system. The value is a specific Pi-native loop: local Markdown memory, private recall before answers, compaction export, and offline maintenance.

| System | Strength | Difference From `@chendpoc/pi-memory` |
| --- | --- | --- |
| Cursor Rules / OpenCode `AGENTS.md` | Static project instructions, predictable injection. | Mostly user-authored rules; no automatic durable fact extraction or memory recall before every answer. |
| Claude Code Auto Memory | Agent can write local memory files. | File-based memory, but no Pi-specific compaction/shutdown integration or private recall-before-answer loop. |
| `pi-hermes-memory` | Rich Pi package with FTS5, failure memory, correction learning, security scanning. | More automated and feature-heavy; `pi-memory` is narrower, more Markdown-first, and focused on private pre-answer recall. |
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

### ⚙️ Technical Notes

These choices are mainly useful for operators and contributors. They explain how the user-facing behavior stays local, inspectable, and bounded.

| Choice | Why it matters |
| --- | --- |
| `MEMORY.md` as Ground Truth | Durable memory remains inspectable and editable instead of becoming opaque database state. |
| UDS JSONL over `node:net` | Local IPC stays private to the machine, avoids HTTP ports, and keeps request/response framing simple. |
| Spawned sidecar process | Vector query/reindex work is isolated from the Pi extension process; failures degrade to Markdown fallback. |
| Offline `maintenance` job | Consolidation and shutdown-queue draining can run outside the interactive agent turn. |
| Bounded Preflight | QueryIntent, sidecar query, cache, and fallback all share a tight latency budget. |

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

### 🛡️ What Redaction Covers

`pi-memory` 0.3.0 redacts likely secrets before durable memory entries are written. This applies to every incremental write path that can persist to `MEMORY.md`, `auto-*.md`, or the derived vector index.

Covered write paths:

- `/remember`
- `append` / `appendUser` / `appendIfAbsent` / `appendMany`
- compaction `Memory Export` ingest
- shutdown queue drain ingest

The MVP focuses on **secrets and tokens**, including common API keys, bearer/JWT values, private-key blocks, service-account JSON, connection URLs, basic-auth URLs, and `.env`-style secret assignments. Matches are replaced with `[REDACTED]`; if nothing meaningful remains after redaction, the memory write is skipped instead of persisting a lone placeholder.

Current boundaries:

- Redaction is applied to **durable memory entries**, not full Pi session JSONL or LLM request bodies.
- Existing historical `MEMORY.md` content is not rewritten automatically.
- PII detection is intentionally out of scope for 0.3.0.
- Debug logs report hit counts and policy version only; they do not print matched secret material.

For contributors, the shared write gate is `prepareEntryForWrite`.

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
| `logs/maintenance.log` | Scheduled `maintenance --cron` stdout log |
| `logs/maintenance.err.log` | Scheduled maintenance stderr log (launchd / Windows) |

The `logs/` directory is created automatically on **extension `session_start`**, `pi-memory init`, or CLI `maintenance`/`consolidate` — no manual `mkdir` required.

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
| `PI_MEMORY_SKIP_SCHEDULER_SYNC` | unset | `1` skips scheduler sync while set, including automatic sync and manual `scheduler sync` |

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

**macOS launchd is managed automatically**: `postinstall`, `pi-memory init`, and every Pi **`session_start`** best-effort run `scheduler sync` (failures do not block install or sessions), writing `~/Library/LaunchAgents/com.pi.memory.maintenance.plist` and removing legacy labels (e.g. `dev.pi.memory-consolidate`). You usually do not edit plists by hand.

Manual trigger or troubleshooting:

```bash
pi-memory scheduler sync --verbose
```

If `PI_MEMORY_SKIP_SCHEDULER_SYNC=1` is set in the environment, unset it before running the manual sync command.

Linux / Windows: install from templates manually:

- [`templates/crontab.example`](./templates/crontab.example)
- [`templates/consolidate.cmd.example`](./templates/consolidate.cmd.example)
- [`templates/schtasks.example.txt`](./templates/schtasks.example.txt)

macOS reference plist (matches auto-generated job):

- [`templates/com.pi.memory.consolidate.plist.example`](./templates/com.pi.memory.consolidate.plist.example)

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
