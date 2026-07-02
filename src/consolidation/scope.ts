import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type MemoryScope = "global" | `project:${string}`;

const SCOPE_RE = /<!--\s*scope:([^>\s]+)\s*-->/;

export function projectHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function projectScope(projectHashValue: string | null | undefined): MemoryScope {
  return projectHashValue ? `project:${projectHashValue}` : "global";
}

export function parseScopeComment(line: string): MemoryScope | null {
  const raw = line.match(SCOPE_RE)?.[1]?.trim();
  if (!raw) return null;
  if (raw === "global") return "global";
  if (/^project:[a-f0-9]{12}$/i.test(raw)) return raw as MemoryScope;
  return null;
}

export function lineMatchesScope(
  line: string,
  allowedScopes: readonly MemoryScope[] | undefined,
): boolean {
  if (!allowedScopes || allowedScopes.length === 0) return true;
  const scope = parseScopeComment(line);
  if (!scope) return true;
  return allowedScopes.includes(scope);
}

export function findGitRoot(startDir: string | null | undefined): string | null {
  if (!startDir) return null;
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function scopeForCwd(cwd: string | null | undefined): {
  gitRoot: string | null;
  projectHash: string | null;
  scopes: MemoryScope[];
} {
  const gitRoot = findGitRoot(cwd);
  const hash = gitRoot ? projectHash(gitRoot) : null;
  return {
    gitRoot,
    projectHash: hash,
    scopes: hash ? ["global", `project:${hash}`] : ["global"],
  };
}
