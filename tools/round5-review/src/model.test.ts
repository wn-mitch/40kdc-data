import { describe, expect, it } from "vitest";

import { utf8Selection } from "./model";

describe("utf8Selection", () => {
  it("converts browser text selections into UTF-8 byte spans", () => {
    const selection = utf8Selection("Mōdel re-rolls", 0, 5);
    expect(selection).toEqual({ start: 0, end: 6, text: "Mōdel" });
  });

  it("counts astral characters as four bytes and two code units", () => {
    expect(utf8Selection("a😀b", 1, 3)).toEqual({ start: 1, end: 5, text: "😀" });
  });

  it("rejects a range outside the text", () => {
    expect(() => utf8Selection("abc", 2, 4)).toThrow(/Invalid text selection/);
    expect(() => utf8Selection("abc", 2, 1)).toThrow(/Invalid text selection/);
  });
});
