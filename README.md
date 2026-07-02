# @chendpoc/pi-memory

[![npm](https://img.shields.io/npm/v/@chendpoc/pi-memory)](https://www.npmjs.com/package/@chendpoc/pi-memory)

Local long-term memory for [Pi](https://pi.dev) coding agent. It closes the Write → Consolidate → Retrieve loop so past sessions, preferences, projects, and decisions can re-enter future conversations automatically.

**No external binaries required** --- pure TypeScript, runs entirely inside Pi.

## Features

- **Implicit memory preflight** --- automatically detects memory-relevant questions (Chinese/English/Japanese) and injects `<private_memory>` context before each LLM call
- **`memory_recall` tool** --- LLM can explicitly query the knowledge graph by entity/relationship
- **`memory_append` tool** --- queues explicit user memories into stage1 so Phase2 can merge them safely
- **Offline consolidation** --- `session_shutdown` only enqueues metadata; `pi-memory consolidate` drains queue, trains graph, and updates memory files
- **MEMORY.md index** --- session-level cap injection plus scoped project memory files
- **Local trainer** --- extracts entities, relations, and events from Pi session history (regex or LLM-powered)
- **FTS5 search** --- SQLite full-text index for keyword fallback
- **LLM rerank** --- reranks keyword search results using `deepseek-v4-flash` for relevance scoring
- **Session dedup** --- content-hash deduplication in both trainer and indexer
- **Zero config** --- works out of the box with `pi install`

## Install

```bash
pi install npm:@chendpoc/pi-memory
```

Or for local development:

```json
{
  "packages": ["./extensions/pi-memory"]
}
```

Pi reads `package.json` > `pi.extensions` and auto-loads the extension via [jiti](https://github.com/unjs/jiti) (TypeScript, no build step needed).

## Quick Start

```bash
# 1. Install the package
pi install npm:@chendpoc/pi-memory

# 2. Train a memory bundle from your session history
npx pi-memory train --full

# 3. Run first consolidation and install the daily scheduler
npx pi-memory consolidate
npx pi-memory setup-schedule

# 4. Restart Pi --- memory is now active
# Try asking: "What projects have I worked on?"
```

After training, Pi will:
- Show `status: ready, mode: local_graph` when you type `/memory`
- Show queue/index details when you type `/memory --verbose`
- Automatically inject past context when you ask relationship questions
- Let the LLM call `memory_recall` for explicit lookups

## How It Works

```
Pi session files (.jsonl)
    | session_shutdown
    v
pending_sessions queue (memories.sqlite)
    | daily / manual consolidate
    v
stage1 outputs + graph train
    |
    v
MEMORY.md / project memory + graph.json + sessions.db
    |
    v
memory_recall tool / implicit preflight injection / MEMORY.md cap
```

### Query Backends

The service automatically selects the best available backend:

| Priority | Backend | Requires |
|----------|---------|----------|
| 1 | **LocalGraphQuerier** (in-process) | bundle only |
| 2 | **FTS5 + keyword fallback** | `better-sqlite3` (optional) |

The default backend is LocalGraphQuerier --- pure TypeScript, no external dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `/memory` | Show service status, query mode, and bundle info |
| `/memory --verbose` | Show consolidation queue, memory index usage, and recent job logs |

## CLI

```bash
# Train a bundle from session history
npx pi-memory train --full                    # full rebuild
npx pi-memory train                           # incremental (only new sessions)
npx pi-memory train --extractor llm           # use LLM for deeper extraction
npx pi-memory train --extractor llm --model deepseek/deepseek-v4-flash

# Query the knowledge graph
npx pi-memory query '{"mode":"direct_relation","anchor_mentions":["Alice"]}'

# Service diagnostics
npx pi-memory health
npx pi-memory status
npx pi-memory memory-status

# Offline consolidation
npx pi-memory consolidate
npx pi-memory consolidate --dry-run
npx pi-memory consolidate --phase1-only
npx pi-memory consolidate --phase2-only

# OS scheduler
npx pi-memory setup-schedule
npx pi-memory setup-schedule --hour 4
npx pi-memory setup-schedule --status
npx pi-memory setup-schedule --remove

# Manage bundles
npx pi-memory install-bundle ./path/to/bundle

# Rebuild FTS5 search index
npx pi-memory index

# Continuous training (watch mode)
npx pi-memory train --watch
```

`train --watch` is kept for compatibility. The long-term memory path is `pi-memory consolidate` plus the OS scheduler.

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--memory-helper-model` | LLM model for intent detection and rerank | `deepseek/deepseek-v4-flash` |

```bash
pi --memory-helper-model deepseek/deepseek-v4-flash
```

## Data Layout

```
~/.pi/
├── memory/
│   ├── current/              # active bundle (symlink)
│   │   ├── manifest.json
│   │   └── graph.json        # entities, edges, events
│   ├── bundles/              # historical bundles
│   ├── sessions.db           # FTS5 search index
│   ├── memories.sqlite       # pending queue + stage1 outputs
│   ├── workspace/            # raw memories + rollout summaries
│   ├── projects/<hash>/      # project-scoped MEMORY.md files
│   ├── consolidation.log     # structured consolidation logs
│   └── .train_marker         # incremental training timestamp
├── agent/sessions/           # Pi session files (.jsonl)
└── MEMORY.md                 # global memory index
```

## Programmatic API

```typescript
import {
  MemoryService,
  defaultMemoryConfig,
  trainBundle,
  LocalGraphQuerier,
  createLLMFactExtractor,
  createStandaloneLLMClient,
  rerankWithLLM,
} from "@chendpoc/pi-memory";

// --- Query the graph directly ---
const querier = new LocalGraphQuerier("/Users/you/.pi/memory");
querier.load();
const result = querier.query({
  mode: "direct_relation",
  anchor_mentions: ["Alice"],
});

// --- Train a bundle ---
const result = await trainBundle({
  sessionsDir: "~/.pi/agent/sessions",
  bundleRoot: "~/.pi/memory",
  full: true,
});

// --- Train with LLM extraction ---
const client = createStandaloneLLMClient("deepseek/deepseek-v4-flash");
const extractor = createLLMFactExtractor({ client, batchSize: 10 });
await trainBundle({ extractOpts: { llmExtractor: extractor } });

// --- Use as Pi extension ---
import piMemory from "@chendpoc/pi-memory/extension";
export default piMemory;
```

## Architecture

| Module | Purpose |
|--------|---------|
| `src/pi-extension.ts` | Pi ExtensionAPI entry point |
| `src/local/graphQuery.ts` | In-process graph query engine |
| `src/adapters/piComplete.ts` | LLM adapter via `@earendil-works/pi-ai/compat` |
| `src/service.ts` | Service lifecycle and query routing |
| `src/consolidation/` | Queue, stage1, Phase2, scheduler, memory index, scope |
| `src/trainer/` | Session loader, fact extraction, entity resolution, bundle builder |
| `src/fallback/` | FTS5 index, keyword search, LLM rerank |
| `src/preflight/` | Intent detection, private memory render/inject/strip |
| `src/tools/` | `memory_recall` and `memory_append` tool definitions |

## Implicit Preflight

On every LLM call, the `context` event:

1. Detects memory-relevant intents via regex (Chinese/English/Japanese relationship patterns)
2. Optionally calls a helper LLM (`compile_memory_intents` forced tool_use)
3. Queries the graph for matching entities/relations and greps scoped MEMORY.md in parallel
4. Injects the session memory index and dynamic recall into `<private_memory>` blocks (deep copy, not persisted to session)
5. Results are cached per agent loop to avoid redundant queries during multi-tool turns

## Peer Dependencies

These are provided by the Pi host and should not be bundled:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `typebox`

## Optional Dependencies

- `better-sqlite3` --- enables FTS5 session search index (graceful degradation if absent)

## Releasing

This repo uses [Changesets](https://github.com/changesets/changesets) for semver bumps and `CHANGELOG.md`, and a **tag-triggered** workflow for GitHub Releases (and optional npm publish).

1. After a feature/fix PR, add a changeset: `pnpm changeset`
2. Merge to `main` — GitHub Actions opens a **Version Packages** PR (bumps version + updates `CHANGELOG.md`)
3. Merge that PR, then tag and push:

```bash
git pull origin main
git tag v0.1.13
git push origin v0.1.13
```

4. The **Tag Release** workflow (`tag-release.yml`) runs on `v*` tags: creates a GitHub Release from `CHANGELOG.md`, then publishes to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers/) (no long-lived `NPM_TOKEN`).

### npm trusted publishing (recommended)

npm now recommends **Trusted Publishing** over Granular "bypass 2FA" tokens for CI. GitHub Actions proves its identity with a short-lived OIDC credential; no stored token, no OTP (`EOTP`).

**One-time setup on npmjs.com** (package must exist first — see below):

1. Open `https://www.npmjs.com/package/@chendpoc/pi-memory/access` (after first publish)
2. **Trusted Publisher** → GitHub Actions
3. Set exactly:
   - Organization or user: `chendpoc`
   - Repository: `pi-memory`
   - Workflow filename: `tag-release.yml`
   - Environment: *(leave blank unless you add a GitHub Environment)*

**First publish:** npm requires the package to exist before you can configure trusted publishing. Either:

- Publish once locally with `npm login` + `npm publish --access public`, or
- Use [setup-npm-trusted-publish](https://github.com/azu/setup-npm-trusted-publish) to create a placeholder, configure OIDC, then publish real versions from CI.

The workflow already sets `id-token: write` and uses Node 24 (npm ≥ 11.5.1). Provenance is automatic with trusted publishing.

**Re-run without deleting a tag:** GitHub → Actions → **Tag Release** → **Run workflow**

- `tag`: `v0.1.13`
- `skip_github_release`: ✅ (release already exists)
- `publish_npm`: ✅

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm changeset    # before opening a release PR
```

## License

MIT
