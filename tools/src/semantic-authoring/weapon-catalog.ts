import { readFileSync } from "node:fs";

import { abilityRefId } from "../data/ability-refs.js";

/**
 * The printed weapons a named-weapon leaf can refer to (compile-weapon-names.ts). `faction` is every
 * weapon of the record's faction. `own` is the weapons of the unit datasheets that carry the
 * record's ability; it is undefined when no datasheet carries it.
 */
export type WeaponRecord = { name: string; type: string };
export type WeaponCatalog = { faction: WeaponRecord[]; own?: WeaponRecord[] };

const CORE = new URL("../../../data/core/", import.meta.url);
const cache = new Map<string, WeaponCatalog>();

function readList(faction: string, file: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(new URL(`${faction}/${file}`, CORE), "utf8")) as Array<Record<string, unknown>>;
}

/** Load a faction's weapons from its data files, with the own-datasheet weapons when an ability id is given. */
export function loadWeaponCatalog(faction: string, abilityId: string | undefined): WeaponCatalog {
  const key = `${faction}\u0000${abilityId ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const weapons = readList(faction, "weapons.json");
  const byId = new Map(weapons.map((weapon) => [String(weapon.id), { name: String(weapon.name), type: String(weapon.type) }]));
  const catalog: WeaponCatalog = { faction: [...byId.values()] };
  if (abilityId !== undefined) {
    const carriers = readList(faction, "units.json").filter((unit) => ((unit.ability_ids ?? []) as unknown[]).some((ref) => abilityRefId(ref as Record<string, unknown>) === abilityId));
    if (carriers.length > 0) {
      catalog.own = carriers.flatMap((unit) => ((unit.weapon_ids ?? []) as string[]).flatMap((id) => byId.get(id) ?? []));
    }
  }
  cache.set(key, catalog);
  return catalog;
}
