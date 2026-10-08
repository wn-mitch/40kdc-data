import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

const COMPARE = { left_of: "attacker", left_stat: "S", comparison: "greater-than", right_kind: "stat", right_of: "defender", right_stat: "T" };
const WOUND_MINUS_ONE = { roll: "wound", operation: "subtract", value: 1 };
const CLAW = ["friendly Zeta units", "unit-filter", { side: "friendly", keywords: ["ZETA"] }] as const;
const TEXT = "Ranged attacks aimed at friendly Zeta units where the attacker's power is above the target's resilience have -1 to wound rolls.";

function compile(list: CompileLeaf[], text = TEXT) {
  return compileLeaves(list, text, {});
}
const errorsOf = (result: unknown) => (result as { errors: string[] }).errors.join(" ");
const mechanicsOf = (result: unknown) => JSON.stringify((result as { mechanics: unknown }).mechanics);

// "Ranged attacks aimed at friendly X units where the attacker's power is above the target's resilience": the attack-filter
// is the attack, and the unit-filter after it is the attack's defender.
describe("Round 5C attack-filter frame with a defender unit-filter", () => {
  it("binds the unit-filter to the attack's target, keeping its side and keywords", () => {
    const result = compile(placed(TEXT,
      ["Ranged attacks", "attack-filter", { attack_type: "ranged" }], CLAW,
      ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
    expect(result.ok).toBe(true);
    const json = mechanicsOf(result);
    expect(json).toContain('"subject":"defender","all_of":["ZETA"]');
    expect(json).toContain('"type":"owned-by","parameters":{"subject":"defender","owner":"friendly"}');
    expect(json).toContain('"attack_type":"ranged"');
    expect(json).toContain('"type":"attack-compare"');
    expect(json).not.toContain("unit-filter-target");
    // The wound roll is the attacking unit's: the -1 lands on the attacker, not on this unit.
    expect(json).toContain('"type":"roll-modifier","target":"attacker"');
    expect(json).not.toContain('"target":"this-unit"');
  });

  it("refuses a target filter that is not friendly or enemy", () => {
    const result = compile(placed(TEXT,
      ["Ranged attacks", "attack-filter", { attack_type: "ranged" }],
      ["friendly Zeta units", "unit-filter", { side: "any", keywords: ["ZETA"] }],
      ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/must say friendly or enemy/);
  });

  it("refuses a second unit-filter after the target filter rather than binding it to the roll", () => {
    const text = "Ranged attacks aimed at friendly Zeta units, enemy Monster units have -1 to wound rolls.";
    const result = compile(placed(text,
      ["Ranged attacks", "attack-filter", { attack_type: "ranged" }],
      ["friendly Zeta units", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["enemy Monster units", "unit-filter", { side: "enemy", keywords: ["MONSTER"] }],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]), text);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/needs a select-unit or attack right before it/);
  });

  it("refuses a frame that names more than its attack type", () => {
    const result = compile(placed(TEXT,
      ["Ranged attacks", "attack-filter", { attack_type: "ranged", of: "antecedent" }], CLAW,
      ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/Those attacks|needs a select-unit or attack right before it/);
  });

  it("refuses a negated frame", () => {
    const result = compile(placed(TEXT,
      ["Ranged attacks", "attack-filter", { attack_type: "ranged", negated: true }], CLAW,
      ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
    expect(result.ok).toBe(false);
  });
});

// "Attacks aimed at friendly X units where the attacker's power is above the target's resilience": no attack-filter.
describe("Round 5C defender unit-filter before an attack-compare", () => {
  it("binds a clause-initial unit-filter to the attack-compare's defender", () => {
    const result = compile(placed("Attacks aimed at friendly Omega/Sigma units where the attacker's power is above the target's resilience have -1 to wound rolls.",
      ["friendly Omega/Sigma units", "unit-filter", { side: "friendly", any_keywords: ["OMEGA", "SIGMA"] }],
      ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE])
      , "Attacks aimed at friendly Omega/Sigma units where the attacker's power is above the target's resilience have -1 to wound rolls.");
    expect(result.ok).toBe(true);
    expect(mechanicsOf(result)).toContain('"subject":"defender","any_of":["OMEGA","SIGMA"]');
    expect(mechanicsOf(result)).toContain('"type":"roll-modifier","target":"attacker"');
  });

  it("refuses when the attack-compare does not name the defender", () => {
    const text = "Attacks aimed at friendly Omega/Sigma units where the attacker's power is above the bearer's resilience have -1 to wound rolls.";
    const result = compile(placed(text,
      ["friendly Omega/Sigma units", "unit-filter", { side: "friendly", any_keywords: ["OMEGA", "SIGMA"] }],
      ["where the attacker's power is above the bearer's resilience", "attack-compare", { ...COMPARE, right_of: "this-unit" }],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]), text);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/needs a select-unit or attack right before it/);
  });

  it("refuses when an earlier leaf in the sentence precedes the unit-filter", () => {
    const text = "While this unit is near, attacks that target friendly Omega/Sigma units where the attacker's power is above the target's resilience have -1 to wound rolls.";
    const result = compile(placed(text,
      ["While this unit is near,", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "this-unit", negated: false }],
      ["friendly Omega/Sigma units", "unit-filter", { side: "friendly", any_keywords: ["OMEGA", "SIGMA"] }],
      ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
      ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]), text);
    expect(result.ok).toBe(false);
  });
});

// "Friendly X units' ranged attacks aimed at a unit within 12\" have +1 to hit rolls."
describe("Round 5C attack frame with a target gate before its rolls", () => {
  const TEXT4 = "Friendly Echo units' ranged attacks aimed at a unit within 12\" have +1 to hit rolls.";
  const HIT_PLUS_ONE = { roll: "hit", operation: "add", value: 1 };
  const HERNKYN = ["Friendly Echo units'", "unit-filter", { side: "friendly", keywords: ["ECHO"] }] as const;
  // The distance is measured from the attacking unit, the unit the army-wide filter names.
  const TARGET_12 = ["aimed at a unit within 12\"", "unit-position", { kind: "within", inches: 12, of: "attacker", subject: "target", negated: false }] as const;

  it("keeps the target distance as a gate and folds the attacker filter into the roll", () => {
    const result = compile(placed(TEXT4, HERNKYN,
      ["ranged attacks", "attack-filter", { attack_type: "ranged" }], TARGET_12,
      ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]), TEXT4);
    expect(result.ok).toBe(true);
    const json = mechanicsOf(result);
    expect(json).toContain('"subject":"defender","of":"attacker","range":{"inches":12}');
    expect(json).toContain('"owner":"friendly","all_of":["ECHO"]');
    expect(json).toContain('"weapon_type":"ranged"');
    expect(json).not.toContain("attack-filter");
  });

  it("refuses a gate whose subject is not the attack's target", () => {
    const result = compile(placed(TEXT4, HERNKYN,
      ["ranged attacks", "attack-filter", { attack_type: "ranged" }],
      ["aimed at a unit within 12\"", "unit-position", { kind: "within", inches: 12, of: "this-unit", subject: "this-unit", negated: false }],
      ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]), TEXT4);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/needs a select-unit or attack right before it/);
  });
});
