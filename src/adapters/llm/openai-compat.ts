import { DEFAULT_LLM_COMPAT_TIMEOUT_MS } from "../../constants/timing.js";
import { postJson } from "../http.js";
import type { LlmClient, OpenAICompatLlmConfig } from "./types.js";

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

export async function openaiCompatHealthCheck(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/v1/models", baseUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function createOpenAICompatLlmClient(cfg: OpenAICompatLlmConfig): LlmClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_LLM_COMPAT_TIMEOUT_MS;

  return {
    async complete(prompt, signal) {
      const resp = await postJson<ChatCompletionResponse>(
        `${baseUrl}/v1/chat/completions`,
        {
          model: cfg.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1024,
        },
        {
          timeoutMs,
          signal,
          headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined,
        },
      );

      if (resp.error?.message) throw new Error(`OpenAI-compat: ${resp.error.message}`);
      const text = resp.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("OpenAI-compat: empty response");
      return text;
    },
  };
}
