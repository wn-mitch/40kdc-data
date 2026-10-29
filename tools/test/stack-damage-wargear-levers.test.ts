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

describe("an attached unit's wargear (core rule 19.01)", () => {
  // A fabricated rule on the Shield-Captain: while leading, +1 to Wound for the unit while it
  // carries a praesidium shield (Hit rolls of 2+ cannot improve). The Captain's out-of-the-box loadout has one and the Custodian
  // Guard's does not; the attached unit is one unit, so the Guard's attacks gain it too.
  const ruleId = "fix-shield-uplink-adeptus-custodes";
  const fixture = new Dataset({
    ...RAW_DATA,
    abilities: [...RAW_DATA.abilities, {
      ability_id: ruleId,
      name: "Fixture Shield Uplink",
      authored_by: "40kdc-community",
      faction_id: "adeptus-custodes",
      game_version: { edition: "11th", dataslate: "test" },
      ability_type: "unit",
      behavior: "passive",
      scope: { duration: "permanent" },
      unit_ids: ["shield-captain"],
      effect: {
        type: "conditional",
        condition: { operator: "and", operands: [
          { type: "attachment", parameters: { subject: "this-model", role: "leading" } },
          { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "praesidium-shield" } },
        ] },
        effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } },
      },
    }] as never,
    units: RAW_DATA.units.map((unit) => unit.id === "shield-captain" && unit.faction_id === "adeptus-custodes"
      ? { ...unit, ability_ids: [...(unit.ability_ids ?? []), ruleId] }
      : unit) as never,
  });

  it("gives every member a rule gated on wargear one member carries", () => {
    const { faction, session: cell } = session(fixture, "adeptus-custodes", resolveTarget(fixture, fixture.targetProfiles.get("meq-intercessors")!)!);
    const guard = { unit: unitInFaction(faction, "custodian-guard-sodality")!, role: "bodyguard" as const };
    const captain = { unit: unitInFaction(faction, "shield-captain")!, role: "leader" as const };
    const spec = emptySpec("adeptus-custodes", [guard, captain]);
    const baseOf = (member: typeof guard | typeof captain) =>
      cell.loadoutSpace(member.unit, cell.memberBuffs(spec, member), cell.state.contextFor(spec, member)).scaffold.base;
    const guardBase = baseOf(guard);
    const captainBase = baseOf(captain);
    expect(guardBase.get("praesidium-shield") ?? 0).toBe(0);
    expect(captainBase.get("praesidium-shield")).toBe(1);

    // The Guard's own loadout lacks the shield; the Captain's carries it for the whole unit.
    expect(fromAbility(cell.memberBuffs(spec, guard, guardBase), ruleId)).toEqual([{ type: "wound-mod", value: 1 }]);
    expect(fromAbility(cell.memberBuffs(spec, captain, captainBase), ruleId)).toEqual([{ type: "wound-mod", value: 1 }]);
    // With the Captain's chosen loadout leaving it out, neither member gains it.
    const unshielded = new Map([...captainBase, ["praesidium-shield", 0]]);
    const chosen = new Map([[guard.unit.id, guardBase], [captain.unit.id, unshielded]]);
    expect(fromAbility(cell.memberBuffs(spec, guard, guardBase, chosen), ruleId)).toEqual([]);

    // The Guard is scored per loadout, its buffs following the Captain's chosen shield.
    const perLoadout = cell.perLoadoutBuffs(spec, guard)!;
    expect(perLoadout.key).not.toBe(cell.perLoadoutBuffs(spec, guard, chosen)!.key);
    const result = cell.scoreStack(spec);
    const scoredGuard = result.members.find(({ member }) => member === guard)!;
    const plain = cell.loadoutSpace(guard.unit, cell.memberBuffs(spec, guard), cell.state.contextFor(spec, guard));
    expect(scoredGuard.loadout.total).toBeGreaterThan(plain.score(scoredGuard.loadout.counts).total);
  });

  it("reads a Commander's Marker Drone as its Crisis Suits' (the Drones rule)", () => {
    const guardsmen = resolveTarget(real, real.targetProfiles.get("geq-guardsmen")!)!;
    const { faction, session: cell } = session(real, "tau-empire", guardsmen);
    const crisis = { unit: unitInFaction(faction, "crisis-fireknife-battlesuits")!, role: "bodyguard" as const };
    const commander = { unit: unitInFaction(faction, "commander-in-coldstar-battlesuit")!, role: "leader" as const };
    expect(real.leadersAttachableTo(crisis.unit.id).map((unit) => unit.id)).toContain(commander.unit.id);
    const spec = emptySpec("tau-empire", [crisis, commander]);
    const crisisBase = cell.loadoutSpace(crisis.unit, cell.memberBuffs(spec, crisis), cell.state.contextFor(spec, crisis)).scaffold.base;
    expect(crisisBase.get("marker-drone") ?? 0).toBe(0);
    const drones = real.abilities.getInFaction("drones-tau-empire", "tau-empire")!;
    const source = { kind: "ability" as const, abilityId: drones.id, abilityKind: "army" as const };
    const crisisReads = (commanderCounts: Map<string, number>) => {
      const chosen = new Map([[crisis.unit.id, crisisBase], [commander.unit.id, commanderCounts]]);
      const context = cell.stackContext(spec, cell.state.contextFor(spec, crisis), chosen);
      return { wargear: context.attackerWargear, reasons: drones.describeBuffs(source, context, "attacker").unsupported.map((fragment) => fragment.reason) };
    };

    const marked = crisisReads(new Map([["marker-drone", 1]]));
    expect(marked.wargear).toEqual({ "marker-drone": 1 });
    // MARKERLIGHT and the observe permission reach the Crisis Suits, though only the Commander carries the drone.
    expect(marked.reasons).toEqual(expect.arrayContaining([
      'effect type "keyword-grant" is not modelled by the buff layer',
      'effect type "permission" is not modelled by the buff layer',
    ]));
    const unmarked = crisisReads(new Map());
    expect(unmarked.wargear).toEqual({});
    expect(unmarked.reasons).not.toContain('effect type "keyword-grant" is not modelled by the buff layer');
  });
});
