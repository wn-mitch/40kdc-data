import { describe, expect, it } from "vitest";
import {
  attributeSelectedProfile,
  Dataset,
  profileApplicableBuffs,
  unitLoadoutDamage,
  validateCandidateLoadout,
  type Buff,
  type EngineContext,
} from "@alpaca-software/40kdc-data";

import { crunchLines } from "./line-results.js";
import { enabledLeverBuffs, memberLevers, memberUnits, memberWargear } from "./output-model.js";
import { stageOf } from "./projection-model.js";
import { defaultWeaponCount, lineId, lineRows, memberCounts, selectLines, weaponLines } from "./weapon-lines.js";

const ds = Dataset.embedded();
const target = { unit: ds.units.getAny("intercessor-squad")!.raw, modelCount: 5 };

/**
 * Five Nobz, one swapping its kustom shoota for Paired Krumpas: a wargear rule whose re-rolls the
 * dataset scopes to its bearer model, on a melee weapon (the kustom krumpa) every Nob carries.
 */
const MIXED = new Map([["kustom-krumpa", 5], ["kustom-shoota-nobz", 4], ["paired-krumpas", 1]]);

/**
 * Salvo's output pane, from the attacker's default levers (plus `extra` buffs) to its line results,
 * for one unit with `counts` (its default loadout when omitted).
 */
function salvoUnit(unitId: string, factionId: string, phase: EngineContext["phase"], counts?: ReadonlyMap<string, number>, extra: Buff[] = []) {
  const attacker = { unitId, factionId, detachmentId: null, attachedUnitIds: [], supportUnitIds: [] };
  const [levers] = memberLevers(ds, attacker, { phase });
  const [member] = memberUnits(ds, factionId, [unitId]);
  counts ??= memberCounts(member!.loadout, member!.unit.weapons.map((weapon) => weapon.id), (weaponId) => defaultWeaponCount(member!.loadout, weaponId));
  const modelCount = member!.loadout.modelCount;
  const buffs = [...enabledLeverBuffs(levers!.levers.buffs, (lever) => lever.enabled), ...extra];
  const wargear = memberWargear({ ds, factionId, member: member!, counts, buffs, context: levers!.context });
  const selection = selectLines({
    ds,
    members: [{ memberId: unitId, loadout: member!.loadout, counts, grants: wargear.grants, buffs: wargear.buffs, context: levers!.context }],
    target,
    buffs,
    context: levers!.context,
  });
  const lines = weaponLines(
    [{ memberId: unitId, name: member!.unit.name, weapons: [...member!.unit.weapons.map((weapon) => weapon.raw), ...wargear.granted] }],
    phase === "fight" ? "melee" : "ranged",
  );
  const results = crunchLines({
    ds,
    lines,
    members: [member!],
    selection,
    carried: (line) => counts!.get(line.weaponId) ?? 0,
    target,
    buffsOf: () => wargear.buffs,
    contextOf: () => levers!.context,
  });
  // The damage matrix's scoring of the same loadout, with its per-row buffs for attribution.
  const legality = validateCandidateLoadout({ unit: member!.unit.raw, modelCount, counts, loadout: member!.loadout.rules });
  const shared = unitLoadoutDamage({
    dataset: ds,
    unit: member!.unit.raw,
    modelCount,
    counts,
    target,
    buffs: wargear.buffs,
    context: levers!.context,
    groups: legality.groups,
    grants: wargear.grants,
  });
  const matrixBuffs = (row: (typeof shared.selected)[number]): Buff[] =>
    profileApplicableBuffs(wargear.buffs, row).filter((buff) => buff.contribution.type !== "reroll-one" || row.rerollOne === true);
  return { selection, results, shared, matrixBuffs, member: member!, context: levers!.context, buffs: wargear.buffs };
}

const salvoNobz = (phase: EngineContext["phase"], counts: ReadonlyMap<string, number>) => salvoUnit("nobz", "orks", phase, counts);

const afterFnp = (attributed: Parameters<typeof stageOf>[0]) => stageOf(attributed, "after-fnp")!;

describe("model-scoped wargear rules on a shared weapon line", () => {
  it("re-rolls only the Paired Krumpas bearer's krumpa attacks, as the loadout scoring does", () => {
    const { selection, results, shared, buffs } = salvoNobz("fight", MIXED);
    expect(buffs.some((buff) => buff.applicableWhen?.modelScoped === true && buff.source.kind === "ability" && buff.source.wargearId === "paired-krumpas")).toBe(true);
    const used = results.filter((result) => selection.firing.has(result.id) && !result.error);
    const total = used.reduce((sum, result) => sum + afterFnp(result.attributed).expected, 0);
    expect(total).toBeCloseTo(shared.total, 9);
    expect(total).toBeCloseTo(selection.total, 9);
  });

  it("splits the krumpa line into its bearer and non-bearer groups, each attributed as the matrix attributes it", () => {
    const { results, shared, matrixBuffs, member, context } = salvoNobz("fight", MIXED);
    const krumpa = results.find((result) => result.id === lineId("nobz", "kustom-krumpa", 0))!;
    expect(krumpa.models).toBe(5);
    expect(krumpa.groups?.map((group) => [group.models, group.bearer])).toEqual([[4, []], [1, ["paired-krumpas"]]]);

    for (const group of krumpa.groups!) {
      const row = shared.selected.find((candidate) => candidate.weaponId === "kustom-krumpa" && candidate.count === group.models)!;
      const matrix = attributeSelectedProfile({ dataset: ds, unit: member.unit.raw, selected: row, target, buffs: matrixBuffs(row), context })!;
      const salvo = afterFnp(group.attributed);
      expect(salvo.expected).toBeCloseTo(row.damage, 9);
      expect(salvo.baseline).toBeCloseTo(matrix.baseline, 9);
      expect(salvo.lifts.map((lift) => [lift.source, lift.delta])).toEqual(matrix.lifts.map((lift) => [lift.source, lift.delta]));
    }
    // The line's own stages are its groups' sum, so the bearer's re-roll lift is all the line shows.
    const line = afterFnp(krumpa.attributed);
    expect(line.expected).toBeCloseTo(krumpa.groups!.reduce((sum, group) => sum + afterFnp(group.attributed).expected, 0), 9);
    expect(line.lifts.map((lift) => lift.delta)).toEqual(afterFnp(krumpa.groups![1]!.attributed).lifts.map((lift) => lift.delta));
  });

  it("splits an unused line's carriers by the model groups that carry it", () => {
    const { selection, results, member, buffs, context } = salvoNobz("fight", MIXED);
    const used = results.find((result) => result.id === lineId("nobz", "kustom-krumpa", 0))!;
    // The same loadout with the krumpa line left unused, as when the scoring prefers another weapon.
    const unused = { ...selection, firing: new Map(), rows: new Map() };
    const rows = lineRows(unused, used, 5);
    expect(rows.map((row) => [row.count, row.modelWargear?.includes("paired-krumpas") ?? false])).toEqual([[4, false], [1, true]]);
    const [shown] = crunchLines({
      ds,
      lines: [used],
      members: [member],
      selection: unused,
      carried: () => 5,
      target,
      buffsOf: () => buffs,
      contextOf: () => context,
    });
    expect(shown!.groups?.map((group) => [group.models, group.bearer])).toEqual([[4, []], [1, ["paired-krumpas"]]]);
    expect(afterFnp(shown!.attributed).expected).toBeCloseTo(afterFnp(used.attributed).expected, 9);

    // Carriers the groups do not account for cannot be told apart, so no bearer-only rule reaches them.
    expect(lineRows(unused, used, 3)).toEqual([{ count: 3, rerollOne: true }]);
  });

  it("keeps one group when no model carries the wargear", () => {
    const counts = new Map([["kustom-krumpa", 5], ["kustom-shoota-nobz", 5]]);
    const { results, shared } = salvoNobz("fight", counts);
    const krumpa = results.find((result) => result.id === lineId("nobz", "kustom-krumpa", 0))!;
    expect(krumpa.groups).toBeUndefined();
    expect(afterFnp(krumpa.attributed).expected).toBeCloseTo(shared.total, 9);
  });
});

describe("re-roll-one permissions across a unit's lines", () => {
  it("spend the permission once, on the row the loadout scoring gives it", () => {
    const rerollOne: Buff = { source: { kind: "manual", label: "re-roll one Hit roll" }, contribution: { type: "reroll-one", roll: "hit" } };
    const { selection, results, shared } = salvoUnit("defiler", "chaos-space-marines", "shooting", undefined, [rerollOne]);
    const used = results.filter((result) => selection.firing.has(result.id) && !result.error);
    expect(used.length).toBeGreaterThan(1);
    expect(shared.selected.filter((row) => row.rerollOne)).toHaveLength(1);
    expect(used.reduce((sum, result) => sum + afterFnp(result.attributed).expected, 0)).toBeCloseTo(shared.total, 9);
  });
});
