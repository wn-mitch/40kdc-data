import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/*
 * Fabricated wording. A lead-in names a list that follows it; each list item is one leaf.
 * Each case pins one fold or one refusal of the ignore-list binder.
 */

type Piece = [phrase: string, family: string, parameters: Record<string, unknown>, role?: string];

const LEAD: Piece = ["that model's attacks can ignore modifiers to the following", "ignore-modifiers", { subject: "antecedent", what: ["characteristics"] }];
const DURATION: Piece = ["until the start of your next Movement phase", "duration", { endpoint: "start-of-next-movement-phase" }];
const STATS: Piece = ["BS", "ignore-modifier-list", { stats: ["BS"] }];
const ROLLS: Piece = ["Hit rolls** and **wound rolls", "ignore-modifier-list", { rolls: ["hit", "wound"] }];

function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters, role]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    const roleOf = role ?? (family_id === "duration" ? "DURATION" : family_id === "ignore-modifier-list" ? "CONDITION" : "EFFECT");
    return {
      role: roleOf, family_id, family_version: currentFamilyVersion(family_id), parameters,
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT",
    };
  });
}

const TEXT = "Sample vehicle: that model's attacks can ignore modifiers to the following until the start of your next Movement phase: **BS**. **Hit rolls** and **wound rolls**.";

function compiled(text: string, pieces: Piece[]) {
  const result = compileLeaves(leavesIn(text, pieces), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function refused(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(leavesIn(text, pieces), text);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("ignore-modifier list after a lead-in", () => {
  it("folds a stats item and a rolls item onto the lead-in", () => {
    const result = compiled(TEXT, [LEAD, DURATION, STATS, ROLLS]);
    const mechanics = JSON.stringify(result.mechanics);
    // The stats item and the rolls item each become their own single-kind ignore.
    expect(mechanics).toContain('"stats":["BS"]');
    expect(mechanics).toContain('"rolls":["hit","wound"]');
    expect(mechanics).not.toContain('"what":["characteristics","rolls"]');
  });

  it("gives a rolls-only list no characteristic ignore", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to the following: **Hit rolls** and **wound rolls**.";
    const result = compiled(text, [LEAD, ["Hit rolls** and **wound rolls", "ignore-modifier-list", { rolls: ["hit", "wound"] }]]);
    const mechanics = JSON.stringify(result.mechanics);
    expect(mechanics).toContain('"rolls":["hit","wound"]');
    expect(mechanics).not.toContain("characteristics");
  });

  it("refuses a lead-in that names a list with no list after it", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to the following until the start of your next Movement phase.";
    const errors = refused(text, [LEAD, DURATION]);
    expect(errors.join(" ")).toMatch(/no list follows/);
  });

  it("leaves an ordinary characteristic ignore with no list untouched", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to characteristics.";
    const plain: Piece = ["that model's attacks can ignore modifiers to characteristics", "ignore-modifiers", { subject: "antecedent", what: ["characteristics"] }];
    expect(compiled(text, [plain]).ok).toBe(true);
  });

  it("refuses a list item with no lead-in before it", () => {
    const errors = refused(TEXT, [STATS]);
    expect(errors.join(" ")).toMatch(/no ignore-modifiers lead-in/);
  });

  it("refuses a missing colon between the lead-in and its first item", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to the following until the start of your next Movement phase. **BS**.";
    const errors = refused(text, [LEAD, DURATION, STATS]);
    expect(errors.join(" ")).toMatch(/after a colon/);
  });

  it("refuses items with no full stop between them", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to the following until the start of your next Movement phase: **BS** **Hit rolls** and **wound rolls**.";
    const errors = refused(text, [LEAD, DURATION, STATS, ROLLS]);
    expect(errors.join(" ")).toMatch(/after a full stop/);
  });

  it("refuses two items that both name stats", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to the following until the start of your next Movement phase: **BS**. **WS**.";
    const second: Piece = ["WS", "ignore-modifier-list", { stats: ["WS"] }];
    const errors = refused(text, [LEAD, DURATION, STATS, second]);
    expect(errors.join(" ")).toMatch(/name stats/);
  });

  it("refuses a non-list leaf between the lead-in and its list", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to the following, and move again: **BS**.";
    const errors = refused(text, [LEAD, ["and move again", "unit-owner", { owner: "friendly" }], STATS]);
    expect(errors.join(" ")).toMatch(/sits between/);
  });

  it("refuses a lead-in whose own list names stats already", () => {
    const withStats: Piece = [LEAD[0], LEAD[1], { subject: "antecedent", what: ["characteristics"], stats: ["WS"] }];
    const errors = refused(TEXT, [withStats, DURATION, STATS]);
    expect(errors.join(" ")).toMatch(/already names stats or rolls/);
  });

  it("refuses a duration between two list items", () => {
    const text = "Sample vehicle: that model's attacks can ignore modifiers to the following: **BS**. until the start of your next Movement phase **Hit rolls** and **wound rolls**.";
    const errors = refused(text, [LEAD, STATS, DURATION, ROLLS]);
    expect(errors.join(" ")).toMatch(/duration sits between/);
  });

  it("requires at least one of stats and rolls on a list item", () => {
    expect(() => normalizeFingerprintParameters("ignore-modifier-list", {}, 1)).toThrow(/at least one/);
    expect(() => normalizeFingerprintParameters("ignore-modifier-list", { stats: ["BS"], subject: "x" }, 1)).toThrow(/at least one|stats and\/or rolls/);
  });
});
