import { describe, expect, it } from "vitest";

import { JsonlFramer, parseJsonlLine, serializeJsonlFrame } from "../src/utils/jsonl.js";

describe("JsonlFramer", () => {
  it("extracts complete lines from partial chunks", () => {
    const framer = new JsonlFramer();
    expect(framer.push('{"type":"ping"}\n{"type":')).toEqual(['{"type":"ping"}']);
    expect(framer.push('"pong"}\n')).toEqual(['{"type":"pong"}']);
  });

  it("ignores empty lines", () => {
    const framer = new JsonlFramer();
    expect(framer.push('\n{"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it("serializes and parses frames", () => {
    const frame = { type: "query", request_id: "1", query: "hello" };
    const line = serializeJsonlFrame(frame);
    expect(line.endsWith("\n")).toBe(true);
    expect(parseJsonlLine(line.trim())).toEqual(frame);
  });
});
