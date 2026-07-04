export const DUAL_PURPOSE_SUMMARY_TEMPLATE = `## Session Context
<!-- Goal / Progress / Next Actions / key file changes for continuing THIS session -->

## Memory Export
<!-- Cross-session durable facts only; omit this entire section if nothing worth keeping -->

### Preferences

### Conventions

### Findings

### Todos
`;

export function buildCompactionSummaryPrompt(
  conversationText: string,
  previousSummary?: string,
): string {
  const previousContext = previousSummary
    ? `\n\nPrevious compaction summary for context:\n${previousSummary.trim()}`
    : "";

  return `You are summarizing a coding-agent conversation for two purposes at once.

1. **Session Context** — everything needed to continue THIS session after context compaction.
2. **Memory Export** — only durable facts that should persist across NEW sessions (preferences, conventions, findings, todos).

Rules:
- Output markdown ONLY, following the exact section structure below.
- Session Context: goals, progress, decisions, blockers, next actions, important file paths.
- Memory Export: bullet lists under ### Preferences / Conventions / Findings / Todos.
- Each Memory Export bullet is one standalone fact (no pronouns like "we" without context).
- Skip Memory Export subsections that have nothing new; omit the whole Memory Export section if empty.
- Do NOT include <private_memory> blocks or ephemeral tool noise in Memory Export.
${previousContext}

Required format:

${DUAL_PURPOSE_SUMMARY_TEMPLATE}

<conversation>
${conversationText}
</conversation>`;
}
