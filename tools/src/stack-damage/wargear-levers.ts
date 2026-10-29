/**
 * Levers whose translation depends on a loadout. A rule gated on a `unit-wargear` condition
 * translates to nothing while the wargear is unknown, so a member with such a rule is scored per
 * loadout. Its wargear-reading rules are translated under the wargear they name; only when that
 * changes what they give are the member's levers translated again under the loadout.
 */
import type { EligibleAbility } from "../abilities-resolver/index.js";
import type { Buff, EngineContext } from "../cruncher/index.js";
import type { StackableBuff } from "../data/dataset.js";
import type { LoadoutScaffold } from "./loadout-search.js";
import { sourceFor } from "./translation-warnings.js";

/** Whether an effect tree holds a `unit-wargear` condition. */
export function readsUnitWargear(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(readsUnitWargear);
  if (node === null || typeof node !== "object") return false;
  const record = node as Record<string, unknown>;
  return record.type === "unit-wargear" || Object.values(record).some(readsUnitWargear);
}

/** A member's eligible rules that read `unit-wargear`, and the wargear their conditions name. */
export interface WargearRules {
  entries: EligibleAbility[];
  wargearIds: string[];
  /** What the rules give without a loadout; see {@link wargearTranslation}. */
  unloaded: string;
  /** Whether some loadout the unit can take changes what the rules give. */
  loadoutDependent: boolean;
}

/** Wargear count combinations past which {@link wargearRules} assumes a loadout matters. */
const MAX_WARGEAR_TRIALS = 512;

function namedWargear(node: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(node)) for (const item of node) namedWargear(item, out);
  else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const wargear = (record.parameters as { wargear?: unknown } | undefined)?.wargear;
    if (record.type === "unit-wargear" && typeof wargear === "string") out.add(wargear);
    for (const value of Object.values(record)) namedWargear(value, out);
  }
  return out;
}

/**
 * The rules among `eligible` that read `unit-wargear`, with what they give under `context`. They
 * are loadout-dependent when carrying none, one or every model's worth of any named wargear the
 * unit's base loadout or options can hold changes what they give.
 */
export function wargearRules(eligible: readonly EligibleAbility[], context: EngineContext, scaffold: Pick<LoadoutScaffold, "base" | "options" | "modelCount">): WargearRules {
  const carriable = new Set([...scaffold.base.keys(), ...scaffold.options.flatMap((option) => [...(option.replacement ?? []), ...(option.replacement_choice ?? []).flat()])]);
  const entries = eligible.filter((entry) => readsUnitWargear(entry.ability.raw.effect));
  const wargearIds = [...entries.reduce((ids, entry) => namedWargear(entry.ability.raw.effect, ids), new Set<string>())].sort();
  const unloaded = wargearTranslation(entries, context);
  const varied = wargearIds.filter((id) => carriable.has(id));
  const counts = [...new Set([0, 1, scaffold.modelCount])];
  let loadoutDependent = entries.length > 0 && counts.length ** varied.length > MAX_WARGEAR_TRIALS;
  for (let trial = 0; entries.length > 0 && !loadoutDependent && trial < counts.length ** varied.length; trial++) {
    const wargear = Object.fromEntries(wargearIds.map((id) => [id, 0]));
    varied.forEach((id, index) => { wargear[id] = counts[Math.floor(trial / counts.length ** index) % counts.length]; });
    loadoutDependent = wargearTranslation(entries, { ...context, attackerWargear: wargear }) !== unloaded;
  }
  return { entries, wargearIds, unloaded, loadoutDependent };
}

/** The wargear of `counts` among `ids`: all a `unit-wargear` condition on them reads. */
export function namedLoadoutWargear(counts: ReadonlyMap<string, number>, ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, counts.get(id) ?? 0]));
}

/** What `entries` give the attacker under `context`, as a comparable key. */
export function wargearTranslation(entries: readonly EligibleAbility[], context: EngineContext): string {
  return JSON.stringify(entries.map((entry) => {
    const translated = entry.ability.describeBuffs(sourceFor(entry), context, "attacker", entry.rating);
    return [translated.applied, translated.activatable];
  }));
}

/**
 * The buffs of a member's levers translated under one loadout: each selected lever's, and each
 * lever the loadout alone surfaces (absent from the loadout-free pool) that is on by default.
 * The lever search never sees a surfaced lever; it applies with the wargear that surfaces it.
 */
export function loadoutLeverBuffs(
  levers: readonly StackableBuff[],
  poolIds: ReadonlySet<string>,
  selected: ReadonlySet<string>,
): Buff[] {
  return levers.filter((lever) => selected.has(lever.id) || surfacedByLoadout(lever, poolIds)).flatMap((lever) => lever.buffs);
}

/** Whether a lever translated under a loadout is absent from the loadout-free pool and on by default. */
export function surfacedByLoadout(lever: StackableBuff, poolIds: ReadonlySet<string>): boolean {
  return !poolIds.has(lever.id) && lever.enabled === true;
}
