import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import { describeCondition, describeEffect, type Effect } from "../src/translate/index.js";

/**
 * Weapon range in semantic authoring: weapon-ability-range (a weapon ability at full range),
 * unit-position weapon_range (a distance equal to the attacking weapon's range), and a Range
 * modifier under a weapon-property scope. Fabricated wording only.
 */

type Item = readonly [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
const TACTICUS = ["Friendly Tacticus units'", "unit-filter", { side: "friendly", keywords: ["TACTICUS"] }] as const;
const RAPID_FIRE_TEXT = "Friendly Tacticus units' Rapid Fire attacks benefit from Rapid Fire when targeting units up to that attack's maximum range.";
const RANGE = (subject: string): Item => ["Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject, keyword: "Rapid Fire", within: "weapon" }];

describe("Semantic authoring weapon-ability-range: a weapon ability tested at full range", () => {
  it("binds the leading unit-filter's units as the effect's target, with no condition leaf", () => {
    const result = compileLeaves(placed(RAPID_FIRE_TEXT, TACTICUS, RANGE("antecedent")), RAPID_FIRE_TEXT, {});
    expect(result.ok).toBe(true);
    expect(result.ok && result.mechanics.effect).toEqual({
      type: "weapon-ability-range",
      target: { owner: "friendly", all_of: ["TACTICUS"] },
      modifier: { keyword: { keyword_id: "rapid-fire" }, range: "weapon" },
    });
  });

  it("lowers a this-unit subject to the effect node with the keyword and the weapon range", () => {
    const text = "This unit's Rapid Fire attacks benefit from Rapid Fire.";
    const result = compileLeaves(placed(text, ["Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "weapon" }]), text, {});
    expect(result.ok).toBe(true);
    expect(result.ok && result.mechanics.effect).toMatchObject({ type: "weapon-ability-range", target: "this-unit", modifier: { keyword: { keyword_id: "rapid-fire" }, range: "weapon" } });
  });

  it("describes the benefit against the weapon's full range", () => {
    const effect = { type: "weapon-ability-range", target: "this-unit", modifier: { keyword: { keyword_id: "rapid-fire" }, range: "weapon" } } as unknown as Effect;
    expect(describeEffect(effect)).toBe("The unit's attacks benefit from [RAPID FIRE] when the target is within the weapon's range.");
  });

  it("refuses an antecedent subject with no earlier unit-filter or selection, rather than defaulting to this unit", () => {
    const text = "Rapid Fire attacks benefit from Rapid Fire.";
    const result = compileLeaves(placed(text, ["Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject: "antecedent", keyword: "Rapid Fire", within: "weapon" }]), text, {});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/no earlier unit-filter or selection/u);
  });

  it("keeps a weapon-ability-range effect in a lasting window, so a used ability's phase bounds it", () => {
    const text = "In your Shooting phase, this unit's Rapid Fire attacks benefit from Rapid Fire.";
    const lasting = compileLeaves(placed(text,
      ["In your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["this unit's Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "weapon" }],
    ), text, {});
    expect(lasting.ok, lasting.ok ? "" : lasting.errors.join("; ")).toBe(true);
    expect(JSON.stringify(lasting.ok && lasting.mechanics)).toContain('"duration":"phase"');
  });

  it("refuses a keyword other than Rapid Fire", () => {
    expect(() => normalize("weapon-ability-range", { subject: "this-unit", keyword: "Melta", within: "weapon" })).toThrow(/keyword must be one of Rapid Fire/u);
  });

  it("refuses a range other than the full weapon range", () => {
    expect(() => normalize("weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "half-weapon" })).toThrow(/within must be one of weapon/u);
  });

  it("refuses a parameter the family does not declare", () => {
    expect(() => normalize("weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "weapon", extra: 1 })).toThrow();
  });
});

const HIT_PLUS_ONE = { roll: "hit", operation: "add", value: 1 };
const RANGED = ["ranged attacks", "attack-filter", { attack_type: "ranged" }] as const;
const FRIENDLY = ["Friendly Echo units'", "unit-filter", { side: "friendly", keywords: ["ECHO"] }] as const;
const TEXT = "Friendly Echo units' ranged attacks aimed at a unit within half range have +1 to hit rolls.";
const gate = (range: "half" | "full", extra: Record<string, unknown> = {}): Item =>
  ["aimed at a unit within half range", "unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: range, ...extra }];

function mechanicsOf(text: string, items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text, {});
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

describe("Semantic authoring unit-position weapon_range: a distance equal to the attacking weapon's range", () => {
  it("lowers half range to a within test of the attacker at half-weapon range", () => {
    const json = JSON.stringify(mechanicsOf(TEXT, [FRIENDLY, RANGED, gate("half"), ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]]));
    expect(json).toContain('"subject":"defender","filter":{"within":{"of":"attacker","range":"half-weapon"}}');
    expect(json).not.toContain('"inches"');
  });

  it("lowers full range to a within test at the weapon's range", () => {
    const text = "Friendly Echo units' ranged attacks aimed at a unit within range have +1 to hit rolls.";
    const json = JSON.stringify(mechanicsOf(text, [FRIENDLY, RANGED, ["aimed at a unit within range", "unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: "full" }], ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]]));
    expect(json).toContain('"subject":"defender","filter":{"within":{"of":"attacker","range":"weapon"}}');
    expect(json).not.toContain("half-weapon");
  });

  it("negated lowers to a not-within test, the beyond form", () => {
    const json = JSON.stringify(mechanicsOf(TEXT, [FRIENDLY, RANGED, gate("half", { negated: true }), ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]]));
    expect(json).toContain('"operator":"not"');
    expect(json).toContain('"range":"half-weapon"');
  });

  it("describes half range as the attacking weapon's half range", () => {
    const condition = { type: "matches", parameters: { subject: "defender", filter: { within: { of: "attacker", range: "half-weapon" } } } };
    expect(describeCondition(condition as any)).toBe("the target is within half the attacking weapon's range");
  });

  it("refuses a weapon_range leaf that also names inches", () => {
    expect(() => normalize("unit-position", { kind: "within", inches: 6, subject: "target", of: "attacker", negated: false, weapon_range: "half" })).toThrow(/takes no inches/u);
  });

  it("refuses a weapon_range leaf measured from anything but the attacker", () => {
    expect(() => normalize("unit-position", { kind: "within", subject: "target", of: "this-unit", negated: false, weapon_range: "half" })).toThrow(/measured from the attacker/u);
  });

  it("refuses a weapon_range leaf on a beyond distance", () => {
    expect(() => normalize("unit-position", { kind: "beyond", subject: "target", of: "attacker", negated: false, weapon_range: "half" })).toThrow(/measures a within distance/u);
  });

  it("refuses a weapon_range leaf whose subject is not the attack's target", () => {
    expect(() => normalize("unit-position", { kind: "within", subject: "this-unit", of: "attacker", negated: false, weapon_range: "half" })).toThrow(/describes the attack's target/u);
  });

  it("refuses a weapon_range value other than half or full", () => {
    expect(() => normalize("unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: "double" })).toThrow(/must be one of half, full/u);
  });

  it("still refuses a within leaf with neither inches nor weapon_range", () => {
    expect(() => normalize("unit-position", { kind: "within", subject: "target", of: "attacker", negated: false })).toThrow();
  });

  it("maps a version-14 distance leaf to the current version with its parameters unchanged", () => {
    const parameters = { kind: "within", inches: 12, of: "attacker", subject: "target", negated: false };
    expect(mapToLatest("unit-position", 14, parameters)).toEqual({ family: "unit-position", version: currentFamilyVersion("unit-position"), parameters });
    expect(currentFamilyVersion("unit-position")).toBeGreaterThan(14);
  });

  it("refuses a weapon_range limit on a set-up's placement rather than folding it as a distance", () => {
    const text = "Your unit can be set up aimed at a unit within half range.";
    const result = compileLeaves(placed(text,
      ["Your unit can be set up", "set-up", { subject: "target", to: "battlefield", allow: true }],
      ["aimed at a unit within half range", "unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: "half" }],
    ), text, {});
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/half- or full-weapon distance has no placement form/u);
  });
});

// The design's record-shape check: a unit's ranged attacks that target a unit within half range gain a keyword.
describe("Semantic authoring weapon-range override shapes compile end to end", () => {
  it("compiles the attack-gated keyword grant for a ranged attack at half range", () => {
    const text = "This unit's ranged attacks that target a unit within half range have [Sustained Hits 1].";
    const result = compileLeaves(placed(text,
      ["This unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      ["that target a unit within half range", "unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: "half" }],
      ["have", "weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged" }],
      ["[Sustained Hits 1]", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
    ), text, {});
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    expect(JSON.stringify(result.ok && result.mechanics)).toContain('"range":"half-weapon"');
  });
});

// Re-roll gates on the attack's target: the half-range test sits between the attack and the re-roll.
describe("Semantic authoring weapon-range override: re-roll gates on a half-range target", () => {
  it("compiles a hit re-roll gated on the hit's target, with the wound re-roll gated the same way", () => {
    const text = "Your unit's ranged attacks: Can re-roll hit rolls of 1. That target a unit within half range, can re-roll wound rolls of 1.";
    const result = compileLeaves(placed(text,
      ["Your unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      ["Can re-roll hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
      ["That target a unit within half range", "unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: "half" }],
      ["can re-roll wound rolls of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
    ), text, {});
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    expect(JSON.stringify(result.ok && result.mechanics)).toContain('"range":"half-weapon"');
  });

  it("compiles a per-attack re-roll gated on a half-range target under an end-of-phase duration", () => {
    const text = "Until the end of the phase, each time a model in your unit makes an attack that targets a unit within half range, re-roll a Hit roll of 1.";
    const result = compileLeaves(placed(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["each time a model in your unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["that targets a unit within half range", "unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: "half" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
    ), text, {});
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    expect(JSON.stringify(result.ok && result.mechanics)).toContain('"range":"half-weapon"');
  });
});

// Range is a weapon characteristic, so a weapon-property scope binds it the way it binds Attacks or
// Strength (the scope's weapon type and recipient go onto the stat). characteristic-set cannot name
// Range (its CHARACTERISTICS list omits it), so Range reaches the compiler only through
// characteristic-modifier.
const run = (text: string, pieces: Item[]) => compileLeaves(placed(text, ...pieces), text);
const errorsOf = (text: string, pieces: Item[]) => {
  const result = run(text, pieces);
  return result.ok ? [] : result.errors;
};
const scopeRanged: Item = ["Ranged attacks", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }];

describe("Semantic authoring Range under a weapon-property scope", () => {
  it("binds a Range modifier to the scope's weapon type and recipient", () => {
    const text = "Ranged attacks: +6 Range.";
    const result = run(text, [scopeRanged, ["+6 Range", "characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 6 }]]);
    expect(result.ok).toBe(true);
    const json = JSON.stringify((result as { mechanics: unknown }).mechanics);
    expect(json).toContain('"stat":"Range"');
    expect(json).toContain('"weapons":{"type":"ranged"}');
    expect(json).toContain('"value":6');
  });

  it("keeps refusing a model characteristic under a weapon scope", () => {
    const text = "Ranged attacks: +1 T.";
    expect(errorsOf(text, [scopeRanged, ["+1 T", "characteristic-modifier", { characteristics: ["T"], operation: "improve", value: 1 }]]))
      .toContain("An attack-property scope cannot modify a model characteristic.");
  });

  it("refuses a model characteristic beside Range in one modifier", () => {
    const text = "Ranged attacks: +1 T and Range.";
    expect(errorsOf(text, [scopeRanged, ["+1 T and Range", "characteristic-modifier", { characteristics: ["T", "Range"], operation: "improve", value: 1 }]]))
      .toContain("An attack-property scope cannot modify a model characteristic.");
  });

  it("binds a Range modifier through the stat-first hoist of an open scope", () => {
    const text = "Ranged weapons equipped by non-CHARACTER models in this unit have +6 Range.";
    const result = run(text, [
      ["Ranged weapons equipped by", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged" }],
      ["non-CHARACTER models", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }],
      ["have +6 Range", "characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 6 }],
    ]);
    expect(result.ok ? [] : (result as { errors: string[] }).errors).toEqual([]);
    const json = JSON.stringify((result as { mechanics: unknown }).mechanics);
    expect(json).toContain('"stat":"Range"');
    expect(json).toContain('"member_of":"this-unit"');
  });

  it("refuses a characteristic-set on Range, so a set cannot reach the Range scope path", () => {
    const version = currentFamilyVersion("characteristic-set");
    expect(() => normalizeFingerprintParameters("characteristic-set", { subject: "this-unit", characteristic: "Range", value: 6 }, version)).toThrow();
  });
});
