export type CliCommand = "consolidate" | "status" | "help";

export type CommonCliOptions = {
  agentDir?: string;
  verbose: boolean;
};

export type ConsolidateCliOptions = CommonCliOptions & {
  cron: boolean;
  force: boolean;
};

export type StatusCliOptions = CommonCliOptions;

export type ParsedCli =
  | { command: "help"; error?: string }
  | { command: "consolidate"; options: ConsolidateCliOptions }
  | { command: "status"; options: StatusCliOptions };

function parseCommonFlags(
  rest: string[],
  base: CommonCliOptions,
): ParsedCli | CommonCliOptions {
  const options = { ...base };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    switch (arg) {
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--agent-dir": {
        const value = rest[++i];
        if (!value) return { command: "help", error: "--agent-dir requires a path" };
        options.agentDir = value;
        break;
      }
      default:
        return { command: "help", error: `Unknown flag: ${arg}` };
    }
  }

  return options;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 0) {
    return { command: "help" };
  }

  const [command, ...rest] = args;
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }

  if (command === "status") {
    const parsed = parseCommonFlags(rest, { verbose: false });
    if ("command" in parsed) return parsed;
    return { command: "status", options: parsed };
  }

  if (command !== "consolidate") {
    return { command: "help", error: `Unknown command: ${command}` };
  }

  const options: ConsolidateCliOptions = {
    cron: false,
    force: false,
    verbose: false,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    switch (arg) {
      case "--cron":
        options.cron = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--agent-dir": {
        const value = rest[++i];
        if (!value) return { command: "help", error: "--agent-dir requires a path" };
        options.agentDir = value;
        break;
      }
      default:
        return { command: "help", error: `Unknown flag: ${arg}` };
    }
  }

  return { command: "consolidate", options };
}

export const CLI_HELP = `pi-memory — standalone tools for Pi local memory

Usage:
  pi-memory status [options]
  pi-memory consolidate [options]

Commands:
  status              Print MEMORY.md, sidecar, and vector index diagnostics
  consolidate         Run consolidate job (dedupe + optional reindex)

Options:
  --agent-dir PATH    Agent directory (default: PI_MEMORY_AGENT_DIR or ~/.pi/agent)
  --verbose, -v       Extra stderr output (TTY colors when supported)

Consolidate-only:
  --cron              Daily OS cron slot (passes cronFired to shouldConsolidate)
  --force             Run even when shouldConsolidate is false

Environment:
  PI_MEMORY_ENV_FILE   Explicit .env path
  PI_MEMORY_AGENT_DIR  Default agent directory
  PI_MEMORY_DEBUG=1    Debug stderr logs (extension preflight + CLI)
  NO_COLOR             Disable chalk colors

Examples:
  pi-memory status
  pi-memory consolidate --cron
  pi-memory consolidate --force --verbose
`;
