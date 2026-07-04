import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { readPiMemoryEnv, type PiMemoryEnv } from "../../config/env.js";
import { isOllamaModelSpec, parseModelSpec } from "./modelSpec.js";
import { createOllamaLlmClient, ollamaHealthCheck } from "./ollama.js";
import { createOpenAICompatLlmClient, openaiCompatHealthCheck } from "./openai-compat.js";
import { createPiLlmClient } from "./pi-ai.js";
import { createStandaloneLlmClient } from "./standalone.js";
import type { LlmClient } from "./types.js";

export type CreateLlmClientOptions = {
  ctx?: ExtensionContext;
  modelSpec?: string;
  env?: PiMemoryEnv;
};

/** Best-effort LLM client for QueryIntent / consolidate. Returns null when unavailable. */
export async function createLlmClient(options: CreateLlmClientOptions = {}): Promise<LlmClient | null> {
  const env = options.env ?? readPiMemoryEnv();
  const modelSpec = options.modelSpec ?? env.helperModel;

  if (env.openaiCompatBaseUrl && env.openaiCompatModel) {
    const ok = await openaiCompatHealthCheck(env.openaiCompatBaseUrl);
    if (ok) {
      return createOpenAICompatLlmClient({
        baseUrl: env.openaiCompatBaseUrl,
        model: env.openaiCompatModel,
        apiKey: env.openaiCompatApiKey,
        timeoutMs: env.httpTimeoutMs,
      });
    }
  }

  const ollamaModel = env.ollamaLlmModel ?? (isOllamaModelSpec(modelSpec) ? parseModelSpec(modelSpec).modelId : undefined);
  if (ollamaModel) {
    const ok = await ollamaHealthCheck(env.ollamaLlmBaseUrl);
    if (ok) {
      return createOllamaLlmClient({
        baseUrl: env.ollamaLlmBaseUrl,
        model: ollamaModel,
        timeoutMs: env.httpTimeoutMs,
      });
    }
  }

  if (env.helperApiKey && modelSpec && !isOllamaModelSpec(modelSpec)) {
    try {
      return createStandaloneLlmClient(modelSpec, { apiKey: env.helperApiKey });
    } catch {
      // fall through to pi-ai
    }
  }

  if (options.ctx) {
    try {
      return createPiLlmClient(options.ctx, modelSpec);
    } catch {
      return null;
    }
  }

  return null;
}
