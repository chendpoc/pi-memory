import os from "node:os";
import path from "node:path";

/** Expands a leading ~ to the user home directory. */
export function expandPath(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function defaultPiHome(): string {
  return path.join(os.homedir(), ".pi");
}

export function defaultBundleRoot(): string {
  return path.join(defaultPiHome(), "memory");
}

export function defaultSocketPath(): string {
  return path.join(defaultPiHome(), "memory.sock");
}

export function defaultSessionsDir(): string {
  return path.join(defaultPiHome(), "agent", "sessions");
}
