import http from "node:http";
import https from "node:https";

import type { LLMClient } from "../trainer/llmExtractor.js";
import type { MemoryHelperLLM } from "../preflight/detectIntents.js";
import type { CompileMemoryIntentsResult } from "../preflight/detectIntents.js";
import {
  COMPILE_MEMORY_INTENTS_PARAMETERS,
  MEMORY_HELPER_TOOL_NAME,
} from "../preflight/detectIntents.js";

export interface OpenAICompatConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  tool_choice?: { type: "function"; function: { name: string } };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
}

async function postJSON<T>(url: URL, body: unknown, apiKey?: string): Promise<T> {
  const mod = url.protocol === "https:" ? https : http;
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(payload)),
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const req = mod.request(url, { method: "POST", headers, timeout: 120_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(text) as T); }
        catch { reject(new Error(`OpenAI-compat: invalid JSON: ${text.slice(0, 200)}`)); }
      });
    });
    req.on("error", (err) => reject(new Error(`OpenAI-compat: ${err.message}`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("OpenAI-compat: timeout")); });
    req.write(payload);
    req.end();
  });
}

export async function openaiCompatHealthCheck(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/v1/models", baseUrl);
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

export function createOpenAICompatLLMClient(cfg: OpenAICompatConfig): LLMClient {
  return {
    async complete(prompt: string): Promise<string> {
      const url = new URL("/v1/chat/completions", cfg.baseUrl);
      const body: ChatCompletionRequest = {
        model: cfg.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8192,
      };
      const resp = await postJSON<ChatCompletionResponse>(url, body, cfg.apiKey);
      if (resp.error?.message) throw new Error(`OpenAI-compat: ${resp.error.message}`);
      const text = resp.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("OpenAI-compat: empty response");
      return text;
    },
  };
}

export function createOpenAICompatMemoryHelper(cfg: OpenAICompatConfig): MemoryHelperLLM {
  return {
    async compileIntents(text: string): Promise<CompileMemoryIntentsResult> {
      const url = new URL("/v1/chat/completions", cfg.baseUrl);
      const body: ChatCompletionRequest = {
        model: cfg.model,
        messages: [
          {
            role: "user",
            content: `Analyze whether the user message requires recalling private episodic memory.\n\n<message>\n${text}\n</message>`,
          },
        ],
        max_tokens: 2048,
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
        tool_choice: { type: "function", function: { name: MEMORY_HELPER_TOOL_NAME } },
      };
      const resp = await postJSON<ChatCompletionResponse>(url, body, cfg.apiKey);
      if (resp.error?.message) throw new Error(`OpenAI-compat: ${resp.error.message}`);

      const msg = resp.choices?.[0]?.message;
      const toolCall = msg?.tool_calls?.[0]?.function;
      if (toolCall?.name === MEMORY_HELPER_TOOL_NAME && toolCall.arguments) {
        try {
          return JSON.parse(toolCall.arguments) as CompileMemoryIntentsResult;
        } catch { /* fall through */ }
      }

      const raw = msg?.content?.trim();
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
