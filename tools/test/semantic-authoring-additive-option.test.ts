import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { bindAdditiveOptions } from "../src/semantic-authoring/compile-additive-option.js";

/*
 * Fabricated wording. The activation names a sample option; the qualifier, printed after the
 * duration, adds it to the options already active. Each case pins one refusal or the fold itself.
 */

const TEXT = "Sample hero: select one sample option to be active for this unit until the start of your next Command phase, in addition to any other sample option.";
type Piece = [phrase: string, family: string, parameters: Record<string, unknown>, role?: string];

const ACTIVATE: Piece = ["select one sample option to be active for this unit", "ability-activate", { subject: "this-unit", ability: "sample-options-ability", choose: { count: 1 } }];
const DURATION: Piece = ["until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }];
const QUALIFIER: Piece = ["in addition to any other sample option", "additive-option", {}];

function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters, role]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    const roleOf = role ?? (family_id === "duration" ? "DURATION" : family_id === "additive-option" ? "CONDITION" : "EFFECT");
    return {
      role: roleOf, family_id, family_version: currentFamilyVersion(family_id), parameters,
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT",
    };
  });
}

function refused(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(leavesIn(text, pieces), text);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("additive option qualifier", () => {
  it("folds onto the activation before it, past its duration", () => {
    const result = compileLeaves(leavesIn(TEXT, [ACTIVATE, DURATION, QUALIFIER]), TEXT);
    expect(result.ok).toBe(true);
    // Additive means no exclusive: the other options stay active alongside this one.
    expect(JSON.stringify(result.ok ? result.mechanics : {})).not.toContain("exclusive");
  });

  it("keeps the activation exclusive when no qualifier is printed", () => {
    const plain = compileLeaves(leavesIn(TEXT, [ACTIVATE, DURATION]), TEXT);
    expect(plain.ok).toBe(true);
    expect(JSON.stringify(plain.ok ? plain.mechanics : {})).toContain("exclusive");
  });

  it("refuses when no activation precedes it in its clause", () => {
    const errors = refused(TEXT, [DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/no activation before it/);
  });

  it("refuses when the nearest effect is not an ability-activate", () => {
    const errors = refused(TEXT, [["select one sample option to be active for this unit", "stance-select-open", { options: ["a", "b"] }], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/no additive form/);
  });

  it("refuses an activation that already keeps every option active", () => {
    const allOptions: Piece = [ACTIVATE[0], ACTIVATE[1], { subject: "this-unit", ability: "sample-options-ability", all_options: true }];
    const errors = refused(TEXT, [allOptions, DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/cannot apply|additive/);
  });

  it("refuses two qualifiers that claim one activation", () => {
    const text = `${TEXT} In addition to any other sample option.`;
    const errors = refused(text, [ACTIVATE, DURATION, QUALIFIER, ["In addition to any other sample option", "additive-option", {}]]);
    expect(errors.join(" ")).toMatch(/claim one activation/);
  });

  it("refuses a sentence stop between the duration and the qualifier", () => {
    const text = "Sample hero: select one sample option to be active for this unit until the start of your next Command phase. In addition to any other sample option.";
    const errors = refused(text, [ACTIVATE, DURATION, ["In addition to any other sample option", "additive-option", {}]]);
    expect(errors.join(" ")).toMatch(/more than its duration/);
  });

  it("refuses a qualifier separated from its activation by an event", () => {
    const text = "Sample hero: select one sample option to be active for this unit at the start of your Command phase until the start of your next Command phase, in addition to any other sample option.";
    const errors = refused(text, [ACTIVATE, ["at the start of your Command phase", "event", {}, "EVENT"], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/separated from its activation by event/);
  });

  it("refuses a qualifier in a clause with no effect (the Orders shape)", () => {
    const text = "Sample squad: once per battle round, you can select one order to affect this unit until the start of your next Command phase, in addition to any other order.";
    const errors = refused(text, [DURATION, ["in addition to any other order", "additive-option", {}]]);
    expect(errors.join(" ")).toMatch(/no activation before it/);
  });

  it("needs source text to check its clause", () => {
    expect(() => bindAdditiveOptions(leavesIn(TEXT, [ACTIVATE, DURATION, QUALIFIER]))).toThrow(/needs source text/);
  });

  it("takes no parameters, so an extra key fails normalization", () => {
    expect(() => normalizeFingerprintParameters("additive-option", { keyword: "x" }, 1)).toThrow(/parameters must be exactly/);
  });
});

/*
 * A unit-filter between the activation and its qualifier names the activation's units ("that sample option is
 * active for friendly SAMPLE units, in addition to any other sample option"). Fabricated wording throughout.
 */
const FILTER_TEXT = "Sample hero: select one sample option to be active for friendly SAMPLE units until the start of your next Command phase, in addition to any other sample option.";
const CHOSEN: Piece = ["select one sample option to be active for", "ability-activate", { subject: "this-unit", ability: "sample-options-ability", choose: { count: 1 } }];
const SAMPLE_UNITS: Piece = ["friendly SAMPLE units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }, "CONDITION"];

describe("additive option with a unit-filter between activation and qualifier", () => {
  it("folds the filter onto the activation as its recipients, and drops the filter leaf", () => {
    const result = compileLeaves(leavesIn(FILTER_TEXT, [CHOSEN, SAMPLE_UNITS, DURATION, QUALIFIER]), FILTER_TEXT);
    expect(result.ok ? true : result.errors).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"SAMPLE"');
    expect(json).not.toContain("exclusive");
  });

  it("refuses a filter when the activation already names its own units", () => {
    const errors = refused(FILTER_TEXT, [["select one sample option to be active for", "ability-activate", { subject: "selected-unit", ability: "sample-options-ability", choose: { count: 1 } }], SAMPLE_UNITS, DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/names its own units/);
  });

  it("refuses two filters between the activation and its qualifier", () => {
    const text = "Sample hero: select one sample option to be active for friendly SAMPLE units and enemy SAMPLE units until the start of your next Command phase, in addition to any other sample option.";
    const errors = refused(text, [CHOSEN, ["friendly SAMPLE units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }, "CONDITION"], ["enemy SAMPLE units", "unit-filter", { side: "enemy", keywords: ["SAMPLE"] }, "CONDITION"], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/only a duration/);
  });

  it("refuses a select-unit between the activation and its qualifier", () => {
    const errors = refused(FILTER_TEXT, [CHOSEN, ["friendly SAMPLE units", "select-unit", { scope: "friendly", distance: "any" }], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/no additive form|only a duration/);
  });
});
