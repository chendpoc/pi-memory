#!/usr/bin/env node

import { loadEnv } from "./config/loadEnv.js";
import { resolveAgentDirFromEnv } from "./config/agentDir.js";
import { createLlmClient } from "./adapters/llm/index.js";
import { runConsolidateJob } from "./consolidate/runJob.js";
import { CLI_HELP, parseCliArgs } from "./cli/parseArgs.js";
import { createMemoryStore } from "./store/index.js";

async function main(): Promise<number> {
  loadEnv();

  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === "help") {
    if (parsed.error) console.error(parsed.error);
    console.log(CLI_HELP);
    return parsed.error ? 1 : 0;
  }

  const { options } = parsed;
  const agentDir = resolveAgentDirFromEnv(options.agentDir);
  const store = createMemoryStore({ agentDir });
  await store.ensureInitialized();

  const llm = await createLlmClient();
  if (options.verbose && !llm) {
    console.error("pi-memory: no helper LLM configured; using rule-based dedupe only");
  }

  const result = await runConsolidateJob({
    store,
    agentDir,
    llm,
    cronFired: options.cron,
    force: options.force,
  });

  switch (result.status) {
    case "skipped":
      if (options.verbose) console.error("pi-memory: consolidate skipped (conditions not met)");
      return 0;
    case "consolidated":
      if (options.verbose) console.error("pi-memory: consolidate complete");
      return 0;
    case "failed":
      console.error(`pi-memory: consolidate failed: ${result.error.message}`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`pi-memory: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
