import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { mapToLatest } from "../src/round5c/family-versions.js";
import { describeCondition } from "../src/translate/index.js";

type Item = [string, string, Record<string, unknown>];

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

describe("Round 5C unit-position weapon_range: a distance equal to the attacking weapon's range", () => {
  it("lowers half range to a within test of the attacker at half-weapon range", () => {
    const json = JSON.stringify(mechanicsOf(TEXT, [FRIENDLY, RANGED, gate("half"), ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]]));
    expect(json).toContain('"subject":"defender","of":"attacker","range":"half-weapon"');
    expect(json).not.toContain('"inches"');
  });

  it("lowers full range to a within test at the weapon's range", () => {
    const text = "Friendly Echo units' ranged attacks aimed at a unit within range have +1 to hit rolls.";
    const json = JSON.stringify(mechanicsOf(text, [FRIENDLY, RANGED, ["aimed at a unit within range", "unit-position", { kind: "within", subject: "target", of: "attacker", negated: false, weapon_range: "full" }], ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]]));
    expect(json).toContain('"subject":"defender","of":"attacker","range":"weapon"');
    expect(json).not.toContain("half-weapon");
  });

  it("negated lowers to a not-within test, the beyond form", () => {
    const json = JSON.stringify(mechanicsOf(TEXT, [FRIENDLY, RANGED, gate("half", { negated: true }), ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]]));
    expect(json).toContain('"operator":"not"');
    expect(json).toContain('"range":"half-weapon"');
  });

  it("describes half range as the attacking weapon's half range", () => {
    const condition = { type: "within", parameters: { subject: "defender", of: "attacker", range: "half-weapon" } };
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
describe("Round 5C weapon-range override shapes compile end to end", () => {
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
describe("Round 5C weapon-range override: re-roll gates on a half-range target", () => {
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
