import fs from "node:fs/promises";
import path from "node:path";

const LOCK_RETRIES = 50;
const LOCK_DELAY_MS = 100;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? LOCK_RETRIES;
  const delayMs = opts.delayMs ?? LOCK_DELAY_MS;
  let handle: fs.FileHandle | null = null;

  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });

  for (let i = 0; i < retries; i++) {
    try {
      handle = await fs.open(lockPath, "wx");
      break;
    } catch {
      await sleep(delayMs);
    }
  }

  if (!handle) {
    throw new Error(`could not acquire lock: ${lockPath}`);
  }

  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }
}
