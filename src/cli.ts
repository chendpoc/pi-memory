#!/usr/bin/env node

import { loadEnv } from "./config/loadEnv.js";
import { resolveAgentDirFromEnv } from "./config/agentDir.js";
import { createLlmClient } from "./adapters/llm/index.js";
import { runConsolidateJob } from "./consolidate/runJob.js";
import { createCliLog } from "./cli/log.js";
import { CLI_HELP, parseCliArgs } from "./cli/parseArgs.js";
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

  const agentDir = resolveAgentDirFromEnv(parsed.options.agentDir);

  if (parsed.command === "status") {
    const log = createCliLog({ verbose: true, debug: parsed.options.verbose });
    return runStatusCommand(agentDir, log);
  }

  const { options } = parsed;
  const log = createCliLog({ verbose: options.verbose });

  const store = createMemoryStore({ agentDir });
  await store.ensureInitialized();

  const llm = await createLlmClient();
  if (options.verbose && !llm) {
    log.warn("no helper LLM configured; using rule-based dedupe only");
  }

  log.debug(`consolidate agentDir=${agentDir} cron=${options.cron} force=${options.force}`);

  const result = await runConsolidateJob({
    store,
    agentDir,
    llm,
    cronFired: options.cron,
    force: options.force,
  });

  switch (result.status) {
    case "skipped":
      log.warn("consolidate skipped (conditions not met)");
      return 0;
    case "consolidated":
      log.success("consolidate complete");
      if (options.verbose) {
        log.line("entries", `${result.stats.entriesBefore} → ${result.stats.entriesAfter}`);
        log.line("overflow files", `${result.stats.overflowBefore} → ${result.stats.overflowAfter}`);
        if (result.stats.indexGeneration !== undefined) {
          log.line("index generation", String(result.stats.indexGeneration));
        }
      }
      return 0;
    case "failed":
      log.error(`consolidate failed: ${result.error.message}`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    const log = createCliLog({ verbose: true });
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
