import { postJson } from "../http.js";
import type { LlmClient, OllamaLlmConfig } from "./types.js";

type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
};

export async function ollamaHealthCheck(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/api/tags", baseUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function createOllamaLlmClient(cfg: OllamaLlmConfig): LlmClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  const timeoutMs = cfg.timeoutMs ?? 60_000;

  return {
    async complete(prompt, signal) {
      const resp = await postJson<OllamaChatResponse>(
        `${baseUrl}/api/chat`,
        {
          model: cfg.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { num_predict: 1024 },
        },
        { timeoutMs, signal },
      );

      if (resp.error) throw new Error(`Ollama: ${resp.error}`);
      const text = resp.message?.content?.trim();
      if (!text) throw new Error("Ollama: empty response");
      return text;
    },
  };
}
