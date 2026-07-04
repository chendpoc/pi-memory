import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

import type { LlmClient } from "../adapters/llm/types.js";
import { stripPrivateMemory } from "../preflight/strip.js";
import { buildCompactionSummaryPrompt } from "./summaryPrompt.js";

type CompactionPreparation = SessionBeforeCompactEvent["preparation"];

function stripPrivateMemoryFromMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    if (typeof message.content === "string") {
      return { ...message, content: stripPrivateMemory(message.content) };
    }
    return {
      ...message,
      content: message.content.map((block) =>
        block.type === "text"
          ? { ...block, text: stripPrivateMemory(block.text) }
          : block,
      ),
    } as AgentMessage;
  });
}

export async function runDualPurposeCompactionSummary(
  preparation: CompactionPreparation,
  llm: LlmClient,
  signal?: AbortSignal,
): Promise<string | null> {
  const allMessages = stripPrivateMemoryFromMessages([
    ...preparation.messagesToSummarize,
    ...preparation.turnPrefixMessages,
  ]);

  const conversationText = serializeConversation(convertToLlm(allMessages));
  const prompt = buildCompactionSummaryPrompt(conversationText, preparation.previousSummary);
  const summary = await llm.complete(prompt, signal);
  return summary.trim() || null;
}
