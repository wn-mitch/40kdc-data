import { describe, expect, it } from "vitest";

import { resolveTarget, type ResolvedTarget } from "../src/compare.js";
import type { Buff } from "../src/cruncher/index.js";
import { RAW_DATA } from "../src/data/bundle.generated.js";
import { Dataset } from "../src/data/dataset.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext, unitInFaction } from "../src/stack-damage/factions.js";
import { damageScoringSession, emptySpec } from "../src/stack-damage/search.js";

const real = Dataset.embedded();

function session(dataset: Dataset, factionId: string, target: ResolvedTarget, targetWargear?: Record<string, number>) {
  const config = parseMatrixConfig(
    { HC_FACTIONS: factionId, HC_TARGETS: "geq-guardsmen", HC_PHASES: "shooting", HC_OUTPUT: "wargear-levers.json" },
    { factionIds: new Set([factionId]), targetIds: ["geq-guardsmen"] },
  );
  const faction = resolveFactionContext(dataset, factionId);
  return { faction, session: damageScoringSession({ dataset, config, faction, target, phase: "shooting", ...(targetWargear ? { targetWargear } : {}) }) };
}

const fromAbility = (buffs: readonly Buff[], abilityId: string) =>
  buffs.filter((buff) => buff.source.kind === "ability" && buff.source.abilityId === abilityId).map((buff) => buff.contribution);

describe("the target's wargear", () => {
  const strikeTeam: ResolvedTarget = {
    profileId: "test-strike-team",
    profileName: "Strike Team",
    unitRaw: real.units.getInFaction("strike-team", "tau-empire")!.raw,
    modelCount: 10,
  };

  it("gives a target carrying a Guardian Drone the Drones rule's Wound roll penalty", () => {
    const guarded = session(real, "adeptus-mechanicus", strikeTeam, { "guardian-drone": 1 });
    const bare = session(real, "adeptus-mechanicus", strikeTeam);
    expect(fromAbility(guarded.session.defensiveBuffs, "drones-tau-empire")).toEqual([{ type: "wound-mod", value: -1 }]);
    // The Strike Team's out-of-the-box loadout carries no drone.
    expect(fromAbility(bare.session.defensiveBuffs, "drones-tau-empire")).toEqual([]);

    const rangers = unitInFaction(guarded.faction, "skitarii-rangers")!;
    const member = { unit: rangers, role: "bodyguard" as const };
    const score = (cell: ReturnType<typeof session>) => cell.session.scoreStack(emptySpec("adeptus-mechanicus", [member])).total;
    expect(score(guarded)).toBeLessThan(score(bare));
  });
});

describe("the attacker's wargear", () => {
  // A fabricated rule on the Crisis Fireknife team: +1 to Hit while the unit carries a gun drone.
  const uplinkId = "fix-drone-uplink-tau-empire";
  const fixture = new Dataset({
    ...RAW_DATA,
    abilities: [...RAW_DATA.abilities, {
      ability_id: uplinkId,
      name: "Fixture Drone Uplink",
      authored_by: "40kdc-community",
      faction_id: "tau-empire",
      game_version: { edition: "11th", dataslate: "test" },
      ability_type: "unit",
      behavior: "passive",
      scope: { duration: "permanent" },
      unit_ids: ["crisis-fireknife-battlesuits"],
      effect: {
        type: "conditional",
        condition: { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "gun-drone" } },
        effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
      },
    }] as never,
    units: RAW_DATA.units.map((unit) => unit.id === "crisis-fireknife-battlesuits" && unit.faction_id === "tau-empire"
      ? { ...unit, ability_ids: [...(unit.ability_ids ?? []), uplinkId] }
      : unit) as never,
  });
  const guardsmen = resolveTarget(fixture, fixture.targetProfiles.get("geq-guardsmen")!)!;

  it("translates a wargear-gated rule under each loadout it scores", () => {
    const { faction, session: cell } = session(fixture, "tau-empire", guardsmen);
    const crisis = unitInFaction(faction, "crisis-fireknife-battlesuits")!;
    const member = { unit: crisis, role: "bodyguard" as const };
    const spec = emptySpec("tau-empire", [member]);
    const context = cell.state.contextFor(spec, member);
    const base = cell.loadoutSpace(crisis, cell.memberBuffs(spec, member), context).scaffold.base;
    const withDrones = new Map([...base, ["gun-drone", 2]]);

    expect(fromAbility(cell.memberBuffs(spec, member, withDrones), uplinkId)).toEqual([{ type: "hit-mod", value: 1 }]);
    expect(fromAbility(cell.memberBuffs(spec, member, base), uplinkId)).toEqual([]);

    // Scored through the loadout search's path, the drone loadout gains the +1 to Hit.
    const perLoadout = cell.perLoadoutBuffs(spec, member)!;
    const space = cell.loadoutSpace(crisis, cell.memberBuffs(spec, member), context, perLoadout);
    const plain = cell.loadoutSpace(crisis, cell.memberBuffs(spec, member), context);
    expect(space.score(base).total).toBeCloseTo(plain.score(base).total, 9);
    expect(space.score(withDrones).total).toBeGreaterThan(plain.score(withDrones).total);

    // The report and ledger read the rule as applied with the loadout that surfaces it.
    const reported = (counts: Map<string, number>) => cell.selectedPoolLevers({ spec, total: 0, members: [{ member, loadout: space.score(counts) }] })
      .filter((lever) => lever.source.kind === "ability" && lever.source.abilityId === uplinkId);
    expect(reported(withDrones).map((lever) => lever.perMember.get(crisis.id))).toEqual([[expect.objectContaining({ contribution: { type: "hit-mod", value: 1 } })]]);
    expect(reported(base)).toEqual([]);
  });

  it("leaves a member whose rules never read wargear on the loadout-free path", () => {
    const { faction, session: cell } = session(real, "adeptus-mechanicus", guardsmen);
    const member = { unit: unitInFaction(faction, "skitarii-rangers")!, role: "bodyguard" as const };
    expect(cell.perLoadoutBuffs(emptySpec("adeptus-mechanicus", [member]), member)).toBeUndefined();
  });
});
