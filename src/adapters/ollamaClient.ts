import http from "node:http";
import https from "node:https";

import type { LLMClient } from "../trainer/llmExtractor.js";
import type { MemoryHelperLLM } from "../preflight/detectIntents.js";
import type { CompileMemoryIntentsResult } from "../preflight/detectIntents.js";
import {
  COMPILE_MEMORY_INTENTS_PARAMETERS,
  MEMORY_HELPER_TOOL_NAME,
} from "../preflight/detectIntents.js";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: "http://localhost:11434",
  model: "qwen3:8b",
};

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: false;
  tools?: OllamaTool[];
  options?: { num_predict?: number };
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      function?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }>;
  };
  error?: string;
}

async function ollamaRequest<T>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  const url = new URL(path, baseUrl);
  const mod = url.protocol === "https:" ? https : http;
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(new Error(`Ollama: invalid JSON response: ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", (err) => reject(new Error(`Ollama: ${err.message}`)));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Ollama: request timeout"));
    });
    req.write(payload);
    req.end();
  });
}

export async function ollamaHealthCheck(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/api/tags", baseUrl);
    const mod = url.protocol === "https:" ? https : http;
    return new Promise((resolve) => {
      const req = mod.get(url, { timeout: 3_000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

export function createOllamaLLMClient(cfg: OllamaConfig): LLMClient {
  return {
    async complete(prompt: string): Promise<string> {
      const body: OllamaChatRequest = {
        model: cfg.model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { num_predict: 8192 },
      };
      const resp = await ollamaRequest<OllamaChatResponse>(cfg.baseUrl, "/api/chat", body);
      if (resp.error) throw new Error(`Ollama: ${resp.error}`);
      const text = resp.message?.content?.trim();
      if (!text) throw new Error("Ollama: empty response");
      return text;
    },
  };
}

export function createOllamaMemoryHelper(cfg: OllamaConfig): MemoryHelperLLM {
  return {
    async compileIntents(text: string): Promise<CompileMemoryIntentsResult> {
      const body: OllamaChatRequest = {
        model: cfg.model,
        messages: [
          {
            role: "user",
            content: `Analyze whether the user message requires recalling private episodic memory.\n\n<message>\n${text}\n</message>`,
          },
        ],
        stream: false,
        tools: [
          {
            type: "function",
            function: {
              name: MEMORY_HELPER_TOOL_NAME,
              description: "Decide whether to recall private episodic memory and compile structured query intents.",
              parameters: COMPILE_MEMORY_INTENTS_PARAMETERS as unknown as Record<string, unknown>,
            },
          },
        ],
        options: { num_predict: 2048 },
      };
      const resp = await ollamaRequest<OllamaChatResponse>(cfg.baseUrl, "/api/chat", body);
      if (resp.error) throw new Error(`Ollama: ${resp.error}`);

      const toolCall = resp.message?.tool_calls?.[0]?.function;
      if (toolCall?.name === MEMORY_HELPER_TOOL_NAME && toolCall.arguments) {
        return toolCall.arguments as unknown as CompileMemoryIntentsResult;
      }

      const raw = resp.message?.content?.trim();
      if (!raw) return { should_recall: false, intents: [] };

      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
        return JSON.parse(cleaned) as CompileMemoryIntentsResult;
      } catch {
        return { should_recall: false, intents: [] };
      }
    },
  };
}
