import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { unitsIn, type UnitNameContext } from "./compile-unit-names.js";

/**
 * A reserves schedule (a Combat Patrol detachment's arrival rounds), bound before any role-based pass.
 *
 * "the following friendly units must start the battle in strategic reserves and cannot be set up on
 * the battlefield before the battle round stated" is one reserves-schedule leaf. Its rows follow it:
 * each is a unit-filter naming exactly one datasheet ("Emperor's Champion", reviewed to its unit id)
 * then a battle-round with min ("Battle round 2"). The rows fold into the schedule's `entries` and are
 * dropped, so the table is one effect, not a filter and a round per row.
 */

type Entry = { unit_id: string; battle_round: number };

const isSchedule = (leaf: CompileLeaf) => leaf.family_id === "reserves-schedule";

/** The one unit id a row heading names: reviewed `datasheets`, or `unit_ids` resolved from an exact printed name. */
function rowUnit(leaf: CompileLeaf): string | undefined {
  if (leaf.family_id !== "unit-filter") return undefined;
  const ids = (leaf.parameters.datasheets ?? leaf.parameters.unit_ids) as unknown;
  if (!Array.isArray(ids)) return undefined;
  if (ids.length !== 1) throw new CompileError(`The schedule row at byte ${leaf.start_byte} names ${ids.length} datasheets; each row names one.`);
  const extra = Object.keys(leaf.parameters).filter((key) => !["side", "datasheets", "unit_ids", "level"].includes(key));
  if (leaf.parameters.side !== "friendly" || extra.length > 0) {
    throw new CompileError(`The schedule row at byte ${leaf.start_byte} names a friendly datasheet and nothing else; it also has ${extra.length > 0 ? extra.join(", ") : `side ${String(leaf.parameters.side)}`}.`);
  }
  return String(ids[0]);
}

function rowRound(leaf: CompileLeaf): number | undefined {
  if (leaf.family_id !== "battle-round") return undefined;
  const keys = Object.keys(leaf.parameters);
  if (keys.length !== 1 || keys[0] !== "min") throw new CompileError(`The schedule row's battle round at byte ${leaf.start_byte} is "Battle round N": a min alone.`);
  const round = closed(leaf, "min") as number;
  // Every unit can be set up in the first battle round, so a schedule row starts at the second.
  if (round < 2) throw new CompileError(`The schedule row's battle round at byte ${leaf.start_byte} is ${round}; a scheduled arrival is battle round 2 or later.`);
  return round;
}

export function foldReservesSchedules(leaves: readonly CompileLeaf[], units?: UnitNameContext): CompileLeaf[] {
  const schedules = leaves.flatMap((leaf, index) => isSchedule(leaf) ? [index] : []);
  if (schedules.length === 0) return [...leaves];
  if (schedules.length > 1) throw new CompileError(`A record has ${schedules.length} reserves schedules; its rows follow one schedule.`);
  if (!units) throw new CompileError("A reserves schedule names datasheets; compiling it needs the owning faction's unit catalog.");
  const at = schedules[0]!;
  const schedule = leaves[at]!;
  const known = new Set(unitsIn(units).map((unit) => unit.id));
  const entries: Entry[] = [];
  let end = at + 1;
  while (end < leaves.length) {
    const unitId = rowUnit(leaves[end]!);
    if (unitId === undefined) break;
    const roundLeaf = leaves[end + 1];
    const round = roundLeaf ? rowRound(roundLeaf) : undefined;
    if (round === undefined) throw new CompileError(`The schedule row at byte ${leaves[end]!.start_byte} names a datasheet but no "Battle round N" after it.`);
    if (!known.has(unitId)) throw new CompileError(`The schedule row at byte ${leaves[end]!.start_byte} names ${unitId}, which is no datasheet of ${units.faction_id}.`);
    if (entries.some((entry) => entry.unit_id === unitId)) throw new CompileError(`The schedule lists ${unitId} twice.`);
    entries.push({ unit_id: unitId, battle_round: round });
    end += 2;
  }
  if (entries.length === 0) throw new CompileError(`The reserves schedule at byte ${schedule.start_byte} has no rows after it.`);
  const folded: CompileLeaf = { ...schedule, parameters: { ...schedule.parameters, entries } };
  return [...leaves.slice(0, at), folded, ...leaves.slice(end)];
}
