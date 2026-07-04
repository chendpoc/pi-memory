import { describe, expect, it } from "vitest";

import {
  buildRetrievalQuery,
  parseQueryIntent,
  shouldExtractIntent,
  shouldRunEpisodicPreflight,
} from "../src/preflight/queryIntent.js";

describe("QueryIntentSchema", () => {
  it("accepts structured intent fields", () => {
    expect(
      parseQueryIntent({ what: "testing framework", who: "team", where: "project" }),
    ).toEqual({
      what: "testing framework",
      who: "team",
      where: "project",
    });
  });

  it("accepts raw_query", () => {
    expect(parseQueryIntent({ raw_query: "remember last time" })).toEqual({
      raw_query: "remember last time",
    });
  });

  it("rejects unknown keys", () => {
    expect(() => parseQueryIntent({ query: "hello" })).toThrow();
  });
});

describe("buildRetrievalQuery", () => {
  it("prefers raw_query over structured fields", () => {
    expect(
      buildRetrievalQuery(
        { raw_query: " verbatim search ", what: "ignored" },
        "fallback",
      ),
    ).toBe("verbatim search");
  });

  it("joins what/who/where", () => {
    expect(
      buildRetrievalQuery(
        { what: "Vitest", who: "chen", where: "pi-memory" },
        "fallback",
      ),
    ).toBe("Vitest chen pi-memory");
  });

  it("falls back to user input when intent is empty", () => {
    expect(buildRetrievalQuery({}, "  find prefs  ")).toBe("find prefs");
  });
});

describe("preflight gates", () => {
  it("skips episodic preflight for short generic prompts", () => {
    expect(shouldRunEpisodicPreflight("fix typo")).toBe(false);
    expect(shouldRunEpisodicPreflight("remember what we decided last time")).toBe(true);
  });

  it("forces intent extraction on first turn", () => {
    expect(shouldExtractIntent("fix typo", true)).toBe(true);
  });
});
