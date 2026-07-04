export type LlmClient = {
  complete(prompt: string, signal?: AbortSignal): Promise<string>;
};

export type OllamaLlmConfig = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

export type OpenAICompatLlmConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
};
