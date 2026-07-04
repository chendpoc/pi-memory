import { MEMORY_SECTIONS } from "../types.js";

export function defaultMemoryTemplate(): string {
  return `${MEMORY_SECTIONS.map((section) => `## ${section}\n`).join("\n")}\n`;
}
