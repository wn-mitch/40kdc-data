import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { NAMED_RANGES, namedRange } from "../src/semantic-authoring/named-ranges.js";
import { checkAuraRangeRefs } from "../src/integrity-aura-ranges.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility, describeEffect, type Effect } from "../src/translate/index.js";
import type { ValidationResult } from "../src/validate.js";

/**
 * Named ranges a record defines per battle round (named-ranges.ts, compile-named-range.ts) and
 * auras measured from matching models (aura-range@5). Every text here is fabricated wording, not
 * rules text; the named range is the registered `contagion`, whose own aura is
 * nurgles-gift-death-guard.
 */

type Item = [string, string, Record<string, unknown>, number?];

/** Leaves on their own wording in `text`, in order; a fourth item pins the family version. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, pinned]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = pinned ?? currentFamilyVersion(family);
    const fragment = family === "stratagem-target" ? "TARGET" : "RAW_TEXT";
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

function compiled(text: string, abilityId: string | undefined, ...items: Item[]) {
  return compileLeaves(placed(text, ...items), text, abilityId === undefined ? {} : { abilityId });
}

function effectOf(text: string, abilityId: string | undefined, ...items: Item[]): Record<string, any> {
  const result = compiled(text, abilityId, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, any>;
}

function errorsOf(text: string, abilityId: string | undefined, ...items: Item[]): string {
  const result = compiled(text, abilityId, ...items);
  return result.ok ? "" : result.errors.join("; ");
}

const ajv = createValidator();
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
const render = (effect: unknown) => describeAbility({ effect, scope: { duration: "permanent" } } as Parameters<typeof describeAbility>[0]);

const OWNER = "nurgles-gift-death-guard";
const DEFINING = "While an enemy unit is within Rot Range of one or more PLAGUE models from your army, it is Marked. "
  + "In the first battle round, the Rot Range is two inches. In the second battle round, the Rot Range is four inches. "
  + "From the third battle round, the Rot Range is eight inches. The Rot Range can never exceed ten inches.";

const AURA: Item = ["within Rot Range of one or more PLAGUE models", "aura-range", { range_ref: "contagion", of: "matching-models", of_keywords: ["PLAGUE"] }];
const head: Item[] = [
  ["enemy unit", "unit-filter", { side: "enemy" }],
  AURA,
  ["from your army", "unit-owner", { owner: "friendly" }],
  ["it is Marked", "apply-mark", { subject: "antecedent", tag: "afflicted" }],
];
const round = (wording: string, min: number, max: number): Item => [wording, "battle-round", { min, max }];
const value = (wording: string, inches: number): Item => [wording, "named-range-value", { range: "contagion", inches }];
const CAP: Item = ["The Rot Range can never exceed ten inches", "named-range-cap", { range: "contagion", inches: 10 }];
const table: Item[] = [
  round("In the first battle round", 1, 1), value("the Rot Range is two inches", 2),
  round("In the second battle round", 2, 2), value("the Rot Range is four inches", 4),
  round("From the third battle round", 3, 5), value("the Rot Range is eight inches", 8),
];

describe("aura-range@5 parameters", () => {
  const v5 = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("aura-range", parameters, 5);

  it("takes a named range in place of inches, and matching models as the anchor", () => {
    expect(v5({ range_ref: "contagion", of: "matching-models", of_keywords: ["plague"], of_side: "friendly" }))
      .toEqual({ range_ref: "contagion", of: "matching-models", of_keywords: ["PLAGUE"], of_side: "friendly" });
    expect(v5({ range_ref: "synapse" })).toEqual({ range_ref: "synapse" });
    expect(v5({ inches: 6, of: "matching-models", of_keywords: ["PLAGUE"] })).toEqual({ inches: 6, of: "matching-models", of_keywords: ["PLAGUE"] });
  });

  it("keeps every earlier aura-range leaf as it was", () => {
    for (const parameters of [{ inches: 6 }, { inches: 6, of: "this-model", wholly: true }, { inches: 6, conditional_range: { inches: 9, keywords: ["TITANIC"] } }, { side: "enemy", inches: 3, range_cap_inches: 9 }]) {
      expect(v5(parameters)).toEqual(normalizeFingerprintParameters("aura-range", parameters, 4));
    }
  });

  it("refuses a range given twice or not at all, and matching-model fields without matching models", () => {
    expect(() => v5({ range_ref: "contagion", inches: 3 })).toThrow(/range_ref or inches/u);
    expect(() => v5({ of: "matching-models", of_keywords: ["PLAGUE"] })).toThrow(/inches or range_ref/u);
    expect(() => v5({ range_ref: "rot" })).toThrow();
    expect(() => v5({ inches: 6, of_keywords: ["PLAGUE"] })).toThrow(/go with of matching-models/u);
    expect(() => v5({ inches: 6, of: "matching-models" })).toThrow(/keyword/u);
    expect(() => v5({ range_ref: "contagion", conditional_range: { inches: 9, keywords: ["TITANIC"] } })).toThrow(/named range has none/u);
  });

  it("validates the named-range definition leaves", () => {
    expect(normalizeFingerprintParameters("named-range-value", { range: "contagion", inches: 3 }, 1)).toEqual({ range: "contagion", inches: 3 });
    expect(normalizeFingerprintParameters("named-range-cap", { range: "synapse", inches: 12 }, 1)).toEqual({ range: "synapse", inches: 12 });
    expect(() => normalizeFingerprintParameters("named-range-value", { range: "rot", inches: 3 }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("named-range-cap", { range: "contagion" }, 1)).toThrow();
  });
});

describe("a record that defines its named range", () => {
  it("lowers the values to a per-battle-round aura range, capped, measured from the matching friendly models", () => {
    const effect = effectOf(DEFINING, OWNER, ...head, ...table, CAP);
    expect(effect).toEqual({
      type: "aura",
      target: "enemy-within-aura",
      modifier: {
        range: { per_battle_round: [{ inches: 2 }, { inches: 4 }, { inches: 8 }] },
        range_cap: { inches: 10 },
        emitter_filter: { owner: "friendly", all_of: ["PLAGUE"] },
        eligible: { owner: "enemy" },
        effect: { type: "designate", target: "recipient", modifier: { tag: "afflicted" } },
      },
    });
    expect(effectOk(effect), JSON.stringify(effectOk.errors)).toBe(true);
    expect(render(effect)).toContain('2", 4", 8" in battle rounds 1, 2, 3 respectively');
    expect(render(effect)).toContain('to a maximum of 10"');
  });

  it("expands a span of rounds and collapses a table with one distance", () => {
    const spanned = effectOf(DEFINING, OWNER, ...head,
      round("In the first battle round", 1, 2), value("the Rot Range is two inches", 2),
      round("From the third battle round", 3, 5), value("the Rot Range is eight inches", 8));
    expect(spanned.modifier.range).toEqual({ per_battle_round: [{ inches: 2 }, { inches: 2 }, { inches: 8 }] });
    const flat = effectOf(DEFINING, OWNER, ...head, value("the Rot Range is two inches", 2));
    expect(flat.modifier.range).toEqual({ inches: 2 });
  });

  it("refuses a table that skips a round, stops before the battle ends, or exceeds its own cap", () => {
    expect(errorsOf(DEFINING, OWNER, ...head, round("In the first battle round", 1, 1), value("the Rot Range is two inches", 2),
      round("From the third battle round", 3, 5), value("the Rot Range is eight inches", 8))).toMatch(/no value for battle round 2/u);
    expect(errorsOf(DEFINING, OWNER, ...head, round("In the first battle round", 1, 1), value("the Rot Range is two inches", 2),
      round("In the second battle round", 2, 2), value("the Rot Range is four inches", 4))).toMatch(/no value after battle round 2/u);
    expect(errorsOf(DEFINING, OWNER, ...head, ...table, ["The Rot Range can never exceed ten inches", "named-range-cap", { range: "contagion", inches: 6 }]))
      .toMatch(/beyond its own cap of 6/u);
  });

  it("refuses definitions no aura uses, a cap with no value, and an owner that gives its range no value", () => {
    expect(errorsOf(DEFINING, OWNER, head[0]!, ...table)).toMatch(/no aura of it reaches that range/u);
    expect(errorsOf(DEFINING, OWNER, ...head, CAP)).toMatch(/has a cap but no value/u);
    expect(errorsOf(DEFINING, OWNER, ...head)).toMatch(/own aura, but it gives the range no value/u);
  });

  it("reaches the named range's own aura from any other record", () => {
    const effect = effectOf(DEFINING, "some-death-guard-unit-ability", ...head);
    expect(effect.modifier.range).toEqual({ aura_of: OWNER });
    expect(effectOk(effect), JSON.stringify(effectOk.errors)).toBe(true);
  });
});

describe("an aura measured from matching models", () => {
  const text = "While an enemy unit is within 6 inches of one or more PLAGUE models from your army, it is Marked.";
  const filter: Item = ["enemy unit", "unit-filter", { side: "enemy" }];
  const mark: Item = ["it is Marked", "apply-mark", { subject: "antecedent", tag: "afflicted" }];

  it("takes friendly from the leaf itself or from the \"from your army\" after it, and drops that owner leaf", () => {
    const withOwner = effectOf(text, undefined, filter, ["within 6 inches of one or more PLAGUE models", "aura-range", { inches: 6, of: "matching-models", of_keywords: ["PLAGUE"] }],
      ["from your army", "unit-owner", { owner: "friendly" }], mark);
    // Without the fold, "from your army" became a gate that every recipient is friendly.
    expect(withOwner).toEqual({
      type: "aura", target: "enemy-within-aura",
      modifier: { range: { inches: 6 }, emitter_filter: { owner: "friendly", all_of: ["PLAGUE"] }, eligible: { owner: "enemy" }, effect: { type: "designate", target: "recipient", modifier: { tag: "afflicted" } } },
    });
    const ownSide = effectOf(text, undefined, filter, ["within 6 inches of one or more PLAGUE models", "aura-range", { inches: 6, of: "matching-models", of_keywords: ["PLAGUE"], of_side: "friendly" }], mark);
    expect(ownSide.modifier.emitter_filter).toEqual({ owner: "friendly", all_of: ["PLAGUE"] });
  });

  it("refuses models of no stated side and enemy emitters", () => {
    const aura: Item = ["within 6 inches of one or more PLAGUE models", "aura-range", { inches: 6, of: "matching-models", of_keywords: ["PLAGUE"] }];
    expect(errorsOf(text, undefined, filter, aura, mark)).toMatch(/needs them friendly/u);
    expect(errorsOf(text, undefined, filter, aura, ["from your army", "unit-owner", { owner: "enemy" }], mark)).toMatch(/names enemy models/u);
  });
});

describe("a named-range aura outside the aura wrap", () => {
  it("refuses a lowering that would read it as inches (a selection's distance)", () => {
    const text = "In your Shooting phase, select one enemy unit within Rot Range of this model. That unit must take a Battle-shock test.";
    // Without the refusal the selection took `inches: undefined` and dropped the named range.
    expect(errorsOf(text, "some-death-guard-unit-ability",
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within Rot Range of this model", "aura-range", { range_ref: "contagion", of: "this-model" }],
      ["That unit must take a Battle-shock test", "test", { test: "battle-shock", target: "antecedent" }])).toMatch(/no DSL form in this position yet/u);
  });
});

// Named-range references (range_ref) on unit-position, counts-as and aura-range.
function compiledRef(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-named-range" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function refused(text: string, ...items: Item[]): string[] {
  const result = compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-named-range" });
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors;
}

/** Whether a family version refuses these parameters at normalize (the boundary leaves pass at ingest). */
function normalizeRefuses(family: string, parameters: Record<string, unknown>): boolean {
  try {
    normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
    return false;
  } catch {
    return true;
  }
}

/** The first node of `type` in a DSL tree, outermost first. */
function firstOf(node: unknown, type: string): Record<string, any> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = firstOf(item, type);
      if (found) return found;
    }
    return undefined;
  }
  const record = node as Record<string, any>;
  if (record.type === type) return record;
  for (const value of Object.values(record)) {
    const found = firstOf(value, type);
    if (found) return found;
  }
  return undefined;
}

const SYNAPSE_TEXT = "Up to two WIDGET units from your host that stand inside Synapse Range of your host. Those units lose 1 wound.";
const withinSynapseOfArmy: Item = ["inside Synapse Range of your host", "unit-position", { kind: "within", range_ref: "synapse", of: "matching-unit", of_side: "friendly", subject: "antecedent", negated: false }];
const selectedUnitWound: Item = ["Those units lose 1 wound", "mortal-wounds", { recipient: "antecedent", count: "1" }];

describe("Semantic authoring named-range reference: the registry", () => {
  it("maps each name to the ability whose aura range it is, and refuses any other name", () => {
    expect(namedRange("synapse")).toEqual({ label: "Synapse Range", aura_of: "synapse-tyranids" });
    expect(namedRange("contagion").aura_of).toBe("nurgles-gift-death-guard");
    expect(() => namedRange("made-up")).toThrow(/Unknown named range/u);
    expect(() => namedRange("constructor")).toThrow(/Unknown named range/u);
    expect(Object.keys(NAMED_RANGES).sort()).toEqual(["contagion", "synapse"]);
  });
});

describe("Semantic authoring named-range reference: unit-position range_ref", () => {
  it("measures a unit of the army against Synapse Range with no keyword (5695 shape)", () => {
    const mechanics = compiledRef(SYNAPSE_TEXT, ["Up to two", "stratagem-target", { count: "up-to", count_max: 2, side: "your-army", selects: "unit", keywords: ["WIDGET"], match: "all", excluded_keywords: [] }], withinSynapseOfArmy, selectedUnitWound);
    expect(JSON.stringify(mechanics.effect)).toContain('{"type":"matches","parameters":{"filter":{"within":{"of":{"owner":"friendly"},"range":{"aura_of":"synapse-tyranids"}}}}}');
    expect(JSON.stringify(mechanics.effect)).not.toContain("all_of");
  });

  it("gives the selected unit's distance with its own aura and the subject left at the default (8093 shape)", () => {
    const text = "Choose one visible foe gizmo inside Contagion Range of your gizmo. That gizmo loses 1 wound.";
    const mechanics = compiledRef(text,
      ["Choose one", "select-unit", { distance: "any", visible: true }],
      ["visible foe gizmo", "unit-filter", { side: "enemy", visible: true }],
      ["inside Contagion Range of your gizmo", "unit-position", { kind: "within", range_ref: "contagion", of: "this-unit", subject: "selected-unit", negated: false }],
      ["That gizmo loses 1 wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    // The eligibility keeps subject selected-unit, the convention record-69 baseline uses; the conformance golden omits it (see the brief).
    expect(firstOf(mechanics.effect, "select-units")!.selector.eligibility).toEqual({ type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: "this-unit", range: { aura_of: "nurgles-gift-death-guard" } } } } });
  });

  it("measures a unit against a named range from this unit or this model (5765, 5805 shapes)", () => {
    const text = "While your unit is inside Synapse Range of your host, it can benefit from it.";
    const mechanics = compiledRef(text, ["While your unit", "unit-position", { kind: "within", range_ref: "synapse", of: "matching-unit", of_side: "friendly", subject: "this-unit", negated: false }], ["it can benefit from it", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(firstOf(mechanics.effect, "matches")!.parameters).toEqual({ filter: { within: { of: { owner: "friendly" }, range: { aura_of: "synapse-tyranids" } } } });
  });

  it("reads a named-range distance from the bearer on a selection's antecedent (8102 shape)", () => {
    const text = "Choose one foe unit inside Contagion Range of the bearer. That foe unit loses 1 wound.";
    const mechanics = compiledRef(text,
      ["Choose one", "select-unit", { distance: "any", visible: false }],
      ["foe unit", "unit-filter", { side: "enemy" }],
      ["inside Contagion Range of the bearer", "unit-position", { kind: "within", range_ref: "contagion", of: "this-model", subject: "antecedent", negated: false }],
      ["That foe unit loses 1 wound", "mortal-wounds", { recipient: "antecedent", count: "1" }]);
    expect(JSON.stringify(mechanics.effect)).toContain('"aura_of":"nurgles-gift-death-guard"');
    expect(JSON.stringify(mechanics.effect)).not.toContain("inches");
  });

  it("grants Synapse Range membership to each unit an aura reaches (9859 shape: the gate is an aura, so the grant's antecedent is its recipient)", () => {
    const text = "Allied units within 9\" of the bearer. That unit is inside Synapse Range of your host.";
    const mechanics = compiledRef(text,
      ["Allied units within 9\" of the bearer", "aura-range", { inches: 9, of: "this-model", side: "friendly" }],
      ["That unit is inside Synapse Range of your host", "counts-as", { subject: "antecedent", range_ref: "synapse", of_side: "friendly" }]);
    expect(mechanics.behavior).toBe("aura");
    expect(JSON.stringify(mechanics.effect)).toContain('"type":"counts-as","target":"recipient","modifier":{"within":{"aura_of":"synapse-tyranids"},"of":{"owner":"friendly"}}');
  });

  it("keeps a unit's own Synapse Range membership with a fall-back condition (5745 shape)", () => {
    const text = "While this unit is inside Synapse Range of your host and retreated sideways this phase, it can benefit.";
    const mechanics = compiledRef(text,
      ["this unit is inside Synapse Range of your host", "unit-position", { kind: "within", range_ref: "synapse", of: "matching-unit", of_side: "friendly", subject: "this-unit", negated: false }],
      ["retreated sideways this phase", "unit-activity", { activities: ["fell-back-this-phase"], subject: "this-unit" }],
      ["it can benefit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(mechanics.effect.condition.operands[0]).toEqual({ type: "matches", parameters: { filter: { within: { of: { owner: "friendly" }, range: { aura_of: "synapse-tyranids" } } } } });
  });

  it("puts a named range in the target restriction for an attack's target (8134 shape)", () => {
    const text = "Pick a unit inside Contagion Range of a friendly unit. That unit loses 1 wound.";
    const mechanics = compiledRef(text,
      ["Pick a unit", "stratagem-target", { count: "one", side: "enemy", selects: "unit", keywords: [], match: "all", excluded_keywords: [] }],
      ["inside Contagion Range of a friendly unit", "unit-position", { kind: "within", range_ref: "contagion", of: "matching-unit", of_side: "friendly", subject: "target", negated: false }],
      ["That unit loses 1 wound", "mortal-wounds", { recipient: "target", count: "1" }]);
    expect(firstOf(mechanics.effect, "matches")!.parameters).toEqual({ subject: "defender", filter: { within: { of: { owner: "friendly" }, range: { aura_of: "nurgles-gift-death-guard" } } } });
  });

  it("excludes the keywords of units that are not counted (matching units excluding GADGETS)", () => {
    const text = "While this unit is inside Synapse Range of a friendly WIDGET unit (excluding GADGETS units), it gains the BEACON keyword.";
    const mechanics = compiledRef(text,
      ["While this unit is inside Synapse Range of a friendly WIDGET unit (excluding GADGETS units)", "unit-position", { kind: "within", range_ref: "synapse", of: "matching-unit", of_side: "friendly", of_keywords: ["WIDGET"], of_excluded_keywords: ["GADGETS"], subject: "this-unit", negated: false }],
      ["it gains the BEACON keyword", "keyword-grant", { subject: "this-unit", keywords: ["BEACON"] }]);
    expect(firstOf(mechanics.effect, "matches")!.parameters).toEqual({ filter: { within: { of: { owner: "friendly", all_of: ["WIDGET"], none_of: ["GADGETS"] }, range: { aura_of: "synapse-tyranids" } } } });
    expect(firstOf(mechanics.effect, "keyword-grant")!.modifier).toEqual({ keywords: ["BEACON"] });
  });

  it("keeps an inches-only leaf exactly as before (regression)", () => {
    const text = "While this unit is within 6\" of a friendly ALPHA unit, it can benefit.";
    const mechanics = compiledRef(text, ["While this unit is within 6\"", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "this-unit", negated: false }], ["it can benefit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(firstOf(mechanics.effect, "matches")!.parameters).toEqual({ filter: { within: { of: "this-unit", range: { inches: 6 } } } });
  });

  it("refuses range_ref with inches, wholly, beyond, a non-unit anchor, or no anchor", () => {
    const base: Record<string, unknown> = { kind: "within", range_ref: "synapse", of: "matching-unit", of_side: "friendly", subject: "this-unit", negated: false };
    expect(normalizeRefuses("unit-position", { ...base, inches: 6 })).toBe(true);
    expect(normalizeRefuses("unit-position", { ...base, wholly: true })).toBe(true);
    expect(normalizeRefuses("unit-position", { ...base, kind: "beyond" })).toBe(true);
    expect(normalizeRefuses("unit-position", { ...base, of: "marker", of_marker: "beacon-marker" })).toBe(true);
    expect(normalizeRefuses("unit-position", { ...base, of: "battlefield-edge" })).toBe(true);
    expect(normalizeRefuses("unit-position", { ...base, of: "following-filter" })).toBe(true);
    const noAnchor: Record<string, unknown> = { ...base };
    delete noAnchor.of;
    expect(normalizeRefuses("unit-position", noAnchor)).toBe(true);
  });

  it("accepts the same leaf with of this-unit and no of_side, and keeps range_ref on the normalized leaf", () => {
    const leaf = { kind: "within", range_ref: "synapse", of: "this-unit", subject: "this-unit", negated: false };
    expect(normalizeFingerprintParameters("unit-position", leaf, currentFamilyVersion("unit-position"))).toEqual(leaf);
    expect(normalizeRefuses("unit-position", { ...leaf, of: "this-model" })).toBe(false);
  });

  it("refuses an unregistered name and a matching unit with no of_side", () => {
    expect(normalizeRefuses("unit-position", { kind: "within", range_ref: "made-up", of: "this-unit", subject: "this-unit", negated: false })).toBe(true);
    expect(normalizeRefuses("unit-position", { kind: "within", range_ref: "synapse", of: "matching-unit", subject: "this-unit", negated: false })).toBe(true);
  });

  it("keeps of_excluded_keywords sorted and refuses it on anything but a matching unit", () => {
    const normalized = normalizeFingerprintParameters("unit-position", { kind: "within", range_ref: "synapse", of: "matching-unit", of_side: "friendly", of_keywords: ["WIDGET"], of_excluded_keywords: ["GADGETS", "BIOVORES"], subject: "this-unit", negated: false }, currentFamilyVersion("unit-position"));
    expect(normalized.of_excluded_keywords).toEqual(["BIOVORES", "GADGETS"]);
    expect(normalizeRefuses("unit-position", { kind: "within", range_ref: "synapse", of: "this-unit", of_excluded_keywords: ["GADGETS"], subject: "this-unit", negated: false })).toBe(true);
    expect(normalizeRefuses("unit-position", { kind: "within", inches: 6, of: "this-unit", of_excluded_keywords: ["GADGETS"], subject: "this-unit", negated: false })).toBe(true);
  });

  it("keeps a named-range distance from a quantifier's unit as a condition, not a folded near (each unit within the range of this unit)", () => {
    const text = "For each foe unit inside Synapse Range of this unit, it can benefit.";
    const mechanics = compiledRef(text,
      ["For each", "for-each-unit-select", {}],
      ["foe unit", "unit-filter", { side: "enemy" }],
      ["inside Synapse Range of this unit", "unit-position", { kind: "within", range_ref: "synapse", of: "this-unit", subject: "recipient", negated: false }],
      ["it can benefit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(JSON.stringify(mechanics)).not.toContain('"inches":null');
    expect(JSON.stringify(mechanics)).toContain('"aura_of":"synapse-tyranids"');
  });

  it("refuses a named-range distance to another unit (near other, of target)", () => {
    const text = "For each other foe unit inside Synapse Range of the target, it can benefit.";
    expect(normalizeRefuses("unit-position", { kind: "within", range_ref: "synapse", of: "target", subject: "recipient", negated: false })).toBe(true);
    expect(refused(text,
      ["For each", "for-each-unit-select", {}],
      ["foe unit", "unit-filter", { side: "enemy", other: true }],
      ["inside Synapse Range of the target", "unit-position", { kind: "within", range_ref: "synapse", of: "target", subject: "recipient", negated: false }],
      ["it can benefit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])).toEqual(["A distance to another unit by a named range has no quantifier shape yet."]);
  });

  it("refuses a named-range minimum distance from enemy units on a set-up", () => {
    const text = "Set it up anywhere on the battlefield more than Synapse Range away from every foe unit.";
    const errors = refused(text,
      ["Set it up", "set-up", { subject: "antecedent", to: "battlefield", allow: true }],
      ["more than Synapse Range away from every foe unit", "unit-position", { kind: "within", range_ref: "synapse", of: "matching-unit", of_side: "enemy", subject: "antecedent", negated: true }]);
    expect(errors.join(" ")).toMatch(/fixed inch count|placement/u);
  });

  it("takes a named range on aura-range from version 5 only", () => {
    const parameters = { side: "enemy", range_ref: "contagion", of: "this-unit" };
    expect(() => normalizeFingerprintParameters("aura-range", parameters, 4)).toThrow();
    expect(normalizeRefuses("aura-range", parameters)).toBe(false);
  });
});

describe("Semantic authoring named-range reference: counts-as range_ref", () => {
  const grant = (extra: Record<string, unknown>): Item => ["That unit is inside Synapse Range of your host", "counts-as", { subject: "antecedent", ...extra }];
  it("grants membership of Synapse Range of your army to the antecedent (9859 shape)", () => {
    const text = "Choose one unit. That unit is inside Synapse Range of your host.";
    const mechanics = compiledRef(text, ["Choose one unit", "unit-filter", { side: "friendly" }], grant({ range_ref: "synapse", of_side: "friendly" }));
    expect(firstOf(mechanics.effect, "counts-as")).toMatchObject({ modifier: { within: { aura_of: "synapse-tyranids" }, of: { owner: "friendly" } } });
  });

  it("refuses range_ref with a within or region, a missing of_side, or a subject that cannot take a range", () => {
    const leaf = { subject: "antecedent", range_ref: "synapse", of_side: "friendly" };
    expect(normalizeRefuses("counts-as", { ...leaf, within: 6 })).toBe(true);
    expect(normalizeRefuses("counts-as", { ...leaf, region: { region_id: "hallowed-ground", owner_faction: "fabricated-faction" } })).toBe(true);
    expect(normalizeRefuses("counts-as", { subject: "antecedent", range_ref: "synapse" })).toBe(true);
    expect(normalizeRefuses("counts-as", { ...leaf, subject: "event-subject" })).toBe(true);
    expect(normalizeRefuses("counts-as", { subject: "antecedent", of_side: "friendly", within: 6 })).toBe(true);
    expect(normalizeRefuses("counts-as", { ...leaf, range_ref: "contagion" })).toBe(true);
  });

  it("normalizes a Synapse Range grant to the antecedent with of_side friendly", () => {
    expect(normalizeFingerprintParameters("counts-as", { subject: "this-model", range_ref: "synapse", of_side: "friendly" }, currentFamilyVersion("counts-as")))
      .toEqual({ subject: "this-model", range_ref: "synapse", of_side: "friendly" });
  });

  it("keeps the inches grant and the region grant as they were (regression)", () => {
    const text = "That unit is within 6\" of this unit.";
    const mechanics = compiledRef(text, ["That unit is within 6\" of this unit", "counts-as", { subject: "antecedent", within: 6 }]);
    expect(firstOf(mechanics.effect, "counts-as")!.modifier).toEqual({ within: { inches: 6 } });
  });
});

describe("Semantic authoring named-range reference: describer and family versions", () => {
  it("describes a Synapse Range aura as Synapse Range", () => {
    const effect = { type: "counts-as", target: "this-unit", modifier: { within: { aura_of: "synapse-tyranids" }, of: { owner: "friendly" } } } as unknown as Effect;
    expect(describeEffect(effect)).toContain("Synapse Range");
    expect(describeEffect(effect)).not.toContain("Contagion Range");
  });

  it("registers the named-range versions: unit-position past its prior current version and counts-as at version 3", () => {
    expect(currentFamilyVersion("unit-position")).toBeGreaterThanOrEqual(15);
    expect(currentFamilyVersion("counts-as")).toBe(3);
  });
});

describe("Semantic authoring named-range reference: aura_of integrity", () => {
  function fixture(rows: unknown[]): string {
    const root = mkdtempSync(join(tmpdir(), "named-range-"));
    mkdirSync(join(root, "enrichment", "fab"), { recursive: true });
    writeFileSync(join(root, "enrichment", "fab", "abilities.json"), JSON.stringify(rows));
    return root;
  }
  const ability = (id: string, aura: string) => ({ ability_id: id, effect: { type: "conditional", condition: { type: "matches", parameters: { filter: { within: { of: { owner: "friendly" }, range: { aura_of: aura } } } } } } });
  const check = async (rows: unknown[]): Promise<ValidationResult> => {
    const root = fixture(rows);
    try {
      const result = { passed: 0, failed: 0, totalFiles: 0, totalItems: 0, errors: [] } as unknown as ValidationResult;
      await checkAuraRangeRefs(root, result);
      return result;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("fails an ability whose aura_of names no ability record", async () => {
    const result = await check([ability("fabricated-aura", "made-up-id")]);
    expect(result.failed).toBe(1);
    expect(JSON.stringify(result.errors)).toContain("made-up-id");
  });

  it("passes an aura_of that another ability record defines", async () => {
    const result = await check([{ ability_id: "fabricated-aura", effect: { type: "no-effect" } }, ability("fabricated-user", "fabricated-aura")]);
    expect(result.failed).toBe(0);
  });

  it("passes the real dataset: every aura_of in the enrichment resolves", async () => {
    const real = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../data");
    const result = { passed: 0, failed: 0, totalFiles: 0, totalItems: 0, errors: [] } as unknown as ValidationResult;
    await checkAuraRangeRefs(real, result);
    expect(JSON.stringify(result.errors)).toBe("[]");
  });
});
