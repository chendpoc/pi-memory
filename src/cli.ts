#!/usr/bin/env node

import { createLlmClient } from "./adapters/llm/index.js";
import { resolveAgentDirFromEnv } from "./config/agentDir.js";
import { loadEnv } from "./config/loadEnv.js";
import {
  runConsolidateCommand,
  runDrainShutdownQueueCommand,
  runMaintenanceCommand,
} from "./cli/jobs.js";
import { createCliLog } from "./cli/log.js";
import { CLI_HELP, parseCliArgs } from "./cli/parseArgs.js";
import { runInitCommand } from "./cli/init.js";
import { runSchedulerSyncCommand } from "./cli/schedulerSync.js";
import { runStatusCommand } from "./cli/status.js";
import { theme } from "./cli/theme.js";
import { createMemoryStore } from "./store/index.js";

async function main(): Promise<number> {
  loadEnv();

  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === "help") {
    if (parsed.error) {
      console.error(theme.error(parsed.error));
    }
    console.log(CLI_HELP);
    return parsed.error ? 1 : 0;
  }

  const agentDir = resolveAgentDirFromEnv(
    "options" in parsed ? parsed.options.agentDir : undefined,
  );

  if (parsed.command === "init") {
    const log = createCliLog({ verbose: true, debug: parsed.options.verbose });
    return runInitCommand(agentDir, log);
  }

  if (parsed.command === "scheduler-sync") {
    const log = createCliLog({ verbose: true, debug: parsed.options.verbose });
    return runSchedulerSyncCommand(agentDir, log);
  }

  if (parsed.command === "status") {
    const log = createCliLog({ verbose: true, debug: parsed.options.verbose });
    return runStatusCommand(agentDir, log);
  }

  const store = createMemoryStore({ agentDir });
  await store.ensureInitialized();

  const llm = await createLlmClient();

  if (parsed.command === "maintenance") {
    const log = createCliLog({ verbose: parsed.options.verbose });
    if (parsed.options.verbose && !llm) {
      log.warn(
        "no helper LLM configured; consolidate uses rule-based dedupe; shutdown drain skips LLM extract",
      );
    }
    return runMaintenanceCommand({
      store,
      agentDir,
      llm,
      options: parsed.options,
      log,
    });
  }

  if (parsed.command === "drain-shutdown-queue") {
    const log = createCliLog({ verbose: parsed.options.verbose });
    if (parsed.options.verbose && !llm) {
      log.warn("no helper LLM configured; shutdown drain skips sessions without compaction export");
    }
    return runDrainShutdownQueueCommand({
      store,
      agentDir,
      llm,
      verbose: parsed.options.verbose,
      log,
    });
  }

  if (parsed.command === "consolidate") {
    const log = createCliLog({ verbose: parsed.options.verbose });
    if (parsed.options.verbose && !llm) {
      log.warn("no helper LLM configured; using rule-based dedupe only");
    }
    return runConsolidateCommand({
      store,
      agentDir,
      llm,
      cron: parsed.options.cron,
      force: parsed.options.force,
      verbose: parsed.options.verbose,
      log,
    });
  }

  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    const log = createCliLog({ verbose: true });
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
