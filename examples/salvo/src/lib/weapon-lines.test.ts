import { describe, expect, it } from "vitest";
import {
  DAMAGE_DEALT,
  DAMAGE_DEALT_MEASURES,
  attributeSelectedProfile,
  attributeStages,
  crunch,
  Dataset,
  loadoutHitModifier,
  profileEngineInput,
  unitLoadoutDamage,
  validateCandidateLoadout,
  type Buff,
  type EngineContext,
} from "@alpaca-software/40kdc-data";

import { defaultWeaponCount, editedCounts, lineId, memberCounts, memberLoadout, selectLines, weaponLines } from "./weapon-lines.js";

const ds = Dataset.embedded();
const target = { unit: ds.units.getAny("intercessor-squad")!.raw, modelCount: 5 };

const FACTION: Record<string, string> = { defiler: "chaos-space-marines", legionaries: "chaos-space-marines", "plague-marines": "death-guard", "skitarii-rangers": "adeptus-mechanicus" };
const unitOf = (unitId: string) => ds.units.getInFaction(unitId, FACTION[unitId]!)!;

function member(unitId: string, counts?: Record<string, number>) {
  const unit = unitOf(unitId);
  const loadout = memberLoadout(ds, unit.raw);
  const carried = counts
    ? new Map(Object.entries(counts))
    : memberCounts(loadout, unit.weapons.map((w) => w.id), (weaponId) => defaultWeaponCount(loadout, weaponId));
  return { unit, loadout, counts: carried };
}

/** Salvo's per-line engine input: the models firing the line, with the loadout rules' Hit roll modifier. */
function lineInput(unitId: string, line: ReturnType<typeof weaponLines>[number], models: number, buffs: Buff[], context: EngineContext) {
  const hitModifier = loadoutHitModifier(unitOf(unitId).raw, line.weaponRaw.profiles[line.profileIndex], context);
  return profileEngineInput({ weapon: line.weaponRaw, profileIndex: line.profileIndex, target, modelsFiring: models, buffs, context, hitModifier });
}

function linesOf(unitId: string, context: EngineContext) {
  const unit = unitOf(unitId);
  return weaponLines([{ memberId: unitId, name: unit.name, weapons: unit.weapons.map((w) => w.raw) }], context.phase === "fight" ? "melee" : "ranged");
}

/** Salvo's per-line path: each used line crunched with the models firing it, summed. */
function lineTotal(unitId: string, firing: Map<string, number>, context: EngineContext, buffs: Buff[] = []): number {
  return linesOf(unitId, context).reduce((sum, line) => {
    const models = firing.get(line.id);
    if (!models) return sum;
    const out = crunch(lineInput(unitId, line, models, buffs, context), ds);
    return sum + out.damageDealt;
  }, 0);
}

describe("selectLines", () => {
  for (const [unitId, phase] of [["legionaries", "shooting"], ["legionaries", "fight"], ["plague-marines", "shooting"], ["plague-marines", "fight"], ["skitarii-rangers", "shooting"]] as const) {
    it(`scores the lines Salvo shows exactly as the shared loadout scoring: ${unitId} ${phase}`, () => {
      const { loadout, counts } = member(unitId);
      const context: EngineContext = { phase };
      const selection = selectLines({ ds, members: [{ memberId: unitId, loadout, counts }], target, buffs: [], context });
      const legality = validateCandidateLoadout({ unit: loadout.unit, modelCount: loadout.modelCount, counts, loadout: loadout.rules });
      const shared = unitLoadoutDamage({ dataset: ds, unit: loadout.unit, modelCount: loadout.modelCount, counts, target, buffs: [], context, groups: legality.groups });
      expect(selection.total).toBeCloseTo(shared.total, 9);
      expect(lineTotal(unitId, selection.firing, context)).toBeCloseTo(shared.total, 9);
    });
  }

  it("crunches an engaged vehicle's lines with the penalty its selection was scored with, and attributes them as the matrix does", () => {
    const { loadout, counts } = member("defiler");
    const context: EngineContext = { phase: "shooting", attackerStates: ["engaged"] };
    const buffs: Buff[] = [{ source: { kind: "manual", label: "+1 to hit" }, contribution: { type: "hit-mod", value: 1 } }];
    const selection = selectLines({ ds, members: [{ memberId: "defiler", loadout, counts }], target, buffs, context });
    const legality = validateCandidateLoadout({ unit: loadout.unit, modelCount: loadout.modelCount, counts, loadout: loadout.rules });
    const shared = unitLoadoutDamage({ dataset: ds, unit: loadout.unit, modelCount: loadout.modelCount, counts, target, buffs, context, groups: legality.groups });
    expect(shared.selected.some((weapon) => weapon.hitModifier === -1)).toBe(true);
    expect(lineTotal("defiler", selection.firing, context, buffs)).toBeCloseTo(shared.total, 9);

    for (const weapon of shared.selected) {
      const line = linesOf("defiler", context).find((candidate) => candidate.id === lineId("defiler", weapon.weaponId, weapon.profileIndex))!;
      const salvo = attributeStages(lineInput("defiler", line, selection.firing.get(line.id)!, buffs, context), ds, { measures: DAMAGE_DEALT_MEASURES })
        .find((stage) => stage.name === DAMAGE_DEALT)!;
      const matrix = attributeSelectedProfile({ dataset: ds, unit: loadout.unit, selected: weapon, target, buffs, context })!;
      expect(salvo.baseline).toBeCloseTo(matrix.baseline, 9);
      expect(salvo.lifts.map((lift) => lift.delta)).toEqual(matrix.lifts.map((lift) => lift.delta));
    }
  });

  it("gives each model one ordinary melee weapon instead of summing every melee line", () => {
    // Five Legionaries, one with a heavy melee weapon in place of a boltgun: six melee weapons.
    const { loadout, counts } = member("legionaries", { "bolt-pistol": 5, boltgun: 4, "close-combat-weapon": 5, "heavy-melee-weapon": 1 });
    const selection = selectLines({ ds, members: [{ memberId: "legionaries", loadout, counts }], target, buffs: [], context: { phase: "fight" } });
    const fired = [...selection.firing.values()].reduce((sum, n) => sum + n, 0);
    expect(fired).toBe(loadout.modelCount);
    expect([...counts.entries()].filter(([id]) => ds.weapons.getAny(id)?.raw.type === "melee").reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(fired);
  });

  it("fires a model's Pistol or its other guns, never both", () => {
    // Five Legionaries: one sergeant with a plasma pistol and boltgun, four with bolt pistols and boltguns.
    const { loadout } = member("legionaries");
    const counts = new Map([["plasma-pistol", 1], ["bolt-pistol", 4], ["boltgun", 5], ["close-combat-weapon", 5]]);
    const selection = selectLines({ ds, members: [{ memberId: "legionaries", loadout, counts }], target, buffs: [], context: { phase: "shooting" } });
    const pistols = [...selection.firing].filter(([id]) => id.includes("pistol")).reduce((sum, [, n]) => sum + n, 0);
    const others = [...selection.firing].filter(([id]) => !id.includes("pistol")).reduce((sum, [, n]) => sum + n, 0);
    expect(pistols + others).toBe(5);
    expect(selection.firing.has(lineId("legionaries", "boltgun", 0)) || pistols === 5).toBe(true);
  });

  it("reports wargear the counts make illegal", () => {
    const { loadout } = member("legionaries");
    // Every Legionary with a heavy melee weapon: only the champion and one other may take one.
    const counts = new Map([["heavy-melee-weapon", 5], ["bolt-pistol", 5], ["close-combat-weapon", 5]]);
    const selection = selectLines({ ds, members: [{ memberId: "legionaries", loadout, counts }], target, buffs: [], context: { phase: "fight" } });
    expect(selection.violations.get("legionaries")?.length).toBeGreaterThan(0);
  });
});

describe("weapon lines", () => {
  it("bucket each profile of a weapon with ranged and melee profiles into its own phase", () => {
    // The Castellan axe is a ranged weapon with a melee profile; the Allarus spear the reverse.
    const weapons = ["castellan-axe", "guardian-spear-allarus-custodians"].map((id) => ds.weapons.getInFaction(id, "adeptus-custodes")!.raw);
    const members = [{ memberId: "allarus-custodians", name: "Allarus Custodians", weapons }];
    const ids = (type: "ranged" | "melee") => weaponLines(members, type).map((line) => `${line.weaponId}:${line.profileIndex}`);
    expect(ids("melee")).toEqual(["castellan-axe:1", "guardian-spear-allarus-custodians:0"]);
    expect(ids("ranged")).toEqual(["castellan-axe:0", "guardian-spear-allarus-custodians:1"]);
  });

  it("name a line by its profile only when the profile name tells it apart", () => {
    const axe = ds.weapons.getInFaction("castellan-axe", "adeptus-custodes")!.raw;
    const pistol = ds.weapons.all.find((w) => w.raw.profiles.filter((p) => p.range !== "Melee").length > 1 && new Set(w.raw.profiles.map((p) => p.name.toLowerCase())).size === w.raw.profiles.length && !w.raw.profiles.some((p) => p.name.toLowerCase() === w.raw.name.toLowerCase()))!.raw;
    const labels = (weapons: typeof axe[], type: "ranged" | "melee") => weaponLines([{ memberId: "m", name: "M", weapons }], type).map((line) => line.label);
    // Each phase sees one Castellan Axe profile, named like the weapon.
    expect(labels([axe], "melee")).toEqual(["Castellan axe"]);
    expect(labels([axe], "ranged")).toEqual(["Castellan axe"]);
    // Two ranged profiles with their own names keep them.
    expect(labels([pistol], "ranged")).toEqual(pistol.profiles.filter((p) => p.range !== "Melee").map((p) => `${pistol.name} — ${p.name}`));
  });
});

describe("editing a weapon count", () => {
  it("moves to the nearest legal loadout, handing back the weapons a swap replaces", () => {
    const loadout = memberLoadout(ds, ds.units.getInFaction("allarus-custodians", "adeptus-custodes")!.raw, 3);
    const axes = editedCounts(loadout, loadout.counts, "castellan-axe", 3);
    expect(axes.get("castellan-axe")).toBe(3);
    expect(axes.get("guardian-spear-allarus-custodians") ?? 0).toBe(0);
    expect(axes.get("balistus-grenade-launcher")).toBe(3);
    expect(loadout.rules.check(3, axes)).toEqual([]);
    // Back to spears restores the base loadout.
    expect([...editedCounts(loadout, axes, "castellan-axe", 0)].sort()).toEqual([...loadout.counts].sort());
  });
});

describe("default weapon counts", () => {
  it("seed five Legionaries with a legal loadout", () => {
    // Taking every option at full cap would hand out four special weapons against an allowance of one.
    const { loadout, counts } = member("legionaries");
    expect(loadout.modelCount).toBe(5);
    const selection = selectLines({ ds, members: [{ memberId: "legionaries", loadout, counts }], target, buffs: [], context: { phase: "shooting" } });
    expect(selection.violations.get("legionaries")).toBeUndefined();
  });

  it("size a unit inside its datasheet range, with the base loadout for that size", () => {
    const allarus = ds.units.getInFaction("allarus-custodians", "adeptus-custodes")!.raw;
    expect(memberLoadout(ds, allarus, 3).modelCount).toBe(3);
    expect(memberLoadout(ds, allarus, 3).counts.get("guardian-spear-allarus-custodians")).toBe(3);
    expect(memberLoadout(ds, allarus, 10).modelCount).toBe(3);
    expect(memberLoadout(ds, allarus, 0).modelCount).toBe(2);
  });

  it("keep wargear that has no weapon line, so the default is legal wherever the base loadout is", () => {
    const illegal: string[] = [];
    for (const unit of ds.units) {
      const loadout = memberLoadout(ds, unit.raw);
      const legal = (counts: Map<string, number>) =>
        validateCandidateLoadout({ unit: unit.raw, modelCount: loadout.modelCount, counts, loadout: loadout.rules }).legal;
      if (!legal(loadout.counts)) continue;
      const counts = memberCounts(loadout, unit.weapons.map((w) => w.id), (weaponId) => defaultWeaponCount(loadout, weaponId));
      if (!legal(counts)) illegal.push(`${unit.raw.faction_id}/${unit.id}`);
    }
    expect(illegal).toEqual([]);
  });
});
