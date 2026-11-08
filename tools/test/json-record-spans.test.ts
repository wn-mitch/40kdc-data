import { describe, expect, it } from "vitest";

import { scanAbilityRecordSpans } from "../src/json-record-spans.js";

describe("scanAbilityRecordSpans", () => {
  it("scans a record's members without being fooled by strings", () => {
    // A value containing `"game_version": {` and braces must not be mistaken for structure.
    const text = `[
  {
    "ability_id": "a-b",
    "name": "a \\" quote, a {brace} and \\"game_version\\": { text",
    "game_version": { "edition": "11th", "dataslate": "2025-q3" }
  }
]
`;
    const [span] = scanAbilityRecordSpans(text);
    expect(span.members.map((m) => m.key)).toEqual(["ability_id", "name", "game_version"]);
    expect(JSON.parse(text.slice(span.start, span.end))).toEqual(JSON.parse(text)[0]);
  });

  it("scans an empty array and an empty record", () => {
    expect(scanAbilityRecordSpans("[]\n")).toEqual([]);
    expect(scanAbilityRecordSpans("[\n  {}\n]\n")[0].members).toEqual([]);
  });

  it("refuses text that is not an array of objects", () => {
    expect(() => scanAbilityRecordSpans("{}")).toThrow(/JSON array/u);
  });
});
