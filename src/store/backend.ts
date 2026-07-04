import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import lockfile from "proper-lockfile";

import {
  MEMORY_LOCK_MAX_TIMEOUT_MS,
  MEMORY_LOCK_MIN_TIMEOUT_MS,
  MEMORY_LOCK_RETRIES,
} from "../constants/timing.js";

import { isAutoOverflowFile } from "./paths.js";

export class MarkdownMemoryBackend {
  constructor(private readonly memoryFile: string) {}

  async ensureAgentDir(): Promise<void> {
    await mkdir(dirname(this.memoryFile), { recursive: true });
  }

  async readText(path: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  async listAutoFiles(agentDir: string): Promise<string[]> {
    let names: string[] = [];
    try {
      names = await readdir(agentDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return names.filter(isAutoOverflowFile).sort();
  }

  autoFilePath(agentDir: string, fileName: string): string {
    return join(agentDir, fileName);
  }

  async deleteAutoFile(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async withMemoryLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureAgentDir();
    try {
      await readFile(this.memoryFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await writeFile(this.memoryFile, "", "utf8");
      } else {
        throw error;
      }
    }

    const release = await lockfile.lock(this.memoryFile, {
      retries: { retries: MEMORY_LOCK_RETRIES, minTimeout: MEMORY_LOCK_MIN_TIMEOUT_MS, maxTimeout: MEMORY_LOCK_MAX_TIMEOUT_MS },
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}
