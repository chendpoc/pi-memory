/** Incremental JSONL (one JSON object per line) framing for UDS IPC and queue files. */

export class JsonlFramer {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim()) lines.push(line);
    }
    return lines;
  }

  reset(): void {
    this.buffer = "";
  }
}

export function serializeJsonlFrame(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function parseJsonlLine<T>(line: string): T {
  return JSON.parse(line) as T;
}
