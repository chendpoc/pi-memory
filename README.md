# @chendpoc/pi-memory

[![npm](https://img.shields.io/npm/v/@chendpoc/pi-memory)](https://www.npmjs.com/package/@chendpoc/pi-memory)

Local episodic memory for [Pi](https://pi.dev) coding agent. Automatically recalls past sessions, people, projects, and decisions during conversations.

**No external binaries required** --- pure TypeScript, runs entirely inside Pi.

## Features

- **Implicit memory preflight** --- automatically detects memory-relevant questions (Chinese/English/Japanese) and injects `<private_memory>` context before each LLM call
- **`memory_recall` tool** --- LLM can explicitly query the knowledge graph by entity/relationship
- **`memory_append` tool** --- persist user preferences and facts to `MEMORY.md`
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

# 3. Restart Pi --- memory is now active
# Try asking: "What projects have I worked on?"
```

After training, Pi will:
- Show `status: ready, mode: local_graph` when you type `/memory`
- Automatically inject past context when you ask relationship questions
- Let the LLM call `memory_recall` for explicit lookups

## How It Works

```
Pi session files (.jsonl)
    |
    v
Trainer (regex or LLM extraction)
    |
    v
graph.json bundle (entities + relations + events)
    |
    v
LocalGraphQuerier (in-memory graph query)
    |
    v
memory_recall tool / implicit preflight injection
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

# Manage bundles
npx pi-memory install-bundle ./path/to/bundle

# Rebuild FTS5 search index
npx pi-memory index

# Continuous training (watch mode)
npx pi-memory train --watch
```

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
│   └── .train_marker         # incremental training timestamp
├── agent/sessions/           # Pi session files (.jsonl)
└── MEMORY.md                 # persistent notes (memory_append target)
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
| `src/trainer/` | Session loader, fact extraction, entity resolution, bundle builder |
| `src/fallback/` | FTS5 index, keyword search, LLM rerank |
| `src/preflight/` | Intent detection, private memory render/inject/strip |
| `src/tools/` | `memory_recall` and `memory_append` tool definitions |

## Implicit Preflight

On every LLM call, the `context` event:

1. Detects memory-relevant intents via regex (Chinese/English/Japanese relationship patterns)
2. Optionally calls a helper LLM (`compile_memory_intents` forced tool_use)
3. Queries the graph for matching entities/relations
4. Injects a `<private_memory>` block into the user message (deep copy, not persisted to session)
5. Results are cached per agent loop to avoid redundant queries during multi-tool turns

## Peer Dependencies

These are provided by the Pi host and should not be bundled:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `typebox`

## Optional Dependencies

- `better-sqlite3` --- enables FTS5 session search index (graceful degradation if absent)

## Development

```bash
npm install
npm run build
npm test          # 129 tests
npm run typecheck
```

## License

MIT
