export type CliCommand =
  | "consolidate"
  | "maintenance"
  | "drain-shutdown-queue"
  | "init"
  | "status"
  | "scheduler-sync"
  | "help";

export type CommonCliOptions = {
  agentDir?: string;
  verbose: boolean;
};

export type ConsolidateCliOptions = CommonCliOptions & {
  cron: boolean;
  force: boolean;
};

export type MaintenanceCliOptions = ConsolidateCliOptions;

export type DrainShutdownQueueCliOptions = CommonCliOptions;

export type StatusCliOptions = CommonCliOptions;

export type InitCliOptions = CommonCliOptions;

export type ParsedCli =
  | { command: "help"; error?: string }
  | { command: "consolidate"; options: ConsolidateCliOptions }
  | { command: "maintenance"; options: MaintenanceCliOptions }
  | { command: "drain-shutdown-queue"; options: DrainShutdownQueueCliOptions }
  | { command: "init"; options: InitCliOptions }
  | { command: "status"; options: StatusCliOptions }
  | { command: "scheduler-sync"; options: CommonCliOptions };

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

function parseConsolidateLikeFlags(
  rest: string[],
  command: Extract<CliCommand, "consolidate" | "maintenance">,
): ParsedCli {
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

  return { command, options };
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

  if (command === "init") {
    const parsed = parseCommonFlags(rest, { verbose: false });
    if ("command" in parsed) return parsed;
    return { command: "init", options: parsed };
  }

  if (command === "consolidate") {
    return parseConsolidateLikeFlags(rest, "consolidate");
  }

  if (command === "maintenance") {
    return parseConsolidateLikeFlags(rest, "maintenance");
  }

  if (command === "drain-shutdown-queue") {
    const parsed = parseCommonFlags(rest, { verbose: false });
    if ("command" in parsed) return parsed;
    return { command: "drain-shutdown-queue", options: parsed };
  }

  if (command === "scheduler") {
    const [subcommand, ...subRest] = rest;
    if (subcommand !== "sync") {
      return { command: "help", error: "Usage: pi-memory scheduler sync" };
    }
    const parsed = parseCommonFlags(subRest, { verbose: false });
    if ("command" in parsed) return parsed;
    return { command: "scheduler-sync", options: parsed };
  }

  return { command: "help", error: `Unknown command: ${command}` };
}

export const CLI_HELP = `pi-memory — standalone tools for Pi local memory

Usage:
  pi-memory init [options]
  pi-memory status [options]
  pi-memory maintenance [options]
  pi-memory consolidate [options]
  pi-memory drain-shutdown-queue [options]
  pi-memory scheduler sync [options]

Commands:
  init                    Create MEMORY.md from template when missing or empty
  status                  Print MEMORY.md, sidecar, and vector index diagnostics
  maintenance             Daily job: consolidate, then drain shutdown queue
  consolidate             Run consolidate job (dedupe + optional reindex)
  drain-shutdown-queue    Ingest durable facts from queued session shutdown metadata
  scheduler sync          Install or refresh the OS maintenance scheduler (macOS launchd)

Options:
  --agent-dir PATH        Memory data directory (overrides PI_MEMORY_AGENT_DIR)
  --verbose, -v           Extra stderr output (TTY colors when supported)

Consolidate / maintenance:
  --cron                  Daily OS cron slot (passes cronFired to shouldConsolidate)
  --force                 Run consolidate even when shouldConsolidate is false

Environment:
  PI_MEMORY_ENV_FILE        Explicit .env path
  PI_MEMORY_AGENT_DIR       Memory data root; default ~/.pi/pi-memory-data
  PI_MEMORY_DEBUG=1         Debug stderr logs (extension preflight + CLI)
  PI_MEMORY_SKIP_SCHEDULER_SYNC=1  Skip automatic launchd install/update
  NO_COLOR                  Disable chalk colors

Examples:
  pi-memory init
  pi-memory status
  pi-memory maintenance --cron --verbose
  pi-memory consolidate --force --verbose
  pi-memory drain-shutdown-queue --verbose
`;
