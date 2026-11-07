import { describe, expect, it } from "vitest";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { crunch, type Buff, type BuffSource, type EngineContext } from "../src/cruncher/index.js";
import type { Unit, Weapon } from "../src/generated.js";

const source: BuffSource = { kind: "ability", abilityId: "fabricated-weapon-scope", abilityKind: "unit" };
const GV = { edition: "11th", dataslate: "launch" } as const;
const blast = { type: "attack-is", parameters: { weapons: { keyword: { keyword_id: "blast" } } } };
const rerollOnes = (condition: unknown) => ({
  type: "conditional",
  condition,
  effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
});

function gun(id: string, keywords: string[]): Weapon {
  return {
    id,
    name: id,
    type: "ranged",
    profiles: [{ name: id, range: 24, stats: { A: 6, BS: 4, S: 4, AP: 0, D: 1 }, keywords: keywords.map((keyword_id) => ({ keyword_id })) }],
    game_version: GV,
  } as Weapon;
}

const target = {
  id: "target",
  name: "Target",
  faction_id: "test",
  profiles: [{ name: "target", M: 6, T: 4, W: 1, Sv: 7, Ld: 7, OC: 1 }],
  keywords: ["Infantry"],
  faction_keywords: [],
  game_version: GV,
} as Unit;

const hits = (weapon: Weapon, buffs: Buff[]) =>
  crunch({ attacker: { weapon, profileIndex: 0 }, target: { unit: target, profileIndex: 0, modelCount: 1 }, modelsFiring: 1, buffs, context: { phase: "shooting" } })
    .stages.find((stage) => stage.name === "hits")!.expected;

describe("effectToBuffs: weapon-scoped conditions", () => {
  it("reads a negated weapon keyword as an exclusion", () => {
    const result = effectToBuffs(rerollOnes({ operator: "not", operands: [blast] }), source, { phase: "shooting" }, "attacker");
    expect(result.unsupported).toEqual([]);
    expect(result.applied.map((buff) => buff.applicableWhen)).toEqual([{ excludedWeaponKeywords: [{ keyword_id: "blast" }] }]);

    // The re-roll lifts the non-Blast gun's hits and leaves the Blast gun's alone.
    const rifle = gun("rifle", []);
    const cannon = gun("cannon", ["blast"]);
    expect(hits(rifle, result.applied)).toBeGreaterThan(hits(rifle, []));
    expect(hits(cannon, result.applied)).toBe(hits(cannon, []));
  });

  it("keeps a negation it cannot express per weapon unresolved", () => {
    const named = { type: "attack-is", parameters: { weapons: { name: "Plague spewer" } } };
    const both = { type: "attack-is", parameters: { weapons: { keyword: { keyword_id: "blast" } }, attack_type: "ranged" } };
    for (const operand of [named, both]) {
      const result = effectToBuffs(rerollOnes({ operator: "not", operands: [operand] }), source, { phase: "shooting" }, "attacker");
      expect(result.applied).toEqual([]);
      expect(result.unsupported.map((entry) => entry.reason)).toEqual(['conditional: cannot evaluate condition "not" against current context']);
    }
  });
});

describe("effectToBuffs: a weapon a selection binds by name", () => {
  // No phase or battle state is known: these fragments translate without one.
  const noContext = {} as EngineContext;
  const bound = (scope: Record<string, unknown>) => ({
    type: "sequence",
    steps: [
      { type: "select-weapon", target: "this-model", modifier: { bind_as: "example-weapon", weapons: scope } },
      { type: "sequence", steps: [{ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "improve", value: 1, weapons: { ref: { weapon_var: "example-weapon" } } } }] },
    ],
  });

  it("applies the effects naming the bound weapon to that weapon only", () => {
    const { applied, unsupported } = effectToBuffs(bound({ name: "example blaster" }), source, noContext);
    expect(unsupported).toEqual([]);
    expect(applied).toEqual([{ source, contribution: { type: "attacks-mod", value: 1 }, applicableWhen: { weaponName: "example blaster" } }]);
    expect(hits(gun("example blaster", []), applied)).toBeGreaterThan(hits(gun("example blaster", []), []));
    expect(hits(gun("other blaster", []), applied)).toBe(hits(gun("other blaster", []), []));
  });

  it("keeps a selection that does not name its weapon unresolved: the player picks among several", () => {
    const { applied, unsupported } = effectToBuffs(bound({ type: "ranged" }), source, noContext);
    expect(applied).toEqual([]);
    expect(unsupported.map((item) => item.reason)).toEqual([
      "select-weapon: a bound weapon is not resolved by the buff engine",
      'stat-modifier: narrows by "weapons.ref" which the cruncher can\'t resolve here',
    ]);
  });
});

describe("effectToBuffs: the attack's Strength against the target's Toughness", () => {
  const sAboveT = { type: "attack-compare", parameters: { left: { of: "attacker", stat: "S" }, comparison: "gt", right: { of: "defender", stat: "T" } } };
  const woundMod = (condition: unknown, operation = "add", target = "this-unit") => ({
    type: "conditional",
    condition,
    effect: { type: "roll-modifier", target, modifier: { roll: "wound", operation, value: 1 } },
  });
  const strong = (s: number, id = `s${s}`) => ({ ...gun(id, []), profiles: [{ ...gun(id, []).profiles[0], stats: { A: 6, BS: 4, S: s, AP: 0, D: 1 } }] }) as Weapon;
  const wounds = (weapon: Weapon, buffs: Buff[], unit: Unit = target, profileIndex = 0) =>
    crunch({ attacker: { weapon, profileIndex: 0 }, target: { unit, profileIndex, modelCount: 1 }, modelsFiring: 1, buffs, context: { phase: "shooting" } })
      .resolved.woundMod.value;

  it("gates the buff on the attack's modified Strength, not the printed one", () => {
    const { applied, unsupported } = effectToBuffs(woundMod(sAboveT), source, { phase: "shooting" }, "attacker");
    expect(unsupported).toEqual([]);
    expect(wounds(strong(5), applied)).toBe(1);
    expect(wounds(strong(4), applied)).toBe(0);
    // A +1 Strength buff lifts S4 above T4, so the comparison holds.
    const plusS: Buff = { source, contribution: { type: "strength-mod", value: 1 } } as Buff;
    expect(wounds(strong(4), [...applied, plusS])).toBe(1);
  });

  it("reads the defender's side for a defensive rule", () => {
    const { applied, unsupported } = effectToBuffs(woundMod(sAboveT, "subtract", "attacker"), source, { phase: "shooting" }, "target");
    expect(unsupported).toEqual([]);
    expect(wounds(strong(5), applied)).toBe(-1);
    expect(wounds(strong(3), applied)).toBe(0);
  });

  it("does not let a comparison-gated Strength buff feed its own comparison", () => {
    const gatedS = { type: "conditional", condition: sAboveT, effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } } };
    const { applied } = effectToBuffs(gatedS, source, { phase: "shooting" }, "attacker");
    const strength = (weapon: Weapon) =>
      crunch({ attacker: { weapon, profileIndex: 0 }, target: { unit: target, profileIndex: 0, modelCount: 1 }, modelsFiring: 1, buffs: applied, context: { phase: "shooting" } })
        .resolved.strengthMod.value;
    expect(strength(strong(4))).toBe(0);
    expect(strength(strong(5))).toBe(1);
  });

  it("compares against the target's highest Toughness for a reduce", () => {
    const belowMax = { type: "attack-compare", parameters: { left: { of: "attacker", stat: "S" }, comparison: "lt", right: { of: "defender", stat: "T", reduce: "max" } } };
    const mixed = { ...target, profiles: [target.profiles[0], { ...target.profiles[0], name: "big", T: 6 }] } as Unit;
    const { applied } = effectToBuffs(woundMod(belowMax), source, { phase: "shooting" }, "attacker");
    // S5 against the T4 profile: below the unit's highest Toughness (6), so it holds.
    expect(wounds(strong(5), applied, mixed, 0)).toBe(1);
    expect(wounds(strong(6), applied, mixed, 0)).toBe(0);
  });

  it("evaluates the unit predicates of a mixed conjunction and keeps the comparison as the gate", () => {
    const shootingOnly = { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, sAboveT] };
    const shooting = effectToBuffs(woundMod(shootingOnly), source, { phase: "shooting" }, "attacker");
    expect(shooting.unsupported).toEqual([]);
    expect(wounds(strong(5), shooting.applied)).toBe(1);
    expect(wounds(strong(4), shooting.applied)).toBe(0);
    expect(effectToBuffs(woundMod(shootingOnly), source, { phase: "fight" }, "attacker")).toEqual({ applied: [], unsupported: [], activatable: [] });
  });

  it("keeps a comparison of a characteristic the engine does not supply unresolved", () => {
    const attacks = { type: "attack-compare", parameters: { left: { of: "attacker", stat: "A" }, comparison: "gt", right: { value: 3 } } };
    const result = effectToBuffs(woundMod(attacks), source, { phase: "shooting" }, "attacker");
    expect(result.applied).toEqual([]);
    expect(result.unsupported.map((entry) => entry.reason)).toEqual(['conditional: cannot evaluate condition "attack-compare" against current context']);
  });
});
