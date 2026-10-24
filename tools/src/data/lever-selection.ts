import type { StackableBuff, StackableBuffGroup } from "./dataset.js";

/** The activation metadata needed to validate a complete proposed selection. */
export type SelectableLever = Pick<StackableBuff, "id" | "group" | "groups" | "requiresLever" | "raisesCap">;

/**
 * Check every intersecting activation pool and provider dependency. Capacity raises
 * supply extra slots only for their fixed option or allowed subset; overlapping
 * subsets use exact assignment, so the same slot cannot fund two activations.
 * Option matching uses immutable lever ids, including granted-record prefixes.
 */
export function isLegalLeverSelection(
  levers: readonly SelectableLever[],
  groups: readonly StackableBuffGroup[],
  selectedIds: ReadonlySet<string>,
): boolean {
  const selected = levers.filter((lever) => selectedIds.has(lever.id));
  if (selected.length !== selectedIds.size) return false;
  if (selected.some((lever) => lever.requiresLever && !selectedIds.has(lever.requiresLever))) return false;
  const pools = new Map(groups.map((group) => [group.id, group]));
  const members = new Map<string, SelectableLever[]>();
  for (const lever of selected) {
    for (const id of new Set([...(lever.group ? [lever.group] : []), ...(lever.groups ?? [])])) {
      if (!pools.has(id)) return false;
      const entries = members.get(id) ?? [];
      entries.push(lever);
      members.set(id, entries);
    }
  }
  for (const [id, entries] of members) {
    const group = pools.get(id)!;
    if (entries.length <= group.maxActivations) continue;
    const slots: (SelectableLever["raisesCap"] | undefined)[] = Array.from({ length: Math.max(0, Math.floor(group.maxActivations)) });
    for (const lever of selected) {
      const raise = lever.raisesCap;
      if (raise?.group !== id) continue;
      for (let i = 0; i < Math.min(raise.by, entries.length); i++) slots.push(raise);
    }
    if (slots.length < entries.length) return false;
    const assigned = new Map<number, number>();
    const assign = (entryIndex: number, visited: Set<number>): boolean => {
      for (let slot = 0; slot < slots.length; slot++) {
        if (visited.has(slot)) continue;
        const raise = slots[slot];
        const options = raise?.allocation === "fixed-option" ? (raise.option ? [raise.option] : []) : raise?.options;
        if (options && !options.some((option) => option.ability_id === group.abilityId && entries[entryIndex].id.endsWith(`${option.ability_id}#${option.option_id}`))) continue;
        visited.add(slot);
        const prior = assigned.get(slot);
        if (prior === undefined || assign(prior, visited)) {
          assigned.set(slot, entryIndex);
          return true;
        }
      }
      return false;
    };
    if (!entries.every((_, index) => assign(index, new Set()))) return false;
  }
  return true;
}
