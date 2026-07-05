# @chendpoc/pi-memory 路线图

<p align="center">
  <a href="ROADMAP.md">English</a> |
  <a href="ROADMAP-zh.md">简体中文</a>
</p>

本文档记录 `@chendpoc/pi-memory` 的产品方向。README 保持聚焦，只讲定位、安装和当前架构。

## 当前基础

- 带 overflow 的 `MEMORY.md` Ground Truth。
- `/remember` 和 `/memory-status`。
- 基于 UDS JSONL 的 Sidecar。
- `memory.vec.sqlite` 向量索引。
- QueryIntent + raw-query fallback。
- 800ms 共享 Preflight 预算，sidecar query 支持 AbortSignal 取消。
- sidecar warm、intent cache、query cache。
- dual-purpose compaction summary。
- Shutdown Queue + `maintenance`。
- Consolidate + reindex。
- Subagent Memory Cap + Compact Delta。
- Ground Truth 写入前 secret 脱敏（Path A）。
- `MemoryRuntime` 扩展生命周期与重构后的 store/sidecar 模块。

## P0：信任与安全

**目标版本：0.3.x** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/1)

- ✅ 记忆写入前做 secret/token redaction（设计见 [`dev-doc/redaction-design.md`](../dev-doc/redaction-design.md)）— **0.3.0 已交付**。
- ✅ 模块架构 refactor：去重 + MemoryStore 瘦身 + ingest 管道（计划见 [`dev-doc/architecture-refactor-plan.md`](../dev-doc/architecture-refactor-plan.md)）— **0.3.0 已交付**。
- 对 LLM 生成的 Memory Export 增加 prompt-injection 防护。
- 针对用户明确纠正做 correction detector（设计见 [`dev-doc/remember-correction-design.md`](../dev-doc/remember-correction-design.md)；**scope 收窄为 `/remember` 链路，暂不实现**）。
- 为跳过写入和 fallback 原因提供更好的诊断。

## P1：召回质量

**目标版本：0.4.x** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/2)

- 对 `MEMORY.md` 条目做 **lexical + vector 混合召回**（计划实现：**SQLite FTS5** 虚拟表 + 现有 `memory_chunks` 向量列，sidecar 内 RRF 融合后再 MMR；设计详见 [`dev-doc/fts5-hybrid-recall-design.md`](../dev-doc/fts5-hybrid-recall-design.md)，跟踪 [issue #6](https://github.com/chendpoc/pi-memory/issues/6)）。
- 为常见 coding-agent 问题建立 recall eval fixtures（[#7](https://github.com/chendpoc/pi-memory/issues/7)）。
- debug metrics 拆分 intent、embed、scan、MMR、render（[#8](https://github.com/chendpoc/pi-memory/issues/8)）。
- 延迟预算允许时，在 MMR 后增加可选 reranker（[#9](https://github.com/chendpoc/pi-memory/issues/9)，nice-to-have）。
- 改进 Ollama 之外的本地 embedding provider。

## P2：记忆生命周期

**目标版本：0.5.x** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/3)

- 增加 failure 和 tool-quirk 类别。
- 晋升前提供人类可审查的 memory draft 或 diary。
- 基于使用信号的晋升和裁剪。
- rewrite 前提供更安全的 consolidate preview。
- 显式处理 stale fact，而不是只做简单 TODO 清理。

## P3：产品表面

**目标版本：1.0** · [GitHub milestone](https://github.com/chendpoc/pi-memory/milestone/4)

- 更好的 TUI status panel。
- memory edit/review 命令。
- 不同 Pi 安装之间的 import/export。
- 常见 Pi 配置的文档 recipes。
