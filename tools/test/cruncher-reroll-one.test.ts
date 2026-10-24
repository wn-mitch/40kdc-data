import { describe, expect, it } from "vitest";

import { Dataset } from "../src/data/dataset.js";
import { crunch, type Buff, type EngineInput, type Stage } from "../src/cruncher/index.js";
import { oneDamageRerollGain } from "../src/cruncher/damage-roll.js";

/*
 * "Re-roll one Hit/Wound/Damage roll / saving throw" is one die across the pool. Each expectation
 * here comes from enumerating every roll of a small pool and playing the die the way the rule lets
 * a player: a failed die no other permission re-rolled, or the lowest Damage roll below the mean.
 */

const ds = Dataset.embedded();

function input(weaponId: string, modelsFiring: number, targetUnitId: string, buffs: Buff[], context: EngineInput["context"] = { phase: "shooting" }): EngineInput {
  const weapon = ds.weapons.getAny(weaponId)!;
  const unit = ds.units.getAny(targetUnitId)!;
  return { attacker: { weapon: weapon.raw, profileIndex: 0 }, target: { unit: unit.raw, profileIndex: 0 }, modelsFiring, buffs, context };
}

const stage = (buffs: Buff[], name: Stage["name"], at = input("bolt-rifle", 1, "intercessor-squad", buffs)) =>
  crunch(at, ds).stages.find((item) => item.name === name)!.expected;
const one = (roll: "hit" | "wound" | "save" | "damage"): Buff => ({ source: { kind: "manual", label: `re-roll one ${roll}` }, contribution: { type: "reroll-one", roll } });
const ones = (roll: "hit" | "wound"): Buff => ({ source: { kind: "manual", label: `re-roll ${roll} 1s` }, contribution: { type: "reroll", roll, subset: "ones" } });

/** Every outcome of `dice` d6, with its probability. */
function* outcomes(dice: number): Generator<number[]> {
  const faces = Array<number>(dice).fill(1);
  for (;;) {
    yield [...faces];
    let at = 0;
    while (at < dice && faces[at] === 6) faces[at++] = 1;
    if (at === dice) return;
    faces[at]! += 1;
  }
}

/** Expected passes of `dice` checks needing `need`+, re-rolling 1s first if `rerollOnes`, then one other failed die. */
function bruteChecks(dice: number, need: number, rerollOnes: boolean): number {
  const pass = (face: number) => face !== 1 && face >= need;
  const fresh = [1, 2, 3, 4, 5, 6].filter(pass).length / 6;
  let total = 0;
  for (const faces of outcomes(dice)) {
    let value = 0;
    let open = false;
    for (const face of faces) {
      if (pass(face)) value += 1;
      else if (rerollOnes && face === 1) value += fresh;
      else open = true;
    }
    total += (value + (open ? fresh : 0)) / 6 ** dice;
  }
  return total;
}

describe("Re-roll one Hit roll", () => {
  // A bolt rifle has two attacks at BS 3+.
  it("re-rolls one failed die of the pool", () => {
    expect(stage([one("hit")], "hits")).toBeCloseTo(bruteChecks(2, 3, false), 12);
    expect(stage([], "hits")).toBeCloseTo(2 * (4 / 6), 12);
  });

  it("takes only a failed die that re-rolling 1s left", () => {
    expect(stage([ones("hit"), one("hit")], "hits")).toBeCloseTo(bruteChecks(2, 3, true), 12);
  });

  it("adds nothing beside a re-roll of every failed die", () => {
    const all: Buff = { source: { kind: "manual", label: "all" }, contribution: { type: "reroll", roll: "hit", subset: "all-failures" } };
    expect(stage([all, one("hit")], "hits")).toBeCloseTo(stage([all], "hits"), 12);
  });

  it("is one die however many sources grant it", () => {
    const second: Buff = { source: { kind: "manual", label: "again" }, contribution: { type: "reroll-one", roll: "hit" } };
    expect(stage([one("hit"), second], "hits")).toBeCloseTo(stage([one("hit")], "hits"), 12);
  });
});

describe("Re-roll one Wound roll", () => {
  it("re-rolls one failed Wound roll among the hits", () => {
    const hits = stage([], "hits");
    const detail = crunch(input("bolt-rifle", 1, "intercessor-squad", []), ds).stages.find((item) => item.name === "wounds")!.detail;
    const need = Number(/need (\d)\+/u.exec(detail)![1]);
    const fresh = (7 - need) / 6;
    // A failed Wound roll no other permission re-rolled is every failing face; one comes back as a fresh roll.
    // The hits are an expectation (4/3), so the chance is read between the whole pools either side.
    const atWhole = (dice: number) => 1 - Math.pow(fresh, dice);
    const low = Math.floor(hits);
    const between = atWhole(low) + (hits - low) * (atWhole(low + 1) - atWhole(low));
    expect(hits % 1).not.toBe(0);
    expect(stage([one("wound")], "wounds") - stage([], "wounds")).toBeCloseTo(between * fresh, 12);
  });
});

describe("Re-roll one Damage roll", () => {
  it("re-rolls the lowest of the rolls when it is below a fresh roll's mean", () => {
    const d6 = [1, 2, 3, 4, 5, 6].map((value) => ({ value, probability: 1 / 6 }));
    for (const rolls of [1, 2, 3]) {
      let brute = 0;
      for (const faces of outcomes(rolls)) {
        const low = Math.min(...faces);
        brute += Math.max(0, 3.5 - low) / 6 ** rolls;
      }
      expect(oneDamageRerollGain(d6, rolls)).toBeCloseTo(brute, 12);
    }
    // A fixed Damage has nothing to gain.
    expect(oneDamageRerollGain([{ value: 2, probability: 1 }], 4)).toBe(0);
  });

  it("adds to the damage of a variable-Damage weapon and not of a fixed one", () => {
    const melta = (buffs: Buff[]) => stage(buffs, "damage", input("multi-melta", 1, "questoris-knight-magaera", buffs));
    expect(melta([one("damage")])).toBeGreaterThan(melta([]));
    expect(stage([one("damage")], "damage")).toBeCloseTo(stage([], "damage"), 12);
  });
});

describe("Re-roll one saving throw", () => {
  it("saves one more failed save of the defender's", () => {
    const plain = stage([], "unsaved");
    const saved = stage([one("save")], "unsaved");
    expect(saved).toBeLessThan(plain);
  });
});

describe("One re-rolled die for a whole unit", () => {
  it("is priced once, on the profile it adds the most to, not on every profile", async () => {
    const { resolveTarget } = await import("../src/compare.js");
    const { crunchProfileScorer, resolveUnitWeapon, unitLoadoutDamage } = await import("../src/stack-damage/unit-damage.js");
    const { unitWeaponGrants } = await import("../src/stack-damage/weapon-grants.js");
    const crisis = ds.units.getInFaction("crisis-fireknife-battlesuits", "tau-empire")!.raw;
    const guardsmen = resolveTarget(ds, ds.targetProfiles.get("geq-guardsmen")!)!;
    const context = { phase: "shooting" as const, armyFaction: "tau-empire" };
    const counts = new Map([["missile-pod", 6], ["battlesuit-fists", 3], ["gun-drone", 2]]);
    const grants = unitWeaponGrants(ds, crisis, "tau-empire", { ...context, attackerWargear: { "gun-drone": 2 } }).grants;
    const target = { unit: guardsmen.unitRaw, modelCount: guardsmen.modelCount };
    const run = (buffs: Buff[]) => unitLoadoutDamage({ dataset: ds, unit: crisis, modelCount: 3, counts, target, buffs, context, groups: null, grants });
    const plain = run([]);
    expect(plain.selected.length).toBeGreaterThan(1);
    const withOne = crunchProfileScorer(ds, target, [one("hit")]);
    const gains = plain.selected.map((selected) => withOne({ weapon: resolveUnitWeapon(ds, crisis, selected.weaponId)!, profileIndex: selected.profileIndex, modelsFiring: selected.count, context })!.damage - selected.damage);
    expect(gains.filter((gain) => gain > 0).length).toBeGreaterThan(1);
    expect(run([one("hit")]).total - plain.total).toBeCloseTo(Math.max(...gains), 12);
  });
});
