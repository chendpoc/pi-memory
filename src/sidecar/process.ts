import { access, constants } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import type { MemoryConfig } from "../config.js";
import { SidecarClient } from "./client.js";

export class SidecarProcess {
  private child: ChildProcess | null = null;
  private readonly client: SidecarClient;

  constructor(private readonly cfg: MemoryConfig) {
    this.client = new SidecarClient(
      cfg.socketPath,
      Math.min(cfg.clientRequestTimeoutMs, 5_000),
    );
  }

  getClient(): SidecarClient {
    return this.client;
  }

  async resolveBinary(): Promise<string> {
    const bin = this.cfg.tlmPath;
    if (path.isAbsolute(bin)) {
      await access(bin, constants.X_OK);
      return bin;
    }
    const resolved = await which(bin);
    if (!resolved) throw new Error(`${bin} not found in PATH`);
    return resolved;
  }

  async spawn(): Promise<void> {
    const bin = await this.resolveBinary().catch(() => {
      throw new Error("memory: tlm binary not found");
    });

    if (this.cfg.socketPath) {
      try {
        fs.unlinkSync(this.cfg.socketPath);
      } catch {
        /* absent */
      }
    }

    const args = [
      "serve",
      "--socket",
      this.cfg.socketPath,
      "--bundle-root",
      this.cfg.bundleRoot,
    ];

    this.child = spawn(bin, args, {
      stdio: "ignore",
      detached: process.platform !== "win32",
    });

    this.child.on("error", () => {
      /* handled by waitReady timeout */
    });

    this.child.unref?.();
  }

  async waitReady(signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.cfg.sidecarReadyTimeoutMs;
    let lastCompat = "";
    let lastSub = "";

    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");

      try {
        const h = await this.client.health(signal);
        lastCompat = h.compatibility ?? "";
        lastSub = h.error ? String(h.error.details?.sub_code ?? "") : "";

        if (h.ready === true) return;
        if (h.compatibility === "unknown") return;
        if (h.compatibility === "incompatible") {
          // keep polling until ceiling — supervisor classifies schema mismatch
        }
      } catch {
        /* sidecar still starting */
      }

      await sleep(500, signal);
    }

    throw new Error(
      `memory: sidecar ready ceiling exceeded` +
        (lastCompat === "incompatible" && lastSub
          ? ` (incompatible: ${lastSub})`
          : ""),
    );
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child?.pid) return;

    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already dead */
        }
      }
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2_000);
      child.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

async function which(cmd: string): Promise<string | null> {
  const { execFileSync } = await import("node:child_process");
  try {
    const result = execFileSync(
      process.platform === "win32" ? "where" : "which",
      [cmd],
      { encoding: "utf8", timeout: 3_000 },
    ).trim();
    return result.split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}
