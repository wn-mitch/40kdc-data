import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

/**
 * Named ranges a record defines per battle round (named-ranges.ts, compile-named-range.ts) and
 * auras measured from matching models (aura-range@5). Every text here is fabricated wording, not
 * rules text; the named range is the registered `contagion`, whose own aura is
 * nurgles-gift-death-guard.
 */

type Item = [string, string, Record<string, unknown>, number?];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, pinned]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = pinned ?? currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
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
