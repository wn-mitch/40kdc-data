import { describe, expect, it } from "vitest";

import { crunch, type Buff, type BuffSource, type EngineContext } from "../src/cruncher/index.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { dataset } from "../src/data/index.js";

// Fabricated rules only; no GW rule prose. The goldens in conformance/ pin the contributions;
// these pin the gates the goldens do not project, and the DSL → engine path end to end.

const source: BuffSource = { kind: "ability", abilityId: "fabricated", abilityKind: "unit" };
const shooting: EngineContext = { phase: "shooting" };
const boltRifle = dataset.weapons.getAny("bolt-rifle")!.raw;
const intercessors = dataset.units.getAny("intercessor-squad")!.raw;

function stages(buffs: Buff[], context: EngineContext = shooting): Record<string, number> {
  const out = crunch({ attacker: { weapon: boltRifle, profileIndex: 0 }, target: { unit: intercessors, profileIndex: 0 }, modelsFiring: 5, buffs, context });
  return Object.fromEntries(out.stages.map((stage) => [stage.name, stage.expected]));
}

describe("cruncher damage levers: gates the goldens do not project", () => {
  it("gates a penalty to an attacker's WS on the fight phase and to its BS on the shooting phase", () => {
    const applied = effectToBuffs({ type: "sequence", steps: [
      { type: "stat-modifier", target: "attacker", modifier: { stat: "WS", operation: "worsen", value: 1 } },
      { type: "stat-modifier", target: "attacker", modifier: { stat: "BS", operation: "worsen", value: 1 } },
    ] }, source, shooting, "target").applied;
    expect(applied.map((buff) => buff.applicableWhen)).toEqual([{ phases: ["fight"] }, { phases: ["shooting"] }]);
  });

  it("gates a critical threshold and a re-roll by weapon type and weapon name", () => {
    const applied = effectToBuffs({ type: "sequence", steps: [
      { type: "roll-result", target: "this-unit", modifier: { roll: "wound", critical_on: 5, weapons: { type: "melee" } } },
      { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones", weapons: { name: "Fabricated Gun" } } },
    ] }, source, shooting).applied;
    expect(applied.map((buff) => buff.applicableWhen)).toEqual([{ phases: ["fight"] }, { weaponName: "fabricated gun" }]);
  });

  it("keeps both the phase and the weapon-name gate when a modifier carries both", () => {
    const applied = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapons: { type: "melee", name: "Fabricated Blade" } } }, source, shooting).applied;
    expect(applied.map((buff) => buff.applicableWhen)).toEqual([{ phases: ["fight"], weaponName: "fabricated blade" }]);
  });

  it("gates a critical threshold narrowed by a weapon keyword on that keyword, and refuses one it cannot read", () => {
    const gated = effectToBuffs({ type: "roll-result", target: "this-unit", modifier: { roll: "hit", critical_on: 5, weapons: { keyword: { keyword_id: "pistol" } } } }, source, shooting);
    expect(gated.unsupported).toEqual([]);
    expect(gated.applied.map((buff) => buff.applicableWhen)).toEqual([{ weaponKeywords: [{ keyword_id: "pistol" }] }]);
    const unreadable = effectToBuffs({ type: "roll-result", target: "this-unit", modifier: { roll: "hit", critical_on: 5, weapons: { keyword: { keyword_id: "" } } } }, source, shooting);
    expect(unreadable.applied).toEqual([]);
    expect(unreadable.unsupported.map((item) => item.reason)).toEqual(['roll-result: narrows by "weapons.keyword" which the cruncher can\'t resolve here']);
  });
});

describe("cruncher damage levers: malformed sizes", () => {
  it("refuses a WS/BS improvement or a set Save with no numeric value instead of reading it as 0", () => {
    const skill = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "BS", operation: "improve", value: null } }, source, shooting);
    const save = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "Sv", operation: "set", value: null } }, source, shooting, "target");
    expect(skill.applied).toEqual([]);
    expect(skill.unsupported.map((item) => item.reason)).toEqual(['stat-modifier BS: operation "improve" not supported']);
    expect(save.applied).toEqual([]);
    expect(save.unsupported.map((item) => item.reason)).toEqual(["stat-modifier Sv: set has no numeric value"]);
    const outOfRange = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "Sv", operation: "set", value: 7 } }, source, shooting, "target");
    expect(outOfRange.unsupported.map((item) => item.reason)).toEqual(['stat-modifier Sv: set value "7" is not a save characteristic']);
  });
});

describe("cruncher damage levers: DSL to engine", () => {
  it("improving a Save reduces damage and preserves literal add/subtract direction", () => {
    const save = (operation: string) => effectToBuffs({
      type: "stat-modifier", target: "this-unit",
      modifier: { stat: "Sv", operation, value: 1 },
    }, source, shooting, "target").applied;
    const baseline = stages([]).damage;
    expect(stages(save("improve")).damage).toBeLessThan(baseline);
    expect(stages(save("worsen")).damage).toBeGreaterThan(baseline);
    expect(stages(save("improve"))).toEqual(stages(save("subtract")));
    expect(stages(save("worsen"))).toEqual(stages(save("add")));
  });

  it("a critical hit threshold of 5+ with Lethal Hits raises wounds against the same target", () => {
    const lethal: Buff = { source: { kind: "manual", label: "lethal" }, contribution: { type: "extra-keyword", keywordRef: { keyword_id: "lethal-hits" } } };
    const crit = effectToBuffs({ type: "roll-result", target: "this-unit", modifier: { roll: "hit", critical_on: 5 } }, source, shooting).applied;
    // Crits on a 6 auto-wound; the other hits (3+ to 5) wound on a 5+ against T5.
    expect(stages([lethal]).wounds).toBeCloseTo(10 * (1 / 6) + 10 * (3 / 6) * (1 / 3), 6);
    expect(stages([lethal, ...crit]).wounds).toBeCloseTo(10 * (2 / 6) + 10 * (2 / 6) * (1 / 3), 6);
  });

  it("a weapon-named Attacks lift reaches only that weapon's attacks", () => {
    const lift = (name: string) => effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapons: { name } } }, source, shooting).applied;
    expect(stages(lift("Bolt Rifles")).attacks).toBe(15);
    expect(stages(lift("Fabricated Gun")).attacks).toBe(10);
  });
});

it("keeps structured weapon scopes on attack predicates until weapon resolution", () => {
  const result = effectToBuffs({ type: "conditional",
    condition: { type: "attack-is", parameters: { weapons: { type: "ranged", name: "Bolt Rifles", exclude_keyword: { keyword_id: "heavy" } } } },
    effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } },
  }, source, shooting);
  expect(result.unsupported).toEqual([]);
  expect(result.applied[0].applicableWhen).toEqual({ phases: ["shooting"], weaponName: "bolt rifles", excludedWeaponKeywords: [{ keyword_id: "heavy" }] });
});

it("uses structured Anti alternatives and exclusions through the engine", () => {
  const baseline = stages([]).wounds;
  const grant = (parameters: Record<string, unknown>) => effectToBuffs({
    type: "weapon-ability-grant", target: "this-unit",
    modifier: { keywords: [{ keyword_id: "anti", parameters: { ...parameters, threshold: 2 } }] },
  }, source, shooting).applied;
  expect(stages(grant({ required_target_keywords_any: ["INFANTRY", "VEHICLE"] })).wounds).toBeGreaterThan(baseline);
  expect(stages(grant({ excluded_target_keywords: ["VEHICLE"] })).wounds).toBeGreaterThan(baseline);
  expect(stages(grant({ excluded_target_keywords: ["INFANTRY"] })).wounds).toBe(baseline);
});
