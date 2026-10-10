import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

// Fabricated wording and parameters only; no GW rule prose in this file.

/** A leaf on its own wording in `text`, in the named fragment, with its parameters normalized as the reviewed family normalizes them. */
type Part = [wording: string, family: string, fragment: string, parameters: Record<string, unknown>];

function placed(text: string, parts: Part[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return parts.map(([wording, family, fragment, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the fixture text after byte ${from}.`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version, start_byte: start, end_byte: from,
      parameters: normalizeFingerprintParameters(family, parameters, version), fragment,
    };
  });
}

function compile(text: string, parts: Part[]) {
  return compileLeaves(placed(text, parts), text, {});
}

function mechanicsOf(text: string, parts: Part[]): Record<string, any> {
  const result = compile(text, parts);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, parts: Part[]): string {
  const result = compile(text, parts);
  return result.ok ? "" : result.errors.join(" | ");
}

// A "while targeting an enemy unit within N" effect: a grant, its keyword, then the target's filter and range.
const GRANT_TEXT = "Models have Sustained Hits 1 while targeting an enemy unit within 12\".";
const GRANT: Part[] = [
  ["Models have", "weapon-ability-grant", "EFFECT", { subject: "this-unit", weapon_type: "ranged" }],
  ["Sustained Hits 1", "weapon-ability-keyword", "EFFECT", { keyword: "Sustained Hits 1" }],
];
const TARGET_FILTER: Part = ["while targeting an enemy unit", "unit-filter", "EFFECT", { side: "enemy", subject: "target" }];
const TARGET_RANGE: Part = ["within 12\"", "unit-position", "EFFECT", { kind: "within", inches: 12, of: "attacker", subject: "target", negated: false }];

describe("unit-filter subject target after an effect", () => {
  it("binds the filter's side and the range to the attack's target", () => {
    const mechanics = mechanicsOf(GRANT_TEXT, [...GRANT, TARGET_FILTER, TARGET_RANGE]);
    const condition = mechanics.effect.condition;
    // Without the side check the filter would name no owner and the range would gate nothing about the defender's army.
    expect(condition.operands).toContainEqual({ type: "owned-by", parameters: { subject: "defender", owner: "enemy" } });
    expect(condition.operands).toContainEqual({ type: "within", parameters: { subject: "defender", of: "attacker", range: { inches: 12 } } });
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.effect).toEqual({ type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Sustained Hits 1"], weapon_type: "ranged" } });
  });

  it("leaves a filter with no subject refused as before, with the same message", () => {
    const parts: Part[] = [...GRANT, ["while targeting an enemy unit", "unit-filter", "EFFECT", { side: "enemy" }], TARGET_RANGE];
    expect(errorsOf(GRANT_TEXT, parts)).toBe("A unit-filter needs a select-unit or attack right before it, or an aura-range or event right after it, or a Stratagem target leaf before it.");
  });

  it("refuses subject target on a side-less filter", () => {
    const parts: Part[] = [...GRANT, ["while targeting an enemy unit", "unit-filter", "EFFECT", { side: "any", subject: "target" }], TARGET_RANGE];
    expect(errorsOf(GRANT_TEXT, parts)).toContain("A unit-filter naming an attack's target must say friendly or enemy.");
  });

  it("refuses subject target in a Stratagem's target fragment", () => {
    const text = "Models while targeting an enemy unit have Sustained Hits 1";
    const parts: Part[] = [
      ["Models", "stratagem-target", "TARGET", { count: "one" }],
      ["while targeting an enemy unit", "unit-filter", "TARGET", { side: "enemy", subject: "target" }],
      ["have", "weapon-ability-grant", "EFFECT", { subject: "this-unit", weapon_type: "all" }],
      ["Sustained Hits 1", "weapon-ability-keyword", "EFFECT", { keyword: "Sustained Hits 1" }],
    ];
    expect(errorsOf(text, parts)).toContain("A unit-filter with subject target needs an effect that names an attack's target.");
  });

  it("rejects a subject other than target in the family normalizer", () => {
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "enemy", subject: "attacker" }, currentFamilyVersion("unit-filter")))
      .toThrow(/unit-filter\.subject must be target/u);
  });
});

describe("trailing while-targeting shapes", () => {
  it("gates a characteristic change with a ranged-weapon scope on the target's side and range", () => {
    // Shape of record 1492 after its re-annotation: one characteristic-modifier over the whole phrase, a target filter and a half-range check.
    const text = "Add 1 to the Attacks characteristic of ranged weapons equipped by models in your unit while targeting an enemy unit within half range.";
    const mechanics = mechanicsOf(text, [
      ["Add 1 to the Attacks characteristic", "characteristic-modifier", "EFFECT", { subject: "this-unit", characteristics: ["A"], operation: "improve", value: 1, weapon_type: "ranged" }],
      ["while targeting an enemy unit", "unit-filter", "EFFECT", { side: "enemy", subject: "target" }],
      ["within half range", "unit-position", "EFFECT", { kind: "within", of: "attacker", subject: "target", negated: false, weapon_range: "half" }],
    ]);
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "owned-by", parameters: { subject: "defender", owner: "enemy" } });
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "within", parameters: { subject: "defender", of: "attacker", range: "half-weapon" } });
    expect(mechanics.effect.effect).toEqual({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapon_type: "ranged" } });
  });

  it("binds a friendly-keyword range to the target instead of the antecedent", () => {
    // Shape of record 8489 with the range's subject corrected to target. The old antecedent binding
    // compiled to an enemy-owned unit anywhere within 6 of the friendly units, not to the target.
    const text = "Models have Sustained Hits 1 while targeting an enemy unit within 6\" of one or more friendly TYRANIDS units.";
    const mechanics = mechanicsOf(text, [
      ...GRANT.map((part): Part => (part[0] === "Models have" ? ["Models have", "weapon-ability-grant", "EFFECT", { subject: "this-unit", weapon_type: "all" }] : part)),
      TARGET_FILTER,
      ["within 6\" of one or more friendly TYRANIDS units", "unit-position", "EFFECT", { kind: "within", inches: 6, of: "matching-unit", of_keywords: ["TYRANIDS"], of_side: "friendly", subject: "target", negated: false }],
    ]);
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "owned-by", parameters: { subject: "defender", owner: "enemy" } });
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "within", parameters: { subject: "defender", of: { owner: "friendly", all_of: ["TYRANIDS"] }, range: { inches: 6 } } });
  });
});

describe("trailing while-targeting with a use window and a duration", () => {
  it("gates the grant on the target when a use window and an end-of-phase duration come first", () => {
    // Shape of record 963's first sentence: the window and duration lead, the target filter and range trail the grant.
    const text = "Your Shooting phase. Until the end of the phase, models have Sustained Hits 1 while targeting an enemy unit within 12\".";
    const mechanics = mechanicsOf(text, [
      ["Your Shooting phase.", "use-window", "WHEN", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["Until the end of the phase", "duration", "EFFECT", { endpoint: "end-of-phase" }],
      ["models have", "weapon-ability-grant", "EFFECT", { subject: "this-unit", weapon_type: "ranged" }],
      ["Sustained Hits 1", "weapon-ability-keyword", "EFFECT", { keyword: "Sustained Hits 1" }],
      TARGET_FILTER,
      TARGET_RANGE,
    ]);
    expect(JSON.stringify(mechanics)).toContain('"owner":"enemy"');
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "within", parameters: { subject: "defender", of: "attacker", range: { inches: 12 } } });
    expect(mechanics.effect.effect.type).toBe("weapon-ability-grant");
  });

  it("gates the grant on the target's range when the range is half the attacking weapon's range", () => {
    // Shape of record 6864 (and the half-range part of 1492): a half-range check measured from the attacker.
    const text = "Models have Sustained Hits 1 while targeting an enemy unit within half range.";
    const mechanics = mechanicsOf(text, [
      ["Models have", "weapon-ability-grant", "EFFECT", { subject: "this-unit", weapon_type: "ranged" }],
      ["Sustained Hits 1", "weapon-ability-keyword", "EFFECT", { keyword: "Sustained Hits 1" }],
      TARGET_FILTER,
      ["within half range", "unit-position", "EFFECT", { kind: "within", of: "attacker", subject: "target", negated: false, weapon_range: "half" }],
    ]);
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "within", parameters: { subject: "defender", of: "attacker", range: "half-weapon" } });
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "owned-by", parameters: { subject: "defender", owner: "enemy" } });
  });
});
