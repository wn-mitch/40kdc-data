/** Shared wargear entries: weapons with their Ranged/Melee profiles, and profile-less wargear. */
import type { Dataset } from "../data/dataset.js";
import type { WeaponView } from "../data/entities.js";
import type { IdAllocator } from "./ids.js";
import { characteristic, cost, profile } from "./nodes.js";
import type { BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";

/** A weapon keyword's label as datasheets print it: `Anti-Infantry 4+`, `Rapid Fire 1`, `Lethal Hits`. */
export function keywordLabel(name: string, parameters: Record<string, unknown> | undefined): string {
  if (parameters) {
    const target = parameters.target_keyword;
    const threshold = parameters.threshold;
    if (typeof target === "string" && (typeof threshold === "number" || typeof threshold === "string")) {
      return `${name}-${target} ${threshold}+`;
    }
    const value = parameters.value;
    if (value !== undefined && value !== null) return `${name} ${String(value)}`;
  }
  return name;
}

/** A profile is melee when its range is `Melee`; a weapon can carry both kinds. */
function isMeleeProfile(range: unknown): boolean {
  return range === "Melee";
}

function rangeText(range: unknown): string {
  if (isMeleeProfile(range)) return "Melee";
  if (range === "N/A") return "N/A";
  const text = String(range ?? 0);
  return text.endsWith('"') ? text : `${text}"`;
}

function skillText(value: unknown): string {
  return typeof value === "number" ? `${value}+` : value === undefined || value === null ? "N/A" : String(value);
}

export function weaponProfiles(weapon: WeaponView, refs: SystemRefs, ids: IdAllocator, key: string): BsNode[] {
  return weapon.raw.profiles.map((p, index) => {
    const ranged = !isMeleeProfile(p.range);
    const typeName = ranged ? "Ranged Weapons" : "Melee Weapons";
    const type = refs.profileTypes[typeName];
    const c = type.characteristics;
    const stats = p.stats as Record<string, unknown>;
    const keywords = weapon
      .keywordsAt(index)
      .map((k) => keywordLabel(k.keyword.name, k.parameters))
      .join(", ");
    return profile(p.name, ids.id(`${key}:profile:${index}`), type.id, typeName, [
      characteristic("Range", c.Range, rangeText(p.range)),
      characteristic("A", c.A, String(stats.A)),
      characteristic(ranged ? "BS" : "WS", ranged ? c.BS : c.WS, skillText(ranged ? stats.BS : stats.WS)),
      characteristic("S", c.S, String(stats.S)),
      characteristic("AP", c.AP, String(stats.AP)),
      characteristic("D", c.D, String(stats.D)),
      characteristic("Keywords", c.Keywords, keywords),
    ]);
  });
}

/** Title-cases a lower-case wargear name ("resurrection orb" → "Resurrection orb"). */
function displayName(name: string): string {
  return name.length > 0 ? `${name[0].toUpperCase()}${name.slice(1)}` : name;
}

/**
 * The shared entry for one item a faction's units carry, or undefined when the
 * id names neither a weapon nor a wargear record.
 */
export function itemEntry(
  dataset: Dataset,
  refs: SystemRefs,
  ids: IdAllocator,
  factionId: string,
  itemId: string,
  preferredId: string | undefined,
): BsNode | undefined {
  const key = `item:${factionId}/${itemId}`;
  const weapon = dataset.weapons.byFaction(factionId).find((w) => w.id === itemId) ?? dataset.weapons.getAny(itemId);
  if (weapon) {
    return {
      name: weapon.name,
      id: ids.id(key, preferredId),
      hidden: false,
      import: true,
      type: "upgrade",
      costs: [cost("pts", refs.cost.pts, 0)],
      profiles: weaponProfiles(weapon, refs, ids, key),
    };
  }
  const wargear = dataset.wargear.getAny(itemId);
  if (!wargear) return undefined;
  return {
    name: displayName(wargear.name),
    id: ids.id(key, preferredId),
    hidden: false,
    import: true,
    type: "upgrade",
    costs: [cost("pts", refs.cost.pts, 0)],
  };
}
