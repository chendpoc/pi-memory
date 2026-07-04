import chalk from "chalk";

function colorEnabled(stream: NodeJS.WriteStream = process.stderr): boolean {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0";
}

export function paint(
  fn: (text: string) => string,
  text: string,
  stream: NodeJS.WriteStream = process.stderr,
): string {
  return colorEnabled(stream) ? fn(text) : text;
}

export const theme = {
  prefix: (stream?: NodeJS.WriteStream) => paint(chalk.cyan.bold, "pi-memory", stream),
  info: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.blue, text, stream),
  success: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.green, text, stream),
  warn: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.yellow, text, stream),
  error: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.red, text, stream),
  dim: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.dim, text, stream),
  label: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.gray, text, stream),
  value: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.white, text, stream),
  ok: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.green, text, stream),
  bad: (text: string, stream?: NodeJS.WriteStream) => paint(chalk.red, text, stream),
};
