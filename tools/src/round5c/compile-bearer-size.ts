import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The model count of the units that can bear an ability, read from the repo's core data. A
 * model-level "other" selection excludes only the bearer's unit, which is one model only when
 * every unit that can bear the ability has one. An enhancement's bearers are the units with its
 * keyword restrictions; any other ability's bearers are the units that list it.
 */

type Row = Record<string, unknown>;

const DEFAULT_DATA_ROOT = fileURLToPath(new URL("../../../data", import.meta.url));
const cache = new Map<string, Map<string, number | null>>();

function readRows(path: string): Row[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed as Row[] : [];
}

/** Each ability id's largest bearer model count, or null when a bearer has no printed count. */
function bearerCounts(dataRoot: string): Map<string, number | null> {
  const cached = cache.get(dataRoot);
  if (cached) return cached;
  const coreRoot = join(dataRoot, "core");
  const factions = existsSync(coreRoot) ? readdirSync(coreRoot).sort() : [];
  const units = factions.flatMap((faction) => readRows(join(coreRoot, faction, "units.json")));
  const enhancements = factions.flatMap((faction) => readRows(join(coreRoot, faction, "enhancements.json")));
  const counts = new Map<string, number | null>();
  const record = (ability: string, bearers: Row[]) => {
    const sizes = bearers.map((unit) => (unit.model_count as { max?: unknown } | undefined)?.max);
    const max = sizes.length === 0 || sizes.some((size) => typeof size !== "number") ? null : Math.max(...(sizes as number[]));
    counts.set(ability, max);
  };
  for (const enhancement of enhancements) {
    if (typeof enhancement.ability_id !== "string" || !Array.isArray(enhancement.keyword_restrictions)) continue;
    const required = (enhancement.keyword_restrictions as string[]).map((keyword) => keyword.toUpperCase());
    const bearers = units.filter((unit) => {
      // A faction keyword ("Imperial Knights") is printed apart from the unit's own keywords.
      const printed = [...(Array.isArray(unit.keywords) ? unit.keywords : []), ...(Array.isArray(unit.faction_keywords) ? unit.faction_keywords : [])];
      const keywords = (printed as string[]).map((keyword) => keyword.toUpperCase());
      return required.every((keyword) => keywords.includes(keyword));
    });
    record(enhancement.ability_id, bearers);
  }
  for (const unit of units) {
    if (!Array.isArray(unit.ability_ids)) continue;
    for (const entry of unit.ability_ids) {
      const id = typeof entry === "string" ? entry : (entry as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || counts.has(id)) continue;
      record(id, units.filter((other) => Array.isArray(other.ability_ids) && other.ability_ids.some((item) => (typeof item === "string" ? item : (item as { id?: unknown })?.id) === id)));
    }
  }
  cache.set(dataRoot, counts);
  return counts;
}

/**
 * The largest model count among the units that can bear `abilityId`, or null when none is known.
 * Only an enhancement's own ability or a unit-listed ability has bearers in the data.
 */
export function bearerModelMax(abilityId: string | undefined, dataRoot = DEFAULT_DATA_ROOT): number | null {
  if (abilityId === undefined) return null;
  return bearerCounts(dataRoot).get(abilityId) ?? null;
}
