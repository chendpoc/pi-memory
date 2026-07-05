// Agent 侧：发送请求到 sidecar
import { randomUUID } from "node:crypto";
import net from "node:net";

import {
  SIDECAR_PING_TIMEOUT_MS,
  SIDECAR_QUERY_TIMEOUT_MS,
  SIDECAR_REINDEX_TIMEOUT_MS,
} from "../constants/timing.js";
import { JsonlFramer, parseJsonlLine, serializeJsonlFrame } from "../utils/jsonl.js";
import { isErrorResponse, type IndexDocument, type IndexStats, type SidecarResponse } from "./protocol.js";

export function sidecarRequest<T extends SidecarResponse>(
  socketPath: string,
  frame: Record<string, unknown>,
  timeoutMs = SIDECAR_QUERY_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const framer = new JsonlFramer();

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Sidecar request timed out"));
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(serializeJsonlFrame(frame));
    });

    socket.on("data", (chunk) => {
      for (const line of framer.push(chunk.toString())) {
        clearTimeout(timer);
        socket.end();

        let response: SidecarResponse;
        try {
          response = parseJsonlLine<SidecarResponse>(line);
        } catch {
          reject(new Error("Invalid JSON response from sidecar"));
          return;
        }

        if (isErrorResponse(response)) {
          reject(new Error(response.error));
          return;
        }

        resolve(response as T);
        return;
      }
    });

    socket.on("error", reject);
  });
}

export async function ping(socketPath: string): Promise<boolean> {
  try {
    const res = await sidecarRequest<Extract<SidecarResponse, { type: "pong" }>>(
      socketPath,
      { type: "ping" },
      SIDECAR_PING_TIMEOUT_MS,
    );
    return res.type === "pong";
  } catch {
    return false;
  }
}

export async function fetchIndexStats(
  socketPath: string,
): Promise<{ stats: IndexStats } | { error: string }> {
  try {
    const res = await sidecarRequest<Extract<SidecarResponse, { type: "stats_ok" }>>(
      socketPath,
      { type: "stats" },
      SIDECAR_PING_TIMEOUT_MS,
    );
    if (res.type !== "stats_ok") return { error: "unexpected sidecar response" };
    const { type: _type, ...stats } = res;
    return { stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

export async function query(
  socketPath: string,
  queryText: string,
  timeoutMs = SIDECAR_QUERY_TIMEOUT_MS,
) {
  const request_id = randomUUID();
  return sidecarRequest<Extract<SidecarResponse, { type: "result" }>>(
    socketPath,
    { type: "query", request_id, query: queryText },
    timeoutMs,
  );
}

export type ReindexResult = Extract<SidecarResponse, { type: "reindex_ok" }>;

export async function reindex(
  socketPath: string,
  documents: IndexDocument[] = [],
): Promise<ReindexResult> {
  const request_id = randomUUID();
  return sidecarRequest<ReindexResult>(
    socketPath,
    { type: "reindex", request_id, documents },
    SIDECAR_REINDEX_TIMEOUT_MS,
  );
}
