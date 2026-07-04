import { existsSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { defaultPiEnvFile } from "../utils/paths.js";
import { readPiMemoryEnv } from "./env.js";

/**
 * Load `.env` into process.env (does not override existing vars).
 * Windows / macOS / Linux: Node `process.env` behaves the same; path uses `node:path`.
 *
 * Search order:
 * 1. PI_MEMORY_ENV_FILE (explicit)
 * 2. cwd `.env` / `.env.local`
 * 3. ~/.pi/.env (Pi user config)
 */
export function loadEnv(cwd = process.cwd()): void {
  const paths: string[] = [];
  const explicit = readPiMemoryEnv(process.env).envFile;
  if (explicit) paths.push(explicit);

  paths.push(join(cwd, ".env"), join(cwd, ".env.local"), defaultPiEnvFile());

  for (const path of paths) {
    if (!path || !existsSync(path)) continue;
    config({ path, override: false, quiet: true });
  }
}
