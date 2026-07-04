import { theme } from "../cli/theme.js";

export function isMemoryDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PI_MEMORY_DEBUG === "1" || env.PI_MEMORY_DEBUG === "true";
}

/** Debug-only stderr log; never shown to Pi UI or session. */
export function debugMemory(
  scope: string,
  message: string,
  fields?: Record<string, string | number | boolean | null | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isMemoryDebugEnabled(env)) return;

  const suffix =
    fields && Object.keys(fields).length > 0
      ? ` ${JSON.stringify(fields, (_key, value) => (value === undefined ? null : value))}`
      : "";

  console.error(theme.dim(`[${scope}] ${message}${suffix}`));
}
