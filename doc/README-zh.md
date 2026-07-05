<p align="center">
  <img src="../assets/pi-memory-logo.png" alt="pi-memory logo" width="720" />
</p>

# @chendpoc/pi-memory

<p align="center">
  <a href="../README.md">English</a> |
  <a href="README-zh.md">简体中文</a>
</p>

给 Pi coding agent 使用的本地记忆扩展，让 Pi 能跨 session 记住你的偏好、项目约定、历史决策和未完成 TODO。

`pi-memory` 把长期笔记保存在本地 Markdown 中，在 Pi 回答前自动召回相关内容，并在写入前脱敏常见 secret。目标很简单：新开的 Pi session 应该带着你希望它记住的上下文开始，而不是依赖不透明的托管记忆服务。

## 🧠 这个 Package 做什么

Pi 已经有长 session compaction，它能帮助当前长对话继续下去；但它不负责让未来的新 session 记住你的稳定偏好、项目规则、历史决策和未完成 TODO。

`pi-memory` 补的是这条链路：

```text
值得记住的事实 -> 本地 Markdown 记忆 -> 未来 turn 的私有上下文
```

它提供：

- ✍️ 用 `/remember` 保存明确要记住的内容。
- 🔁 从 Pi compaction 中带出长期事实。
- 📥 从短 session 或漏处理 session 中补捞有用信息。
- 🔦 在每次回答前自动召回相关记忆，并作为私有上下文注入。
- 🛡️ 在保存记忆前脱敏常见 secret 和 token。
- 📄 用 Markdown 保存可审查、可编辑的记忆。
- ☂️ 召回不可用时优雅降级，不打断 Pi 正常工作。
- ⏳ 把较重的清理和整理放到离线维护任务中。

## 🚀 0.3.0 新增内容

- **更安全的记忆写入**：常见 API key、Bearer token、私钥、service account JSON、连接串和 `.env` 风格 secret 会在保存前被脱敏。
- **更可靠的召回体验**：Pi turn 被取消时，记忆召回也会一起取消，不再等内部 timeout。
- **更清晰的状态与维护输出**：`/memory-status`、`pi-memory status`、queue drain 和 reindex 触发使用更一致的统计。
- **面向后续版本的更健康基础**：内部实现被简化并拆成更小的模块。这主要是维护者视角的变化，但能降低后续功能迭代风险。

## 📦 安装与启用

要求：

- Node.js `>=24 <25`
- pnpm
- Pi 提供的 extension runtime packages

通过 Pi 安装：

```bash
pi install npm:@chendpoc/pi-memory
```

从本仓库本地开发：

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

通过 Pi 的 extension 加载机制启用。本包声明：

```json
{
  "pi": {
    "extensions": ["./dist/pi-extension.js"]
  }
}
```

发布的 npm 包自带编译后的 `dist/`；`pi install npm:@chendpoc/pi-memory` 会直接加载编译产物。

### 🌱 记忆工作区（自动初始化）

**大多数用户不需要手动运行 `pi-memory init`。** 记忆工作区会自动准备好，且**不会覆盖非空的 `MEMORY.md`**：

| 时机 | 行为 |
| --- | --- |
| **`pnpm install`** | `postinstall` 执行 `pi-memory init`（或 pre-build 回退脚本） |
| **首次 Pi session** | Pi 检查或创建记忆工作区 |
| **手动（可选）** | `pi-memory init` |

仅在以下情况需要显式运行 `pi-memory init`：

- 安装**之后**才设置 **`PI_MEMORY_AGENT_DIR`**（postinstall 可能已按默认路径初始化）。
- 安装脚本被跳过（`--ignore-scripts` 或企业策略）。
- 想在打开 Pi 之前先 bootstrap，或配合 `pi-memory status` 做排查。

```bash
pi-memory init   # 可选；见上文
```

## ✨ 为什么选择 `pi-memory`

### 🔄 Agent 使用前后差异

| 场景 | 未使用 `pi-memory` | 使用 `pi-memory` 后 |
| --- | --- | --- |
| 新 session 问“继续上次计划” | Agent 只能追问上下文，或基于当前仓库猜测。 | Preflight 召回匹配的 `MEMORY.md` 事实并注入私有参考上下文。 |
| 用户说“记住这个 repo 用 Vitest” | 事实可能只留在当前 session 摘要里。 | `/remember` 写入 `[user]` 条目，consolidate 必须保留。 |
| 长 session 触发压缩 | Compaction 只帮助当前 session 续聊，不必然产生跨 session 事实。 | 一次 dual-purpose summary 同时保留当前上下文并导出长期事实。 |
| 启动 subagent | 可能继承过多上下文，或重复父 session 的记忆写入。 | Subagent 默认使用更小的记忆视图，减少噪声和重复写入。 |
| 记忆召回不可用 | 如果是硬依赖，会直接影响对话。 | Pi 回退到 Markdown 或空注入，主模型照常运行。 |
| 记忆持续增长 | 文件容易变成无边界流水账。 | `MEMORY.md` 150 行上限，`auto-*.md` 溢出，consolidate 合并去重。 |

### 🌟 核心优势

- 📓 **可审计的记忆**：`MEMORY.md` 和 `auto-*.md` 可以直接打开、审查、编辑、grep、复制或纳入版本控制。
- 🔎 **回答前自动带上上下文**：Pi 在主模型回答前拿到相关私有记忆，不需要你手动粘贴旧上下文。
- 🔒 **用户显式记忆受保护**：`/remember` 写入的条目会标记为用户创建，consolidate 必须保留。
- 🛡️ **默认更安全**：常见 secret 和 token 会在进入长期记忆前被替换。
- ☂️ **召回不是硬依赖**：召回为空、变慢或不可用时，当前 turn 仍然继续。
- 💤 **减少交互打扰**：较重的整理和清理通过 maintenance 任务执行，不阻塞普通 Pi turn。
- 🧹 **控制记忆增长**：主记忆文件有行数上限，溢出进入可审查文件，consolidate 合并重复内容。
- 👥 **理解 subagent 场景**：root session 使用更完整召回；subagent 默认使用更小的记忆视图，减少噪声。

### ⚖️ 对比

`pi-memory` 不试图成为所有 memory 系统的集合。它的价值是一个 Pi-native 闭环：本地 Markdown 记忆、回答前私有召回、compaction export 和离线 maintenance。

| 系统 | 优势 | 与 `@chendpoc/pi-memory` 的差异 |
| --- | --- | --- |
| Cursor Rules / OpenCode `AGENTS.md` | 静态项目指令，注入行为可预测。 | 主要是用户手写规则，没有自动长期事实提取，也没有每轮回答前的记忆召回。 |
| Claude Code Auto Memory | Agent 可以写本地记忆文件。 | 也是文件记忆，但没有 Pi 的 compaction/shutdown 集成，也没有回答前私有召回闭环。 |
| `pi-hermes-memory` | 功能丰富，有 FTS5、失败记忆、纠正学习、安全扫描。 | 自动化更重；`pi-memory` 更窄，更强调 Markdown-first 和回答前私有召回。 |
| OpenClaw memory-core | 成熟的文件+索引设计，有 dreaming、混合搜索、本地 embedding。 | OpenClaw 是更大的 memory 平台；`pi-memory` 更窄，聚焦 Pi extension。 |
| Mem0 / Zep | 托管 memory API，有混合搜索、图和时序建模。 | 检索基础设施更强，但更偏外部服务/数据库，不以 Markdown 事实源为第一原则。 |
| Letta | 上下文工程，git-backed memory repo 和 sleep-time compute。 | 自主记忆管理更强，但心智模型比 Pi extension lifecycle 更重。 |
| Cognee | 知识引擎，图/向量/关系存储和多种检索模式。 | 更适合知识图谱；对轻量编码 agent 偏好/约定来说偏重。 |

其他系统更强的地方：

- `pi-hermes-memory`：失败记忆、纠正检测、工具怪癖、安全扫描。
- OpenClaw：dreaming 阶段、memory wiki、FTS/vector 混合搜索、本地 embedding provider。
- Zep/Cognee：时序图推理和多跳图检索。
- Mem0：托管多租户 memory API。
- Letta：自主 context repository 和 sleep-time memory work。

## ⚙️ 工作方式

### ⚙️ 技术说明

这些选择主要面向运维和贡献者，用来说明用户看到的“本地、可审查、有边界”的行为是如何实现的。

| 选择 | 为什么重要 |
| --- | --- |
| `MEMORY.md` 作为 Ground Truth | 长期记忆保持可审查、可编辑，而不是变成不透明数据库状态。 |
| 基于 `node:net` 的 UDS JSONL | IPC 只在本机发生，避免 HTTP 端口，同时保持简单的 request/response frame。 |
| spawn 独立 sidecar 进程 | 向量 query/reindex 与 Pi extension 进程隔离；失败时可降级到 Markdown fallback。 |
| 离线 `maintenance` job | consolidate 和 shutdown-queue drain 可以在交互 turn 之外执行。 |
| 有预算的 Preflight | QueryIntent、sidecar query、cache 和 fallback 都在明确延迟边界内运行。 |

### 🏗️ 架构

```text
Pi 扩展进程（MemoryRuntime）
  |- session_start
  |    |- 初始化 MEMORY.md
  |    |- 启动/warm sidecar
  |    |- 重建派生向量索引
  |    `- 预加载 Memory Cap
  |
  |- before_agent_start / context
  |    `- Preflight recall（AbortSignal 感知 sidecar query）-> <private_memory> 注入
  |
  |- /remember
  |    `- 追加 [user] Memory Entry
  |
  |- session_before_compact / session_compact
  |    `- dual-purpose summary -> Memory Export ingest
  |
  |- session_shutdown
  |    `- 只追加 shutdown 元数据
  |
  `- consolidate scheduler
       `- 合并/去重 -> 重写 Ground Truth -> reindex

通过 UDS JSONL 通信的 Sidecar 进程（`node:net`，不走 HTTP 端口）
  |- ping
  |- stats
  |- query: embed -> cosine scan -> MMR
  `- reindex: upsert chunks into memory.vec.sqlite
```

### 🔎 读取路径

Root session：

```text
来自 Ground Truth 的 Memory Cap
  + 当前用户消息的 Episodic Preflight
  -> 合并为 <private_memory>
```

Subagent session：

```text
只使用 Memory Cap
  -> 默认不跑 episodic QueryIntent / sidecar query
```

回退链：

```text
Sidecar 结果
  -> 空结果、错误或超时：回退到 MEMORY.md
  -> 仍为空：不注入
```

### ✍️ 写入路径

| 路径 | 触发 | LLM? | 是否阻塞 | 目的 |
| --- | --- | --- | --- | --- |
| `/remember` | 用户命令 | 否 | 是 | 显式长期记忆 |
| Compaction | `session_before_compact` + `session_compact` | 一次摘要调用 | 摘要阻塞，入库后台执行 | 当前 session 续聊 + 导出长期事实 |
| Shutdown Queue | `session_shutdown` + `pi-memory maintenance` | 仅离线且无 compaction summary 时 | shutdown 时不阻塞 | 补捞短 session 或漏处理事实 |
| Consolidate | overflow >= 12、7 天或每日 cron | 可选 | 离线或后台 | 去重、合并、清理过期 TODO |

### 🛡️ 脱敏覆盖范围

`pi-memory` 0.3.0 会在长期记忆写入前脱敏疑似 secret。所有能持久化到 `MEMORY.md`、`auto-*.md` 或派生向量索引的增量写入路径都会应用这个规则。

覆盖的写入路径：

- `/remember`
- `append` / `appendUser` / `appendIfAbsent` / `appendMany`
- compaction `Memory Export` ingest
- shutdown queue drain ingest

当前 MVP 聚焦 **secret 和 token**，包括常见 API key、Bearer/JWT、私钥块、service account JSON、连接串、Basic Auth URL 和 `.env` 风格的 secret 赋值。命中内容会替换为 `[REDACTED]`；如果脱敏后没有有意义内容，该条 memory 会被跳过，而不是写入一个孤立占位符。

当前边界：

- 脱敏作用于**长期记忆条目**，不扫描完整 Pi session JSONL 或 LLM 请求体。
- 已存在的历史 `MEMORY.md` 内容不会被自动重写。
- 0.3.0 暂不做 PII 检测。
- Debug 日志只记录命中数量和 policy version，不打印命中的 secret 原文。

对贡献者来说，共用写入闸口是 `prepareEntryForWrite`。

## 💾 数据和 MEMORY.md 格式

所有产物都放在同一个 memory agent directory 下。

解析顺序：

1. `--agent-dir` CLI flag
2. `PI_MEMORY_AGENT_DIR`
3. 默认 `~/.pi/pi-memory-data`

| 文件 | 作用 |
| --- | --- |
| `MEMORY.md` | 事实源文件 |
| `auto-*.md` | 150 行上限后的溢出文件 |
| `.memory_gc` | 上次 consolidate 时间 |
| `.memory_compactions.json` | compaction 幂等状态 |
| `.memory_shutdown_queue.jsonl` | append-only shutdown 元数据 |
| `.memory_shutdown_processed.json` | drain 幂等状态 |
| `memory.vec.sqlite` | 派生向量索引 |
| `memory.sock` | Sidecar UDS socket |
| `logs/maintenance.log` | 定时 `maintenance --cron` 的 stdout 日志 |
| `logs/maintenance.err.log` | 定时 maintenance 的 stderr 日志（launchd / Windows） |

`logs/` 会在 **extension `session_start`**、`pi-memory init`、或 CLI `maintenance`/`consolidate` 时自动创建，无需手动 `mkdir`。

标准模板：[`templates/MEMORY.md.example`](../templates/MEMORY.md.example)

```markdown
# Memory

## Preferences

## Conventions

## Findings

## Todos
```

每条记忆是一个 Markdown bullet：

```markdown
- [user] Prefer pnpm over npm <!-- id:abc123 user ts:2026-07-04T09:00:00.000+08:00 -->
- Project tests use Vitest <!-- id:def456 ts:2026-07-04T09:05:00.000+08:00 -->
```

规则：

- `/remember` 写入 `[user]` 条目。
- Consolidate 不能删除或改写 `[user]` 条目。
- `MEMORY.md` 上限为 150 行。
- 溢出条目写入 `auto-*.md`，并在 `MEMORY.md` 留指针。
- 向量 chunk 从条目派生；默认超过 `PI_MEMORY_CHUNK_MAX_CHARS=512` 的长条目会拆分。

## 🎛️ 配置

可选 env 文件按以下顺序加载：

1. `PI_MEMORY_ENV_FILE`
2. 项目 `.env`
3. 项目 `.env.local`
4. `~/.pi/agent/pi-memory.env`

常用变量：

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `PI_MEMORY_AGENT_DIR` | `~/.pi/pi-memory-data` | 记忆数据根目录 |
| `PI_MEMORY_EMBEDDER` | `hash` | 支持 `hash`、`ollama`、`openai` |
| `PI_MEMORY_HELPER_MODEL` | `deepseek/deepseek-v4-flash` | QueryIntent 和 consolidate 使用的辅助模型 |
| `PI_MEMORY_PREFLIGHT_BUDGET_MS` | `800` | Preflight 共享预算，限制在 250-1500ms |
| `PI_MEMORY_INTENT_RETRIES` | `0` | 首次尝试后的 helper LLM 重试次数 |
| `PI_MEMORY_WARM_SIDECAR` | `1` | 在 `session_start` warm sidecar |
| `PI_MEMORY_INTENT_CACHE` | `1` | session 级 QueryIntent 缓存 |
| `PI_MEMORY_REINDEX_DEBOUNCE_MS` | `500` | 写入后的 sidecar reindex debounce |
| `PI_MEMORY_TOP_K` | `3` | 向量召回条数 |
| `PI_MEMORY_MMR_LAMBDA` | `0.8` | MMR 相关性与多样性权重 |
| `PI_MEMORY_MIN_RELEVANCE` | `0.4` | 最小 cosine similarity |
| `PI_MEMORY_CHUNK_MAX_CHARS` | `512` | 索引长条目拆分阈值；`0` 表示关闭 |
| `PI_MEMORY_DEBUG` | 未设置 | `1` 打印 debug timing logs |
| `PI_MEMORY_SKIP_SCHEDULER_SYNC` | 未设置 | 设置为 `1` 时跳过 scheduler sync，包括自动 sync 和手动 `scheduler sync` |

完整列表见 [`.env.example`](../.env.example)。

### 🛰️ Embedding Provider

| Embedder | 适用场景 | 说明 |
| --- | --- | --- |
| `hash` | 零配置本地开发 | 离线、确定性、语义质量较低 |
| `ollama` | 本地语义 embedding | 使用 `PI_MEMORY_OLLAMA_BASE_URL` 和 `PI_MEMORY_OLLAMA_EMBED_MODEL` |
| `openai` | 更高质量云端 embedding | 需要 `PI_MEMORY_OPENAI_API_KEY` 或 `OPENAI_API_KEY` |

Vector Index 会保存 embedding provider、model 和 dimension 元数据。配置变化时会清空旧 chunks 并重建。

## ⌨️ 命令

Pi 内部：

```text
/remember [section] <content>
/memory-status [refresh|expand|collapse|hide]
```

CLI：

```bash
pi-memory status
pi-memory maintenance --cron --verbose
pi-memory consolidate --force --verbose
pi-memory drain-shutdown-queue --verbose
pi-memory init   # 可选 — 安装后 + 首次 session 通常已自动完成
```

`maintenance` 是推荐的调度入口：

```text
consolidate -> drain-shutdown-queue
```

**macOS launchd 会自动管理**：`postinstall`、`pi-memory init`、以及 Pi **每次 `session_start`** 都会 best-effort 调用 `scheduler sync`（失败不影响安装或会话），写入 `~/Library/LaunchAgents/com.pi.memory.maintenance.plist`，并移除旧 label（如 `dev.pi.memory-consolidate`）。一般无需手动改 plist。

手动触发或排查：

```bash
pi-memory scheduler sync --verbose
```

如果环境里设置了 `PI_MEMORY_SKIP_SCHEDULER_SYNC=1`，手动 sync 前需要先取消该变量。

Linux / Windows 仍参考模板手动安装：

- [`templates/crontab.example`](../templates/crontab.example)
- [`templates/consolidate.cmd.example`](../templates/consolidate.cmd.example)
- [`templates/schtasks.example.txt`](../templates/schtasks.example.txt)

macOS 参考 plist（内容与自动生成一致）：

- [`templates/com.pi.memory.consolidate.plist.example`](../templates/com.pi.memory.consolidate.plist.example)

## 🩺 诊断

使用 `/memory-status` 或 `pi-memory status` 检查：

- memory agent 目录
- `MEMORY.md` 行数
- 条目数
- overflow 文件数
- 上次 consolidate 时间
- sidecar socket 状态
- vector index generation 和 chunk 数
- 当前配置的 embedder
- 索引 embedder 是否与当前配置不一致

设置 `PI_MEMORY_DEBUG=1` 可打印 Preflight timing 日志：

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

## 🚫 非目标

- 不替代 Pi compaction。
- 不替代 session search；历史对话搜索应使用专门的 session-search 扩展。
- 不在本包内维护图数据库。
- 不让 sidecar 成为事实源。
- 不把完整聊天记录当作 memory 存储。
- 不给每轮用户消息增加多秒级 reflection。

## 🛠️ 开发

```bash
pnpm typecheck
pnpm test
pnpm build
```

sidecar IPC 测试会打开 Unix domain socket。如果在受限沙盒中因为 `listen EPERM` 失败，请在正常本地 shell 中运行。

## 📚 文档

- [English README](../README.md)
- [路线图](./ROADMAP-zh.md)
- [架构 refactor 计划](../dev-doc/architecture-refactor-plan.md)
- [UBIQUITOUS_LANGUAGE.md](../UBIQUITOUS_LANGUAGE.md) - 领域术语表

## 📜 许可证

MIT
