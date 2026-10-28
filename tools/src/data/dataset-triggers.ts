/**
 * The reactive-trigger dispatch index {@link Dataset} answers: every ability
 * carrying an event trigger, and those triggers grouped by event.
 *
 * @packageDocumentation
 */
import type { GameEvent, Unit } from "../generated.js";
import type { AbilityView } from "./entities.js";
import type { RawData } from "./types.js";

/**
 * One reactive ability resolved for event dispatch: the ability's id, the
 * {@link GameEvent} it fires on, the units that carry it (sorted; empty for
 * faction/detachment rules), and the full (non-null) `trigger` block.
 *
 * @see {@link Dataset.reactiveTriggers}
 * @see {@link Dataset.triggerIndex}
 */
export type ReactiveTrigger = {
  abilityId: string;
  event: GameEvent;
  unitIds: string[];
  trigger: NonNullable<RawData["abilities"][number]["trigger"]>;
};

/** {@link Dataset.reactiveTriggers} over `abilities`, naming the units each is listed on. */
export function reactiveTriggersOf(
  abilities: readonly AbilityView[],
  unitsByAbility: ReadonlyMap<string, Unit[]>,
): ReactiveTrigger[] {
  const out: ReactiveTrigger[] = [];
  // The abilities collection retains one copy per faction of a shared
  // ability_id; this aggregation is faction-less (ReactiveTrigger carries no
  // faction), so emit each ability id once — first registered copy wins,
  // matching the collection's own byId index.
  const seenIds = new Set<string>();
  for (const a of abilities) {
    if (seenIds.has(a.id)) continue;
    seenIds.add(a.id);
    const raw = a.raw.trigger;
    if (!raw) continue;
    // `trigger` may be a single object or an array (the ability fires on any);
    // emit one ReactiveTrigger per event so the dispatch index keys them all.
    const triggers = Array.isArray(raw) ? raw : [raw];
    const unitIds = (unitsByAbility.get(a.id) ?? [])
      .map((u) => u.id)
      .sort();
    for (const trigger of triggers) {
      if (trigger?.event == null) continue;
      out.push({ abilityId: a.id, event: trigger.event, unitIds, trigger });
    }
  }
  out.sort((x, y) =>
    x.abilityId < y.abilityId ? -1 : x.abilityId > y.abilityId ? 1 : 0,
  );
  return out;
}

/** {@link Dataset.triggerIndex}: `triggers` grouped by event, events sorted. */
export function triggerIndexOf(
  triggers: readonly ReactiveTrigger[],
): Map<GameEvent, ReactiveTrigger[]> {
  const grouped = new Map<GameEvent, ReactiveTrigger[]>();
  for (const rt of triggers) {
    const bucket = grouped.get(rt.event);
    if (bucket) bucket.push(rt);
    else grouped.set(rt.event, [rt]);
  }
  return new Map(
    [...grouped.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
