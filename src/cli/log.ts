import { theme } from "./theme.js";

export type CliLogOptions = {
  verbose?: boolean;
  debug?: boolean;
};

export type CliLog = {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  line(label: string, value: string): void;
};

function prefix(): string {
  return `${theme.prefix()} `;
}

export function createCliLog(opts: CliLogOptions = {}): CliLog {
  const debugOn = opts.debug ?? process.env.PI_MEMORY_DEBUG === "1";

  return {
    info(message) {
      if (!opts.verbose) return;
      console.error(prefix() + theme.info(message));
    },
    success(message) {
      console.error(prefix() + theme.success(message));
    },
    warn(message) {
      console.error(prefix() + theme.warn(message));
    },
    error(message) {
      console.error(prefix() + theme.error(message));
    },
    debug(message) {
      if (!debugOn && !opts.verbose) return;
      console.error(prefix() + theme.dim(message));
    },
    line(label, value) {
      console.error(`${prefix()}${theme.label(`${label}`.padEnd(16))} ${theme.value(value)}`);
    },
  };
}
