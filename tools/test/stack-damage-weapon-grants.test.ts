import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import type { Buff, EngineContext } from "../src/cruncher/index.js";
import { Dataset } from "../src/data/dataset.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext, unitInFaction } from "../src/stack-damage/factions.js";
import { damageScoringSession, emptySpec } from "../src/stack-damage/search.js";
import { unitLoadoutDamage } from "../src/stack-damage/unit-damage.js";
import {
  groupsWithGrantedWeapons,
  loadoutWargear,
  unitWeaponGrants,
  withGrantedWeapons,
} from "../src/stack-damage/weapon-grants.js";

const dataset = Dataset.embedded();
const crisis = dataset.units.getInFaction("crisis-fireknife-battlesuits", "tau-empire")!.raw;
const guardsmen = resolveTarget(dataset, dataset.targetProfiles.get("geq-guardsmen")!)!;
const shooting: EngineContext = { phase: "shooting", armyFaction: "tau-empire" };
const base = new Map([["missile-pod", 6], ["battlesuit-fists", 3]]);
const withDrones = new Map([...base, ["gun-drone", 2]]);

describe("loadout wargear", () => {
  it("counts wargear records and leaves the unit's weapons out", () => {
    expect(loadoutWargear(dataset, crisis, withDrones)).toEqual({ "gun-drone": 2 });
    expect(loadoutWargear(dataset, crisis, base)).toEqual({});
  });
});

describe("unit weapon grants", () => {
  it("equips each gun drone carrier once, from the drone's own rule", () => {
    const grants = unitWeaponGrants(dataset, crisis, "tau-empire", { ...shooting, attackerWargear: { "gun-drone": 2 } });
    const carbines = grants.grants.filter((grant) => grant.wargearId === "gun-drone");
    expect(carbines).toEqual([{ abilityId: "gun-drone-tau-empire", wargearId: "gun-drone", weaponId: "twin-pulse-carbine-drone", perBearer: 1 }]);
    // The Drones army rules also grant for the gun drone; the drone's own rule owns its weapons.
    expect(grants.duplicates.filter((duplicate) => duplicate.wargearId === "gun-drone").map((duplicate) => duplicate.abilityId).sort())
      .toEqual(["drones-sudden-dawn-cadre-tau-empire", "drones-tau-empire"]);
    expect(grants.duplicates.every((duplicate) => duplicate.ownerAbilityId === "gun-drone-tau-empire")).toBe(true);
    expect(withGrantedWeapons(withDrones, grants.grants).get("twin-pulse-carbine-drone")).toBe(2);
  });

  it("grants nothing when the loadout takes no drone", () => {
    const grants = unitWeaponGrants(dataset, crisis, "tau-empire", { ...shooting, attackerWargear: {} });
    // The gun drone's printed rule drops out with the drone; the army rules' conditions are false.
    expect([...grants.grants, ...grants.duplicates]).toEqual([]);
    expect(withGrantedWeapons(base, grants.grants)).toEqual(base);
  });

  it("lets an army rule own an item no printed rule grants for", () => {
    // A unit that lists no printed drone rules: the lowest ability id owns the gated grants.
    const bare = { ...crisis, ability_ids: (crisis.ability_ids ?? []).filter((ref) => typeof ref === "string") };
    const grants = unitWeaponGrants(dataset, bare, "tau-empire", { ...shooting, attackerWargear: { "gun-drone": 1 } });
    expect(grants.grants.filter((grant) => grant.wargearId === "gun-drone").map((grant) => grant.abilityId)).toEqual(["drones-sudden-dawn-cadre-tau-empire"]);
    expect(grants.duplicates.map((duplicate) => [duplicate.abilityId, duplicate.ownerAbilityId])).toEqual([["drones-tau-empire", "drones-sudden-dawn-cadre-tau-empire"]]);
  });

  it("adds granted weapons only to the groups whose models carry the wargear", () => {
    const groups = [
      { count: 2, weapons: [{ id: "missile-pod", count: 2 }, { id: "gun-drone", count: 1 }] },
      { count: 1, weapons: [{ id: "missile-pod", count: 2 }] },
    ];
    const grant = { abilityId: "gun-drone-tau-empire", wargearId: "gun-drone", weaponId: "twin-pulse-carbine-drone", perBearer: 1 };
    expect(groupsWithGrantedWeapons(groups, [grant]).map((group) => group.weapons)).toEqual([
      [{ id: "missile-pod", count: 2 }, { id: "gun-drone", count: 1 }, { id: "twin-pulse-carbine-drone", count: 1 }],
      [{ id: "missile-pod", count: 2 }],
    ]);
  });

  it("fires a granted weapon in the loadout's damage", () => {
    const grants = unitWeaponGrants(dataset, crisis, "tau-empire", { ...shooting, attackerWargear: { "gun-drone": 2 } }).grants;
    const input = { dataset, unit: crisis, modelCount: 3, target: { unit: guardsmen.unitRaw, modelCount: guardsmen.modelCount }, buffs: [], context: shooting, groups: null };
    const without = unitLoadoutDamage({ ...input, counts: withDrones });
    const scored = unitLoadoutDamage({ ...input, counts: withDrones, grants });
    const carbine = scored.selected.find((weapon) => weapon.weaponId === "twin-pulse-carbine-drone");
    expect(without.selected.some((weapon) => weapon.weaponId === "twin-pulse-carbine-drone")).toBe(false);
    expect(carbine?.count).toBe(2);
    expect(scored.total).toBeCloseTo(without.total + carbine!.damage, 9);
  });
});

describe("printed wargear rules in scoring", () => {
  it("drops a printed rule's buffs when the loadout leaves its item out", () => {
    const config = parseMatrixConfig({ HC_FACTIONS: "tau-empire", HC_TARGETS: "geq-guardsmen", HC_PHASES: "shooting", HC_OUTPUT: "grants.json" },
      { factionIds: new Set(["tau-empire"]), targetIds: ["geq-guardsmen"] });
    const faction = resolveFactionContext(dataset, "tau-empire");
    const session = damageScoringSession({ dataset, config, faction, target: guardsmen, phase: "shooting" });
    const broadside = unitInFaction(faction, "broadside-battlesuits")!;
    const context = session.state.contextFor(emptySpec("tau-empire", [{ unit: broadside, role: "bodyguard" }]), { unit: broadside, role: "bodyguard" });
    const buff: Buff = {
      source: { kind: "ability", abilityId: "weapon-support-system-tau-empire", abilityKind: "unit" },
      contribution: { type: "reroll", roll: "hit", subset: "ones" },
    };
    const plain = session.loadoutSpace(broadside, [], context);
    const buffed = session.loadoutSpace(broadside, [buff], context);
    const without = plain.scaffold.base;
    const withSystem = new Map([...without, ["weapon-support-system", 1]]);
    expect(buffed.score(without).total).toBeCloseTo(plain.score(without).total, 9);
    expect(buffed.score(withSystem).total).toBeGreaterThan(plain.score(withSystem).total);
  });
});
