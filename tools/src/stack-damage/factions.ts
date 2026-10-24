import type { Dataset } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import type { Unit } from "../generated.js";

export interface FactionContext {
  id: string;
  lineage: string[];
  keywords: string[];
  units: UnitView[];
}

export interface FactionRecordLike {
  id: string;
  parent_faction_id?: string | null;
}

export function factionLineageFrom(
  factionId: string,
  getFaction: (id: string) => FactionRecordLike | undefined,
): string[] {
  const lineage: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = factionId;
  while (current) {
    if (seen.has(current)) throw new Error(`Faction parent cycle at ${current}`);
    seen.add(current);
    lineage.push(current);
    const faction = getFaction(current);
    if (!faction) throw new Error(`Unknown faction ${current}`);
    current = faction.parent_faction_id;
  }
  return lineage;
}

export function unitAllowedInFaction(unit: Unit, armyKeywords: ReadonlySet<string>): boolean {
  const factionKeywords = unit.faction_keywords ?? [];
  if (!factionKeywords.every((keyword) => armyKeywords.has(keyword))) return false;
  return !(unit.excluded_faction_keywords ?? []).some((keyword) => armyKeywords.has(keyword));
}

/** Prefer a selected-faction record to a same-id record inherited from its parent. */
export function preferFactionCopies<T extends { id: string; faction_id?: string | null }>(
  records: readonly T[],
  lineage: readonly string[],
): T[] {
  const rank = new Map(lineage.map((id, index) => [id, index]));
  const chosen = new Map<string, T>();
  for (const record of records) {
    const existing = chosen.get(record.id);
    if (!existing || (rank.get(record.faction_id ?? "") ?? Infinity) < (rank.get(existing.faction_id ?? "") ?? Infinity)) {
      chosen.set(record.id, record);
    }
  }
  return [...chosen.values()];
}

export function resolveFactionContext(dataset: Dataset, factionId: string): FactionContext {
  const selected = dataset.factions.get(factionId);
  if (!selected) throw new Error(`Unknown faction ${factionId}`);
  const lineage = factionLineageFrom(factionId, (id) => dataset.factions.get(id)?.raw);
  const keywords = selected.raw.keywords ?? [];
  const armyKeywords = new Set(keywords);
  const inherited = lineage.flatMap((id) => dataset.units.byFaction(id));
  const units = preferFactionCopies(inherited, lineage)
    .filter((view) => unitAllowedInFaction(view.raw, armyKeywords))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { id: factionId, lineage, keywords, units };
}

export function unitInFaction(context: FactionContext, unitId: string): UnitView | undefined {
  return context.units.find((unit) => unit.id === unitId);
}
