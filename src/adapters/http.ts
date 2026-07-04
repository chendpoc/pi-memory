export type PostJsonOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class HttpRequestError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${url} failed (${status}): ${body}`);
    this.name = "HttpRequestError";
  }
}

export async function postJson<T>(
  url: string,
  body: unknown,
  opts: PostJsonOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new HttpRequestError(url, res.status, text);
  }

  return JSON.parse(text) as T;
}
