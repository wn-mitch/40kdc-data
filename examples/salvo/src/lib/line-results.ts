/**
 * Each weapon line's attributed crunch: the models firing it, the buffs they attack with and the
 * leave-one-out attribution of every stage.
 */
import {
  DAMAGE_DEALT_MEASURES,
  allocateSequence,
  attributeStages,
  loadoutHitModifier,
  profileApplicableBuffs,
  profileEngineInput,
  type AttributedStage,
  type Buff,
  type Dataset,
  type EngineContext,
  type EngineInput,
  type Unit,
} from "@alpaca-software/40kdc-data";

import { aggregateStages, stageOf } from "./projection-model.js";
import { lineRows, type LineRow, type LineSelection, type WeaponLine } from "./weapon-lines.js";

/**
 * Models on one line whose wargear rules differ from the line's other models: `bearer` names the
 * wargear whose bearer-only rules reach them (empty for the models without any), and `rerollOne`
 * marks the group that spends the unit's re-roll-one permissions.
 */
export type LineGroup = { models: number; bearer: string[]; rerollOne?: true; attributed: AttributedStage[] };

/**
 * A line's crunch. `groups` is present when its models attack with different buffs; `attributed`
 * is then their sum, as the combined row sums lines.
 */
export type LineResult = WeaponLine & {
  models: number;
  attributed: AttributedStage[];
  groups?: LineGroup[];
  /** The engine inputs the line was crunched from, one per group, for the exact allocation. */
  inputs?: EngineInput[];
  error?: string;
};

/**
 * The buffs one row of models attacks with, as the damage matrix attributes the row: a bearer-only
 * wargear rule only for the models carrying that wargear, re-roll-one permissions only on the row
 * that spends them.
 */
function rowBuffs(buffs: readonly Buff[], row: LineRow): Buff[] {
  return profileApplicableBuffs(buffs, row).filter((buff) => buff.contribution.type !== "reroll-one" || row.rerollOne === true);
}

/** The wargear whose bearer-only rules are among `buffs`. */
function bearerWargear(buffs: readonly Buff[]): string[] {
  const ids = buffs.flatMap((buff) =>
    buff.source.kind === "ability" && buff.applicableWhen?.modelScoped === true && buff.source.wargearId !== undefined ? [buff.source.wargearId] : []);
  return [...new Set(ids)].sort();
}

/**
 * `rows` merged into the groups that attack with the same buffs, models without a bearer-only rule
 * first.
 */
function buffGroups(buffs: readonly Buff[], rows: readonly LineRow[]): { models: number; buffs: Buff[]; rerollOne?: true }[] {
  const groups = new Map<string, { models: number; buffs: Buff[]; rerollOne?: true }>();
  for (const row of rows) {
    const kept = rowBuffs(buffs, row);
    const rerollOne = row.rerollOne === true && kept.some((buff) => buff.contribution.type === "reroll-one");
    const key = `${kept.map((buff) => buffs.indexOf(buff)).join(",")}|${rerollOne}`;
    const group = groups.get(key);
    if (group) group.models += row.count;
    else groups.set(key, { models: row.count, buffs: kept, ...(rerollOne ? { rerollOne: true as const } : {}) });
  }
  return [...groups.values()].sort((a, b) =>
    bearerWargear(a.buffs).length - bearerWargear(b.buffs).length || Number(a.rerollOne ?? false) - Number(b.rerollOne ?? false));
}

/** What sets a group apart: the wargear its bearer-only rules come from, and its re-roll-one permissions. */
export function lineGroupLabel(ds: Dataset, group: Pick<LineGroup, "bearer" | "rerollOne">): string {
  const parts = [
    ...(group.bearer.length > 0 ? [`with ${group.bearer.map((id) => ds.wargear.get(id)?.name ?? id).join(", ")}`] : []),
    ...(group.rerollOne ? ["re-roll one"] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : "others";
}

/** Several groups' stages as one line's: their sum, with each group's engine detail kept. */
function sumGroups(ds: Dataset, groups: readonly LineGroup[], target: { unit: Unit; modelCount: number }): AttributedStage[] {
  const W = target.unit.profiles?.[0]?.W ?? 0;
  return aggregateStages(groups, typeof W === "number" ? W : 0, target.modelCount).map((stage) => stage.name === "models-killed"
    ? stage
    : {
      ...stage,
      detail: groups
        .map((group) => `${group.models} ${lineGroupLabel(ds, group)}: ${stageOf(group.attributed, stage.name)?.detail ?? ""}`)
        .join("; "),
    });
}

/**
 * One weapon line crunched with the models firing it, with the leave-one-out attribution of each
 * stage. The engine input is the one the loadout scoring used, including the owner's Big Guns
 * Never Tire Hit roll modifier. With `rows`, each row's models attack with the buffs that reach
 * them (see {@link rowBuffs}), and rows whose buffs differ are crunched apart as the line's
 * `groups`; without `rows`, every model attacks with all of `buffs`.
 */
export function crunchLine(input: {
  ds: Dataset;
  line: WeaponLine;
  owner: Unit | undefined;
  models: number;
  target: { unit: Unit; modelCount: number };
  buffs: readonly Buff[];
  context: EngineContext;
  rows?: readonly LineRow[];
}): LineResult {
  const { ds, line, owner, models, context } = input;
  if (models <= 0) return { ...line, models, attributed: [], error: "no models carry this weapon" };
  const inputs: EngineInput[] = [];
  const crunchModels = (modelsFiring: number, buffs: readonly Buff[]) => {
    const profile = line.weaponRaw.profiles[line.profileIndex];
    const engineInput = profileEngineInput({
      weapon: line.weaponRaw,
      profileIndex: line.profileIndex,
      target: input.target,
      modelsFiring,
      buffs: [...buffs],
      context,
      hitModifier: owner && profile ? loadoutHitModifier(owner, profile, context) : 0,
    });
    inputs.push(engineInput);
    return attributeStages(engineInput, ds, { measures: DAMAGE_DEALT_MEASURES });
  };
  try {
    const groups = input.rows ? buffGroups(input.buffs, input.rows) : [{ models, buffs: [...input.buffs] }];
    if (groups.length === 1) {
      const attributed = crunchModels(models, groups[0]!.buffs);
      return { ...line, models, attributed, inputs };
    }
    const crunched: LineGroup[] = groups.map((group) => ({
      models: group.models,
      bearer: bearerWargear(group.buffs),
      ...(group.rerollOne ? { rerollOne: group.rerollOne } : {}),
      attributed: crunchModels(group.models, group.buffs),
    }));
    return { ...line, models, attributed: sumGroups(ds, crunched, input.target), groups: crunched, inputs };
  } catch (err) {
    return { ...line, models, attributed: [], error: (err as Error).message };
  }
}

/**
 * Every line crunched as the output pane shows it: a used line with the models the loadout scoring
 * fires it with, an unused one with every model carrying it, each split into the rows of
 * {@link lineRows}.
 */
export function crunchLines(input: {
  ds: Dataset;
  lines: readonly WeaponLine[];
  members: readonly { memberId: string; unit: { raw: Unit } }[];
  selection: LineSelection | null;
  carried: (line: WeaponLine) => number;
  target: { unit: Unit; modelCount: number };
  buffsOf: (memberId: string) => readonly Buff[];
  contextOf: (memberId: string) => EngineContext;
}): LineResult[] {
  return input.lines.map((line) => {
    const models = input.selection?.firing.get(line.id) ?? input.carried(line);
    return crunchLine({
      ds: input.ds,
      line,
      owner: input.members.find((member) => member.memberId === line.ownerMemberId)?.unit.raw,
      models,
      target: input.target,
      buffs: input.buffsOf(line.ownerMemberId),
      context: input.contextOf(line.ownerMemberId),
      rows: lineRows(input.selection, line, models),
    });
  });
}

/** The exact spread of one combined volley: models destroyed and wounds dealt, each by count. */
export type KillOdds = {
  /** Probability of exactly each number of models destroyed, from 0 to the unit's size. */
  modelsDestroyed: number[];
  /** Probability of exactly each number of wounds dealt, from 0 to the unit's total. */
  woundsDealt: number[];
  /** Expected models destroyed, which counts damage lost past a model's last wound. */
  expectedKilled: number;
};

/**
 * The combined volley of `lines` as an exact distribution: every group of every line fires in the
 * order given, each into what the earlier ones left, so damage carried over to a damaged model and
 * damage lost to overkill both count. `error` explains a volley the exact allocation refuses
 * (too many attacks, or a rule it does not model).
 */
export function killOdds(ds: Dataset, lines: readonly LineResult[]): KillOdds | { error: string } | null {
  const inputs = lines.flatMap((line) => line.inputs ?? []);
  if (inputs.length === 0) return null;
  try {
    const out = allocateSequence(inputs, ds);
    return { modelsDestroyed: out.modelsDestroyedDistribution, woundsDealt: out.woundsDealtDistribution, expectedKilled: out.modelsDestroyed };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** A probability as a whole percentage; float sums leave certain and impossible outcomes a hair off. */
export function fmtChance(p: number): string {
  if (p <= 1e-9) return "0%";
  if (p >= 1 - 1e-9) return "100%";
  const v = p * 100;
  if (v < 1) return "<1%";
  if (v > 99) return ">99%";
  return `${Math.round(v)}%`;
}

/** The chance of destroying at least each number of models, from 1 up: `atLeast[k - 1]` is P(≥ k). */
export function atLeast(distribution: readonly number[]): number[] {
  const out: number[] = [];
  let tail = 0;
  for (let k = distribution.length - 1; k >= 1; k -= 1) {
    tail += distribution[k] ?? 0;
    out[k - 1] = Math.min(1, tail);
  }
  return out;
}
