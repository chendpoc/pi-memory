import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { LlmClient } from "./types.js";
import { extractTextFromResponse } from "./extractText.js";
import { parseModelSpec } from "./modelSpec.js";

async function resolveModelAuth(ctx: ExtensionContext, provider: string, modelId: string) {
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) return null;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return null;

  return {
    model,
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
  };
}

export function createPiLlmClient(ctx: ExtensionContext, modelSpec?: string): LlmClient {
  const { provider, modelId } = parseModelSpec(modelSpec);

  return {
    async complete(prompt, signal) {
      const resolved = await resolveModelAuth(ctx, provider, modelId);
      if (!resolved) {
        throw new Error(`LLM model not available: ${provider}/${modelId}`);
      }

      const response = await complete(
        resolved.model,
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: resolved.apiKey,
          headers: resolved.headers,
          env: resolved.env,
          maxTokens: 1024,
          signal,
        },
      );

      const text = extractTextFromResponse(response.content);
      if (!text.trim()) {
        throw new Error("LLM response was empty");
      }
      return text;
    },
  };
}
