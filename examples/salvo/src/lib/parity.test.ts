/**
 * Salvo's projection against the damage matrix: the same unit, levers, loadout, target and
 * scenario must score the same total, fire the same lines and attribute the same lifts.
 */
import { describe, expect, it } from "vitest";
import { Dataset, resolveTarget, type AttributedStage, type Buff, type ResolvedTarget, type StageLift } from "@alpaca-software/40kdc-data";

// The matrix session and the raw bundle are not part of the package's public surface; the test reads them from the build.
import { RAW_DATA } from "../../../../tools/dist/data/bundle.generated.js";
import { parseMatrixConfig } from "../../../../tools/dist/stack-damage/config.js";
import { resolveFactionContext } from "../../../../tools/dist/stack-damage/factions.js";
import { damageScoringSession, legalDetachmentSpec } from "../../../../tools/dist/stack-damage/search.js";
import { supportProviders } from "./defender.js";
import { crunchLine, enabledLeverBuffs, memberLevers, memberUnits, memberWargear, targetDefences, unionLevers } from "./output-model.js";
import { srcKey, stageOf } from "./projection-model.js";
import { lineId, selectLines, weaponLines } from "./weapon-lines.js";

const real = Dataset.embedded();
const noBuild = { detachmentId: null, stratagemIds: [], enhancementId: null };

function lifts(values: readonly StageLift[]): Record<string, number> {
  return Object.fromEntries(values.map((lift) => [srcKey(lift.source), lift.delta]));
}

/**
 * The matrix's best lever set for a unit (with any attached members) in one detachment, each
 * member scored with its `counts` by both tools. The first member is the one Salvo selects.
 */
function scoreBoth(input: {
  ds?: Dataset;
  factionId: string;
  unitId: string;
  /** Attached units, with the role each plays in the matrix's stack. */
  attached?: { unitId: string; role: "leader" | "bodyguard" }[];
  detachmentId: string;
  targetId: string;
  /** A target outside the target profiles, with its wargear. */
  target?: { target: ResolvedTarget; wargear: Record<string, number> };
  counts?: (base: Map<string, number>) => Map<string, number>;
}) {
  const ds = input.ds ?? real;
  const faction = resolveFactionContext(ds, input.factionId);
  const target = input.target?.target ?? resolveTarget(ds, ds.targetProfiles.get(input.targetId)!)!;
  const config = parseMatrixConfig(
    { HC_FACTIONS: input.factionId, HC_TARGETS: input.targetId, HC_PHASES: "shooting", HC_OUTPUT: "salvo-parity.json" },
    { factionIds: new Set([input.factionId]), targetIds: [input.targetId] },
  );
  const session = damageScoringSession({ dataset: ds, config, faction, target, phase: "shooting", ...(input.target ? { targetWargear: input.target.wargear } : {}) });
  const unitOf = (unitId: string) => faction.units.find((candidate) => candidate.id === unitId)!;
  const attached = input.attached ?? [];
  const selectedRole: "leader" | "bodyguard" = attached.some((member) => member.role === "leader") || attached.length === 0 ? "bodyguard" : "leader";
  const stackMembers = [{ unit: unitOf(input.unitId), role: selectedRole }, ...attached.map((member) => ({ unit: unitOf(member.unitId), role: member.role }))];
  const spec = legalDetachmentSpec(session, input.factionId, stackMembers, [ds.detachments.getAny(input.detachmentId)!])!;
  const best = session.optimiseLevers(spec);
  const scored = best.members.map((stackMember) => {
    const context = session.state.contextFor(best.spec, stackMember.member);
    const counts = input.counts ? input.counts(new Map(stackMember.loadout.counts)) : new Map(stackMember.loadout.counts);
    const space = session.loadoutSpace(stackMember.member.unit, session.memberBuffs(best.spec, stackMember.member), context, session.perLoadoutBuffs(best.spec, stackMember.member));
    return { stackMember, context, counts, matrix: space.score(counts) };
  });
  // The selected levers, with any the scored loadouts' wargear alone surfaces.
  const selectedIds = session.selectedPoolLevers({ ...best, members: scored.map(({ stackMember, matrix }) => ({ member: stackMember.member, loadout: matrix })) }).map((lever) => lever.id);

  // Salvo, given the same choices, reading each member under its own context.
  const memberIds = [input.unitId, ...attached.map((member) => member.unitId)];
  const baseContext = session.state.contextFor(best.spec);
  const perMember = memberLevers(ds, {
    unitId: input.unitId,
    factionId: input.factionId,
    detachmentId: input.detachmentId,
    attachedUnitIds: attached.map((member) => member.unitId),
    supportUnitIds: supportProviders(ds, input.factionId, memberIds).map((provider) => provider.id),
  }, baseContext);
  const levers = unionLevers(perMember);
  const selected = new Set(selectedIds);
  expect(selectedIds.filter((id) => !levers.buffs.some((lever) => lever.id === id))).toEqual([]);
  const defences = targetDefences(ds, target.unitRaw.id, { ...noBuild, wargear: input.target?.wargear ?? null }, baseContext).buffs;
  const salvoTarget = { unit: target.unitRaw, modelCount: target.modelCount };
  const members = memberUnits(ds, input.factionId, memberIds).map((member, index) => {
    const own = perMember.find((entry) => entry.memberId === member.memberId)!;
    const buffs = [...enabledLeverBuffs(own.levers.buffs, (lever) => selected.has(lever.id)), ...defences];
    const counts = scored.find(({ stackMember }) => stackMember.member.unit.id === member.memberId)!.counts;
    const wargear = memberWargear({ ds, factionId: input.factionId, member, counts, buffs, context: own.context });
    expect(wargear.error).toBeUndefined();
    return { member, index, counts, wargear, context: own.context };
  });
  const selection = selectLines({
    ds,
    members: members.map(({ member, counts, wargear, context }) => ({ memberId: member.memberId, loadout: member.loadout, counts, grants: wargear.grants, buffs: wargear.buffs, context })),
    target: salvoTarget,
    buffs: [],
    context: baseContext,
  });
  const lines = weaponLines(
    members.map(({ member, wargear }) => ({ memberId: member.memberId, name: member.unit.name, weapons: [...member.unit.weapons.map((weapon) => weapon.raw), ...wargear.granted] })),
    "ranged",
  );
  const first = members[0]!;
  const firstScored = scored.find(({ stackMember }) => stackMember.member.unit.id === input.unitId)!;
  return {
    ds, session, best, salvoTarget, selection, lines, scored, members, perMember,
    // The selected unit's view, for the single-member cases.
    stackMember: firstScored.stackMember, counts: firstScored.counts, matrix: firstScored.matrix,
    member: first.member, wargear: first.wargear, buffs: first.wargear.buffs, context: first.context,
    matrixTotal: scored.reduce((sum, { matrix }) => sum + matrix.total, 0),
  };
}

describe("Salvo and the damage matrix", () => {
  it("score a drone-carrying loadout the same, firing the granted carbines", () => {
    const run = scoreBoth({
      factionId: "tau-empire",
      unitId: "crisis-fireknife-battlesuits",
      detachmentId: "montka",
      targetId: "geq-guardsmen",
      counts: (base) => new Map([...base, ["gun-drone", 2]]),
    });
    const carbine = run.matrix.selectedWeapons.find((weapon) => weapon.weaponId === "twin-pulse-carbine-drone");
    expect(carbine?.count).toBe(2);
    expect(run.wargear.granted.map((weapon) => weapon.id)).toContain("twin-pulse-carbine-drone");
    expect(run.selection.total).toBeCloseTo(run.matrix.total, 9);
    const matrixFiring = new Map(run.matrix.selectedWeapons.map((weapon) => [lineId(run.member.memberId, weapon.weaponId, weapon.profileIndex), weapon.count]));
    expect(run.selection.firing).toEqual(matrixFiring);
    // Every fired line, the granted one included, has a line Salvo can show.
    for (const id of run.selection.firing.keys()) expect(run.lines.some((line) => line.id === id)).toBe(true);
  });

  it("attribute each fired line's damage the same", () => {
    const run = scoreBoth({ factionId: "tau-empire", unitId: "crisis-fireknife-battlesuits", detachmentId: "montka", targetId: "geq-guardsmen" });
    expect(run.selection.total).toBeCloseTo(run.stackMember.loadout.total, 9);
    expect(run.matrix.selectedWeapons.length).toBeGreaterThan(0);
    let lifted = 0;
    for (const weapon of run.matrix.selectedWeapons) {
      const expected = run.session.attributeWeapon(run.best.spec, run.stackMember.member, weapon, run.counts)!;
      const line = run.lines.find((candidate) => candidate.id === lineId(run.member.memberId, weapon.weaponId, weapon.profileIndex))!;
      const result = crunchLine({ ds: run.ds, line, owner: run.member.unit.raw, models: weapon.count, target: run.salvoTarget, buffs: run.buffs, context: run.context });
      expect(result.error).toBeUndefined();
      const stage = stageOf(result.attributed, "after-fnp") as AttributedStage;
      expect(stage.expected).toBeCloseTo(weapon.damage, 9);
      expect(stage.baseline).toBeCloseTo(expected.baseline, 9);
      expect(stage.residual).toBeCloseTo(expected.residual, 9);
      const salvoLifts = lifts(stage.lifts);
      const matrixLifts = lifts(expected.lifts);
      expect(Object.keys(salvoLifts).sort()).toEqual(Object.keys(matrixLifts).sort());
      for (const [key, delta] of Object.entries(matrixLifts)) expect(salvoLifts[key]).toBeCloseTo(delta, 9);
      lifted += Object.keys(matrixLifts).length;
    }
    // The case only pins attribution if some lever lifts the damage.
    expect(lifted).toBeGreaterThan(0);
  });

  it("read a target's wargear the same", () => {
    const strikeTeam = { profileId: "test-strike-team", profileName: "Strike Team", unitRaw: real.units.getInFaction("strike-team", "tau-empire")!.raw, modelCount: 10 };
    const run = (wargear: Record<string, number>) => scoreBoth({
      factionId: "adeptus-mechanicus", unitId: "skitarii-rangers", detachmentId: "eradication-cohort", targetId: "geq-guardsmen",
      target: { target: strikeTeam, wargear },
    });
    const guarded = run({ "guardian-drone": 1 });
    const bare = run({});
    expect(fromAbility(guarded.session.defensiveBuffs, "drones-tau-empire")).toEqual([{ type: "wound-mod", value: -1 }]);
    expect(guarded.selection.total).toBeCloseTo(guarded.matrix.total, 9);
    expect(bare.selection.total).toBeCloseTo(bare.matrix.total, 9);
    expect(guarded.matrix.total).toBeLessThan(bare.matrix.total);
  });

  it("read a rule gated on the attacker's wargear the same", () => {
    // A fabricated rule on The Twin Lance: +1 to Hit while the unit carries its MV15 gun drones,
    // which its out-of-the-box loadout does.
    const uplinkId = "fix-drone-uplink-tau-empire";
    const fixture = new Dataset({
      ...RAW_DATA,
      abilities: [...RAW_DATA.abilities, {
        ability_id: uplinkId, name: "Fixture Drone Uplink", authored_by: "40kdc-community", faction_id: "tau-empire",
        game_version: { edition: "11th", dataslate: "test" }, ability_type: "unit", behavior: "passive",
        scope: { duration: "permanent" }, unit_ids: ["the-twin-lance"],
        effect: {
          type: "conditional",
          condition: { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "mv15-gun-drone" } },
          effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
        },
      }] as never,
      units: RAW_DATA.units.map((unit) => unit.id === "the-twin-lance" ? { ...unit, ability_ids: [...(unit.ability_ids ?? []), uplinkId] } : unit) as never,
    });
    const run = scoreBoth({ ds: fixture, factionId: "tau-empire", unitId: "the-twin-lance", detachmentId: "montka", targetId: "geq-guardsmen" });
    expect(fromAbility(run.buffs, uplinkId)).toEqual([{ type: "hit-mod", value: 1 }]);
    expect(fromAbility(run.session.memberBuffs(run.best.spec, run.stackMember.member, run.counts), uplinkId)).toEqual([{ type: "hit-mod", value: 1 }]);
    expect(run.selection.total).toBeCloseTo(run.matrix.total, 9);
  });

  it("score a leader and its bodyguard each as itself", () => {
    const run = scoreBoth({
      factionId: "world-eaters",
      unitId: "khorne-berzerkers",
      attached: [{ unitId: "kharn-the-betrayer", role: "leader" }],
      detachmentId: "berzerker-warband",
      targetId: "meq-intercessors",
    });
    expect(run.scored).toHaveLength(2);
    expect(run.selection.total).toBeCloseTo(run.matrixTotal, 9);
    for (const { stackMember, matrix } of run.scored) {
      const expected = new Map(matrix.selectedWeapons.map((weapon) => [lineId(stackMember.member.unit.id, weapon.weaponId, weapon.profileIndex), weapon.count]));
      const fired = new Map([...run.selection.firing].filter(([id]) => id.startsWith(`${stackMember.member.unit.id}:`)));
      expect(fired).toEqual(expected);
    }
    // Each member reads its own role and wargear, not the combined unit's.
    expect(run.members.map(({ context }) => [context.attackerUnitId, context.attackerAttachmentRole])).toEqual([
      ["khorne-berzerkers", "bodyguard"],
      ["kharn-the-betrayer", "leader"],
    ]);
  });

  it("read each attached member's own wargear", () => {
    // A fabricated rule on the Shield-Captain: while leading, +1 to Hit for the unit while it
    // carries a praesidium shield. The Captain's out-of-the-box loadout has one and the Custodian
    // Guard's does not; the matrix reads each member's own, so only the Captain's attacks gain it.
    const ruleId = "fix-shield-uplink-adeptus-custodes";
    const fixture = new Dataset({
      ...RAW_DATA,
      abilities: [...RAW_DATA.abilities, {
        ability_id: ruleId, name: "Fixture Shield Uplink", authored_by: "40kdc-community", faction_id: "adeptus-custodes",
        game_version: { edition: "11th", dataslate: "test" }, ability_type: "unit", behavior: "passive",
        scope: { duration: "permanent" }, unit_ids: ["shield-captain"],
        effect: {
          type: "conditional",
          condition: { operator: "and", operands: [
            { type: "attachment", parameters: { subject: "this-model", role: "leading" } },
            { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "praesidium-shield" } },
          ] },
          effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
        },
      }] as never,
      units: RAW_DATA.units.map((unit) => unit.id === "shield-captain" && unit.faction_id === "adeptus-custodes"
        ? { ...unit, ability_ids: [...(unit.ability_ids ?? []), ruleId] }
        : unit) as never,
    });
    const run = scoreBoth({
      ds: fixture,
      factionId: "adeptus-custodes",
      unitId: "custodian-guard-sodality",
      attached: [{ unitId: "shield-captain", role: "leader" }],
      detachmentId: fixture.detachments.byFaction("adeptus-custodes")[0]!.id,
      targetId: "meq-intercessors",
    });
    const levers = (memberId: string) => run.perMember.find((entry) => entry.memberId === memberId)!.levers.buffs
      .filter((lever) => lever.source.kind === "ability" && lever.source.abilityId === ruleId).flatMap((lever) => lever.buffs.map((buff) => buff.contribution));
    expect(levers("shield-captain")).toEqual([{ type: "hit-mod", value: 1 }]);
    expect(levers("custodian-guard-sodality")).toEqual([]);
    expect(run.selection.total).toBeCloseTo(run.matrixTotal, 9);
  });
});

function fromAbility(buffs: readonly Buff[], abilityId: string) {
  return buffs.filter((buff) => buff.source.kind === "ability" && buff.source.abilityId === abilityId).map((buff) => buff.contribution);
}
