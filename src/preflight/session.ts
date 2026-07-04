import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function isSubagentSession(ctx: ExtensionContext): boolean {
  const header = ctx.sessionManager.getHeader() as unknown as Record<string, unknown> | null;
  const parent = header?.parentSession ?? header?.parent_session;
  return typeof parent === "string" && parent.trim().length > 0;
}
