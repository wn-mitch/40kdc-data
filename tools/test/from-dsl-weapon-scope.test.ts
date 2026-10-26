import { describe, expect, it } from "vitest";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { crunch, type Buff, type BuffSource } from "../src/cruncher/index.js";
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
  const bound = (scope: Record<string, unknown>) => ({
    type: "sequence",
    steps: [
      { type: "select-weapon", target: "this-model", modifier: { bind_as: "example-weapon", weapons: scope } },
      { type: "sequence", steps: [{ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "improve", value: 1, weapons: { ref: { weapon_var: "example-weapon" } } } }] },
    ],
  });

  it("applies the effects naming the bound weapon to that weapon only", () => {
    const { applied, unsupported } = effectToBuffs(bound({ name: "example blaster" }), source, {});
    expect(unsupported).toEqual([]);
    expect(applied).toEqual([{ source, contribution: { type: "attacks-mod", value: 1 }, applicableWhen: { weaponName: "example blaster" } }]);
    expect(hits(gun("example blaster", []), applied)).toBeGreaterThan(hits(gun("example blaster", []), []));
    expect(hits(gun("other blaster", []), applied)).toBe(hits(gun("other blaster", []), []));
  });

  it("keeps a selection that does not name its weapon unresolved: the player picks among several", () => {
    const { applied, unsupported } = effectToBuffs(bound({ type: "ranged" }), source, {});
    expect(applied).toEqual([]);
    expect(unsupported.map((item) => item.reason)).toEqual([
      "select-weapon: a bound weapon is not resolved by the buff engine",
      'stat-modifier: narrows by "weapons.ref" which the cruncher can\'t resolve here',
    ]);
  });
});
