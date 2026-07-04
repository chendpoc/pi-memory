export type CliCommand = "consolidate" | "help";

export type ConsolidateCliOptions = {
  cron: boolean;
  force: boolean;
  agentDir?: string;
  verbose: boolean;
};

export type ParsedCli =
  | { command: "help"; error?: string }
  | { command: "consolidate"; options: ConsolidateCliOptions };

export function parseCliArgs(argv: string[]): ParsedCli {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 0) {
    return { command: "help" };
  }

  const [command, ...rest] = args;
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
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
  pi-memory consolidate [options]

Options:
  --cron              Daily OS cron slot (passes cronFired to shouldConsolidate)
  --force             Run even when shouldConsolidate is false
  --agent-dir PATH    Agent directory (default: PI_MEMORY_AGENT_DIR or ~/.pi/agent)
  --verbose, -v       Log actions to stderr

Environment:
  PI_MEMORY_ENV_FILE   Explicit .env path
  PI_MEMORY_AGENT_DIR  Default agent directory
  See .env.example for LLM / embedder settings.

Examples:
  pi-memory consolidate --cron
  pi-memory consolidate --force --verbose
`;
