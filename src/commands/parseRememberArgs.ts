import { MEMORY_SECTIONS, type MemorySection } from "../store/types.js";

const SECTION_ALIASES: Record<string, MemorySection> = {
  preferences: "Preferences",
  preference: "Preferences",
  prefs: "Preferences",
  pref: "Preferences",
  conventions: "Conventions",
  convention: "Conventions",
  conv: "Conventions",
  findings: "Findings",
  finding: "Findings",
  todos: "Todos",
  todo: "Todos",
};

export type ParsedRememberArgs =
  | { section: MemorySection; content: string }
  | { error: string };

function normalizeArgs(raw: string | string[]): string {
  return (Array.isArray(raw) ? raw.join(" ") : raw).trim();
}

function matchSection(token: string): MemorySection | undefined {
  const key = token.toLowerCase();
  if (SECTION_ALIASES[key]) return SECTION_ALIASES[key];
  return MEMORY_SECTIONS.find((section) => section.toLowerCase() === key);
}

/** Parse `/remember [section]? content`. Default section: Findings. */
export function parseRememberArgs(raw: string | string[]): ParsedRememberArgs {
  const text = normalizeArgs(raw);
  if (!text) {
    return {
      error: "Usage: /remember [Preferences|Conventions|Findings|Todos] <content>",
    };
  }

  const space = text.indexOf(" ");
  const firstToken = space === -1 ? text : text.slice(0, space);
  const section = matchSection(firstToken);

  if (section) {
    const content = space === -1 ? "" : text.slice(space + 1).trim();
    if (!content) {
      return {
        error: `Usage: /remember ${section} <content>`,
      };
    }
    return { section, content };
  }

  return { section: "Findings", content: text };
}
