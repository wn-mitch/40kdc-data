/**
 * Salvo's projection against the damage matrix: the same unit, levers, loadout, target and
 * scenario must score the same total, fire the same lines and attribute the same lifts.
 */
import { describe, expect, it } from "vitest";
import { Dataset, resolveTarget, type AttributedStage, type StageLift } from "@alpaca-software/40kdc-data";

// The matrix session is not part of the package's public surface; the test reads it from the build.
import { parseMatrixConfig } from "../../../../tools/dist/stack-damage/config.js";
import { resolveFactionContext } from "../../../../tools/dist/stack-damage/factions.js";
import { damageScoringSession, legalDetachmentSpec } from "../../../../tools/dist/stack-damage/search.js";
import { supportProviders } from "./defender.js";
import { attackerLevers, crunchLine, enabledLeverBuffs, memberUnits, memberWargear, targetDefences } from "./output-model.js";
import { srcKey, stageOf } from "./projection-model.js";
import { lineId, selectLines, weaponLines } from "./weapon-lines.js";

const ds = Dataset.embedded();
const noBuild = { detachmentId: null, stratagemIds: [], enhancementId: null };

function lifts(values: readonly StageLift[]): Record<string, number> {
  return Object.fromEntries(values.map((lift) => [srcKey(lift.source), lift.delta]));
}

/** The matrix's best lever set for one unit in one detachment, scored with `counts` by both tools. */
function scoreBoth(input: { factionId: string; unitId: string; detachmentId: string; targetId: string; counts?: (base: Map<string, number>) => Map<string, number> }) {
  const faction = resolveFactionContext(ds, input.factionId);
  const target = resolveTarget(ds, ds.targetProfiles.get(input.targetId)!)!;
  const config = parseMatrixConfig(
    { HC_FACTIONS: input.factionId, HC_TARGETS: input.targetId, HC_PHASES: "shooting", HC_OUTPUT: "salvo-parity.json" },
    { factionIds: new Set([input.factionId]), targetIds: [input.targetId] },
  );
  const session = damageScoringSession({ dataset: ds, config, faction, target, phase: "shooting" });
  const unit = faction.units.find((candidate) => candidate.id === input.unitId)!;
  const spec = legalDetachmentSpec(session, input.factionId, [{ unit, role: "bodyguard" }], [ds.detachments.getAny(input.detachmentId)!])!;
  const best = session.optimiseLevers(spec);
  const stackMember = best.members[0]!;
  const context = session.state.contextFor(best.spec, stackMember.member);
  const counts = input.counts ? input.counts(new Map(stackMember.loadout.counts)) : new Map(stackMember.loadout.counts);
  const matrix = session.loadoutSpace(unit, session.memberBuffs(best.spec, stackMember.member), context).score(counts);

  // Salvo, given the same choices.
  const [member] = memberUnits(ds, input.factionId, [input.unitId]);
  const levers = attackerLevers(ds, {
    unitId: input.unitId,
    factionId: input.factionId,
    detachmentId: input.detachmentId,
    attachedUnitIds: [],
    supportUnitIds: supportProviders(ds, input.factionId, [input.unitId]).map((provider) => provider.id),
  }, context);
  const selected = new Set(best.spec.selectedLeverIds);
  expect(best.spec.selectedLeverIds.filter((id) => !levers.buffs.some((lever) => lever.id === id))).toEqual([]);
  const buffs = [
    ...enabledLeverBuffs(levers.buffs, (lever) => selected.has(lever.id)),
    ...targetDefences(ds, target.unitRaw.id, noBuild, context).buffs,
  ];
  const wargear = memberWargear({ ds, factionId: input.factionId, member: member!, counts, buffs, context });
  expect(wargear.error).toBeUndefined();
  const salvoTarget = { unit: target.unitRaw, modelCount: target.modelCount };
  const selection = selectLines({
    ds,
    members: [{ memberId: member!.memberId, loadout: member!.loadout, counts, grants: wargear.grants, buffs: wargear.buffs }],
    target: salvoTarget,
    buffs,
    context,
  });
  const lines = weaponLines(
    [{ memberId: member!.memberId, name: member!.unit.name, weapons: [...member!.unit.weapons.map((weapon) => weapon.raw), ...wargear.granted] }],
    "ranged",
  );
  return { session, best, stackMember, counts, matrix, member: member!, wargear, selection, lines, buffs: wargear.buffs, context, salvoTarget };
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
      const result = crunchLine({ ds, line, owner: run.member.unit.raw, models: weapon.count, target: run.salvoTarget, buffs: run.buffs, context: run.context });
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
});
