import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";

// Fabricated wording only. "Or:" opening a Stratagem's secondary effect is an `instead` leaf with
// choice and secondary; the compiler marks the option after it as the choice's secondary_option.

type Item = [wording: string, family: string, parameters: Record<string, unknown>];

function placed(text: string, items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const family_version = currentFamilyVersion(family);
    return {
      role: familyRole(family, family_version), family_id: family, family_version,
      parameters: normalizeFingerprintParameters(family, parameters, family_version), start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

const hit = (wording: string): Item => [wording, "roll-modifier", { roll: "hit", operation: "add", value: 1 }];
const wound = (wording: string): Item => [wording, "roll-modifier", { roll: "wound", operation: "add", value: 1 }];
const or = (secondary: boolean): Item => ["Or:", "instead", secondary ? { choice: true, secondary: true } : { choice: true }];

describe("Semantic authoring secondary effect marker", () => {
  it("marks the option after a secondary Or: as the choice's secondary_option", () => {
    const text = "Your unit gets +1 to Hit. Or: your unit gets +1 to Wound.";
    const result = compileLeaves(placed(text, [hit("+1 to Hit"), or(true), wound("+1 to Wound")]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics.effect as Record<string, unknown>).secondary_option).toBe(1);
  });

  it("marks the option after the secondary marker when a plain Or: comes first", () => {
    const text = "Your unit gets +1 to Hit. Or: your unit gets +1 to Wound. Or: your unit gets +1 to Hit again.";
    const result = compileLeaves(placed(text, [hit("+1 to Hit"), or(false), wound("+1 to Wound"), or(true), hit("+1 to Hit again")]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics.effect as Record<string, unknown>).secondary_option).toBe(2);
  });

  it("leaves a plain Or: choice unmarked", () => {
    const text = "Your unit gets +1 to Hit. Or: your unit gets +1 to Wound.";
    const result = compileLeaves(placed(text, [hit("+1 to Hit"), or(false), wound("+1 to Wound")]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).not.toHaveProperty("secondary_option");
  });

  it("refuses two secondary markers in one choice", () => {
    const text = "Your unit gets +1 to Hit. Or: your unit gets +1 to Wound. Or: your unit gets +1 to Hit again.";
    const result = compileLeaves(placed(text, [hit("+1 to Hit"), or(true), wound("+1 to Wound"), or(true), hit("+1 to Hit again")]), text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("only one secondary effect");
  });

  it("takes secondary only on a choice marker, and moves v2 leaves unchanged", () => {
    expect(normalizeFingerprintParameters("instead", { choice: true, secondary: true })).toEqual({ choice: true, secondary: true });
    expect(() => normalizeFingerprintParameters("instead", { secondary: true })).toThrow("instead.choice");
    expect(() => normalizeFingerprintParameters("instead", { choice: true, secondary: false })).toThrow("instead.secondary");
    for (const parameters of [{}, { choice: true }]) {
      expect(mapToLatest("instead", 2, parameters)).toEqual({ family: "instead", version: 3, parameters });
    }
  });
});

describe("Semantic authoring secondary option of a named menu", () => {
  const text = "Select one of the following modes: Alpha: your unit gets +1 to Hit. Beta: your unit gets +1 to Wound.";
  const menu = (opener: Item, betaSecondary: boolean, alphaSecondary = false): Item[] => [
    opener,
    ["Alpha", "named-option", { label: "Alpha", option_id: "alpha", ...(alphaSecondary ? { secondary: true } : {}) }],
    hit("+1 to Hit"),
    ["Beta", "named-option", { label: "Beta", option_id: "beta", ...(betaSecondary ? { secondary: true } : {}) }],
    wound("+1 to Wound"),
  ];
  const choiceOpen: Item = ["Select one of the following modes", "choice-open", {}];

  it("marks the choice-open option whose named-option heading is secondary", () => {
    const result = compileLeaves(placed(text, menu(choiceOpen, true)), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({ type: "choice", secondary_option: 1 });
    const plain = compileLeaves(placed(text, menu(choiceOpen, false)), text);
    if (!plain.ok) throw new Error(plain.errors.join("; "));
    expect(plain.mechanics.effect).not.toHaveProperty("secondary_option");
  });

  it("refuses two secondary options, and a secondary option of a stance", () => {
    const twice = compileLeaves(placed(text, menu(choiceOpen, true, true)), text);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.errors.join()).toContain("only one option");
    const stance: Item = ["Select one of the following modes", "stance-select-open", { scope: "unit", mode: "re-selectable", min_choices: 1, max_choices: 1 }];
    const result = compileLeaves(placed(text, menu(stance, true)), text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("choice-open menu");
  });

  it("takes secondary on a named option only as true, and moves v4 named options and v9 restrictions unchanged", () => {
    expect(normalizeFingerprintParameters("named-option", { label: "Beta", option_id: "beta", secondary: true })).toEqual({ label: "Beta", option_id: "beta", secondary: true });
    expect(() => normalizeFingerprintParameters("named-option", { label: "Beta", secondary: false })).toThrow("named-option.secondary");
    expect(mapToLatest("named-option", 4, { label: "Beta" })).toEqual({ family: "named-option", version: 5, parameters: { label: "Beta" } });
    const restriction = { may: "target", kind: "charge", weapon_type: "all", target: "enemy-units", by: "this-unit" };
    expect(mapToLatest("targeting-restriction", 9, restriction)).toEqual({ family: "targeting-restriction", version: 10, parameters: restriction });
  });
});
