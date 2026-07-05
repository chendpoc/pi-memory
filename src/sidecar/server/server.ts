import { createServer, type Server, type Socket } from "node:net";
import { writeFileSync } from "node:fs";

import { SIDECAR_PID_SUFFIX } from "../../constants/paths.js";
import { JsonlFramer, parseJsonlLine, serializeJsonlFrame } from "../../utils/jsonl.js";
import { ensureDirSync, pathDirname } from "../../utils/fs.js";
import { cleanupSocketFiles, removeSocketFile, secureSocketPath } from "../../utils/socket.js";
import type { SidecarRequest, SidecarResponse } from "../protocol.js";
import { handleQuery } from "./query.js";
import { handleReindex } from "./reindex.js";
import { handleStats } from "./stats.js";

export type SidecarServerOpts = {
  socketPath: string;
  dbPath: string;
};

export type SidecarServer = {
  server: Server;
  shutdown: () => void;
};

function writeResponse(socket: Socket, response: SidecarResponse): void {
  socket.write(serializeJsonlFrame(response));
}

function writeError(socket: Socket, error: string, requestId?: string): void {
  writeResponse(socket, { type: "error", request_id: requestId, error });
}

async function dispatchFrame(
  frame: SidecarRequest,
  socket: Socket,
  ctx: SidecarServerOpts,
): Promise<void> {
  switch (frame.type) {
    case "ping":
      writeResponse(socket, { type: "pong" });
      return;
    case "stats":
      writeResponse(socket, handleStats({ dbPath: ctx.dbPath }));
      return;
    case "query":
      writeResponse(socket, await handleQuery(frame.request_id, frame.query, { dbPath: ctx.dbPath }));
      return;
    case "reindex":
      writeResponse(
        socket,
        await handleReindex(frame.request_id, { dbPath: ctx.dbPath }, frame.documents),
      );
      return;
    default: {
      const unknown = frame as { type?: string; request_id?: string };
      writeError(socket, `unknown frame type: ${unknown.type ?? "undefined"}`, unknown.request_id);
    }
  }
}

export function createSidecarServer(opts: SidecarServerOpts): SidecarServer {
  const pidPath = opts.socketPath + SIDECAR_PID_SUFFIX;

  ensureDirSync(pathDirname(opts.socketPath));
  removeSocketFile(opts.socketPath);

  const server = createServer((socket) => {
    const framer = new JsonlFramer();

    socket.on("data", (chunk) => {
      for (const line of framer.push(chunk.toString())) {
        let frame: SidecarRequest;
        try {
          frame = parseJsonlLine<SidecarRequest>(line);
        } catch {
          writeError(socket, "invalid JSON frame");
          continue;
        }

        void dispatchFrame(frame, socket, opts).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const requestId = typeof frame === "object" && frame && "request_id" in frame
            ? String(frame.request_id)
            : undefined;
          writeError(socket, message, requestId);
        });
      }
    });
  });

  function shutdown(): void {
    server.close();
    cleanupSocketFiles(opts.socketPath, pidPath);
  }

  server.listen(opts.socketPath, () => {
    writeFileSync(pidPath, String(process.pid));
    secureSocketPath(opts.socketPath);
  });

  server.on("error", (error) => {
    console.error("Sidecar server error:", error);
    process.exit(1);
  });

  return { server, shutdown };
}
