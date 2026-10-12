import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/family-extensions.js";
import { FAMILY_EXTENSIONS_16_EVERY_MODEL_POSITION } from "../src/round5c/family-extensions-16-every-model-position.js";
import { describeCondition } from "../src/translate/condition.js";

/**
 * Every-model position: `models: every` on a unit-position within or objective-range. Every
 * wording is fabricated (the units, keywords and sentences are invented for these tests).
 */

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. Parameters go in raw, as the drafter stores them. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const POSITION = "unit-position";
const VERSION = currentFamilyVersion(POSITION);
/** The version just before the one that added models; later extensions may sit above it. */
const BEFORE_MODELS = (() => {
  for (let version = VERSION; version > 1; version -= 1) {
    const extension = familyExtension(POSITION, version);
    if (extension !== undefined && FAMILY_EXTENSIONS_16_EVERY_MODEL_POSITION.includes(extension)) return version - 1;
  }
  throw new Error("The every-model extension is not registered.");
})();
const WITHIN = { kind: "within", inches: 3, negated: false };

describe("unit-position models every: family version", () => {
  it("accepts every model within 3 inches of this unit, and of the following filter's unit", () => {
    const transport = { ...WITHIN, of: "this-unit", subject: "antecedent", models: "every" };
    expect(normalizeFingerprintParameters(POSITION, transport, VERSION)).toEqual(transport);
    const filter = { ...WITHIN, of: "following-filter", subject: "this-unit", models: "every" };
    expect(normalizeFingerprintParameters(POSITION, filter, VERSION)).toEqual(filter);
  });

  it("accepts every model within range of an objective marker, with no of", () => {
    const beacon = { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, models: "every" };
    expect(normalizeFingerprintParameters(POSITION, beacon, VERSION)).toEqual(beacon);
  });

  it("is not accepted by the previous version: models is new in this version", () => {
    const filter = { ...WITHIN, of: "following-filter", subject: "this-unit", models: "every" };
    expect(() => normalizeFingerprintParameters(POSITION, filter, BEFORE_MODELS)).toThrow();
  });

  it("leaves a leaf without models normalizing exactly as the previous version does", () => {
    const plain = { ...WITHIN, of: "this-unit", subject: "this-unit" };
    expect(normalizeFingerprintParameters(POSITION, plain, VERSION)).toEqual(normalizeFingerprintParameters(POSITION, plain, VERSION - 1));
  });

  it.each([
    ["wholly", { ...WITHIN, of: "this-unit", subject: "this-unit", models: "every", wholly: true }],
    ["a beyond distance", { ...WITHIN, kind: "beyond", of: "this-unit", subject: "this-unit", models: "every" }],
    ["negated", { ...WITHIN, negated: true, of: "this-unit", subject: "this-unit", models: "every" }],
    ["subject this-model", { ...WITHIN, of: "this-unit", subject: "this-model", models: "every" }],
    ["of marker", { ...WITHIN, of: "marker", of_marker: "cult-ambush-marker", subject: "this-unit", models: "every" }],
    ["of matching-unit", { ...WITHIN, of: "matching-unit", of_keywords: ["ZETA"], of_side: "friendly", subject: "this-unit", models: "every" }],
    ["of battlefield-edge", { ...WITHIN, of: "battlefield-edge", subject: "this-unit", models: "every" }],
    ["models any", { ...WITHIN, of: "this-unit", subject: "this-unit", models: "any" }],
    ["a named range", { ...WITHIN, range_ref: "engagement", of: "this-unit", subject: "this-unit", models: "every" }],
    ["a closest-eligible kind", { kind: "closest-eligible", subject: "this-unit", negated: false, models: "every" }],
    ["an objective-range with of", { kind: "objective-range", controlled_by: "any", of: "this-unit", subject: "this-unit", negated: false, models: "every" }],
  ])("refuses models every with %s", (_label, input) => {
    expect(() => normalizeFingerprintParameters(POSITION, input, VERSION)).toThrow(TypeError);
  });
});

const BEACON_TEXT = "When a foe targets this unit, if every model in this unit is within range of a beacon, attacks that target this unit have -1 AP.";

describe("unit-position models every: compiled shapes", () => {
  it("compiles an objective-range every-model check of this unit as a within of the objective", () => {
    const mechanics = mechanicsOf(placed(BEACON_TEXT,
      ["foe", "unit-filter", { side: "enemy" }],
      ["targets this unit", "event", { kind: "enemy-selected-targets" }],
      ["every model in this unit is within range of a beacon", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, models: "every" }],
      ["attacks that target this unit have -1 AP", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "worsen", value: 1, weapon_type: "all" }],
    ), BEACON_TEXT);
    expect(mechanics.effect.condition).toEqual({ type: "within", parameters: { of: { objective: {} }, range: "objective-control", models: "every" } });
    expect(describeCondition(mechanics.effect.condition)).toBe("every model in the unit is within range of an objective marker");
  });

  it("keeps the every-model flag off an objective check that does not carry it", () => {
    const mechanics = mechanicsOf(placed(BEACON_TEXT,
      ["foe", "unit-filter", { side: "enemy" }],
      ["targets this unit", "event", { kind: "enemy-selected-targets" }],
      ["every model in this unit is within range of a beacon", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false }],
      ["attacks that target this unit have -1 AP", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "worsen", value: 1, weapon_type: "all" }],
    ), BEACON_TEXT);
    expect(mechanics.effect.condition.parameters).not.toHaveProperty("models");
    expect(describeCondition(mechanics.effect.condition)).toBe("the unit is within range of an objective marker");
  });

  it("compiles the bearer's own every-model check on a selection as eligibility of the selected unit", () => {
    const text = "In the opposing Charge phase, you can select one friendly unengaged ZETA unit. If each model in that unit is within 3\" of this transport, that unit can embark within this transport.";
    const mechanics = mechanicsOf(placed(text,
      ["In the opposing Charge phase", "phase-window", { phase: "charge", turn: "opponent" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly unengaged ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"], states: ["unengaged"] }],
      ["If each model in that unit is within 3\" of this transport", "unit-position", { kind: "within", inches: 3, of: "this-unit", subject: "antecedent", negated: false, models: "every" }],
      ["that unit can embark within this transport", "make-move", { subject: "antecedent", move_type: "embark" }],
    ), text);
    expect(mechanics.effect.effect.selector.eligibility.operands[1]).toEqual({
      type: "within",
      parameters: { subject: "selected-unit", of: "this-unit", range: { inches: 3 }, models: "every" },
    });
  });

  it("compiles every model within 3 inches of a friendly filter, with the filter as the position's other unit", () => {
    const text = "End of the opposing turn. One ZETA unit from your army. Provided your unit is not within Engagement Range of one or more enemy units and each model in your unit is within 3\" of a ZETA TRANSPORT from your army, it can embark within that TRANSPORT.";
    const mechanics = mechanicsOf(placed(text,
      ["End of the opposing turn", "event", { kind: "turn-ended", turn: "opponent" }],
      ["One", "stratagem-target", { count: "one" }],
      ["ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["not within Engagement Range of one or more enemy units", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }],
      ["each model in your unit is within 3\" of a", "unit-position", { kind: "within", inches: 3, of: "following-filter", subject: "antecedent", negated: false, models: "every" }],
      ["ZETA TRANSPORT", "unit-filter", { side: "friendly", keywords: ["ZETA", "TRANSPORT"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["it can embark within that TRANSPORT", "eligibility-permission", { subject: "this-unit", activity: "embark", allow: true }],
    ), text);
    const within = mechanics.effect.condition.operands[2];
    expect(within).toEqual({
      type: "within",
      parameters: { of: { owner: "friendly", all_of: ["ZETA", "TRANSPORT"] }, range: { inches: 3 }, models: "every" },
    });
  });

  it("refuses an every-model flag the compiler cannot place, even when the family check is bypassed", () => {
    const text = "Each model in this unit is within 3\" of this unit, wholly.";
    const result = compileLeaves(placed(text,
      ["Each model in this unit is within 3\" of this unit, wholly.", "unit-position", { kind: "within", inches: 3, of: "this-unit", subject: "this-unit", negated: false, models: "every", wholly: true }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("cannot combine with wholly");
  });
});

describe("unit-position models every: the 9232-shaped filter pair", () => {
  const TEXT = "While each model in this unit is within 3\" of a friendly ZETA unit (excluding QUIBBLE units), this unit has Lone Operative.";
  const position: Item = ["While each model in this unit is within 3\" of a", POSITION, { ...WITHIN, of: "following-filter", subject: "this-unit", models: "every" }];
  const grant: Item = ["this unit has Lone Operative", "core-ability-grant", { subject: "this-unit", ability: "lone-operative" }];

  it("folds an exclusion-only friendly filter into the keyword filter before the position", () => {
    const mechanics = mechanicsOf(placed(TEXT, position,
      ["friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["(excluding QUIBBLE units)", "unit-filter", { side: "friendly", excluded_keywords: ["QUIBBLE"] }],
      grant), TEXT);
    expect(mechanics.effect.condition.parameters.of).toEqual({ owner: "friendly", all_of: ["ZETA"], none_of: ["QUIBBLE"] });
    expect(mechanics.effect.condition.parameters.models).toBe("every");
  });

  it("reads the bearer's own unit as excluded when the keyword filter says other", () => {
    const mechanics = mechanicsOf(placed(TEXT, position,
      ["friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"], other: true }],
      ["(excluding QUIBBLE units)", "unit-filter", { side: "friendly", excluded_keywords: ["QUIBBLE"] }],
      grant), TEXT);
    expect(mechanics.effect.condition.parameters.of).toEqual({ owner: "friendly", all_of: ["ZETA"], none_of: ["QUIBBLE"], excluding: "this-unit" });
  });

  it("does not fold an enemy-side exclusion into a friendly filter", () => {
    const result = compileLeaves(placed(TEXT, position,
      ["friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["(excluding QUIBBLE units)", "unit-filter", { side: "enemy", excluded_keywords: ["QUIBBLE"] }],
      grant), TEXT);
    expect(result.ok).toBe(false);
  });
});

describe("unit-position models every: describer wording", () => {
  const objective = (extra: Record<string, unknown>) => ({ type: "within", parameters: { of: { objective: {} }, range: "objective-control", ...extra } });

  it("names every model of the subject for an objective check", () => {
    expect(describeCondition(objective({ models: "every" }) as any)).toBe("every model in the unit is within range of an objective marker");
    expect(describeCondition(objective({}) as any)).toBe("the unit is within range of an objective marker");
  });

  it("names every model of the subject for a selected objective marker", () => {
    const selected = { type: "within", parameters: { of: { objective: { selection_var: "marker" } }, range: "objective-control", models: "every" } };
    expect(describeCondition(selected as any)).toBe("every model in the unit is within range of that objective marker");
  });
});
