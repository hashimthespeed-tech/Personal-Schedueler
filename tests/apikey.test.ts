import { describe, it, expect } from "vitest";
import { normalizeApiKey } from "../src/agents/client";

describe("API key normalization", () => {
  // A key with a trailing newline or wrapped in quotes is rejected with the
  // same 401 as a wrong key, which sends you looking in the wrong place.
  const expected = "sk-ant-api03-abc123";

  it.each([
    ["plain", "sk-ant-api03-abc123"],
    ["trailing newline", "sk-ant-api03-abc123\n"],
    ["trailing spaces", "sk-ant-api03-abc123   "],
    ["leading spaces", "   sk-ant-api03-abc123"],
    ["double quotes", '"sk-ant-api03-abc123"'],
    ["single quotes", "'sk-ant-api03-abc123'"],
    ["quotes then newline", '"sk-ant-api03-abc123"\n'],
  ])("strips %s", (_label, raw) => {
    expect(normalizeApiKey(raw)).toBe(expected);
  });
});
