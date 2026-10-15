/**
 * A `weapon-grant` effect names a weapon entity by id. The id must resolve to a weapon in the
 * ability's faction: `core/<faction>/weapons.json`, or the weapons.json of a shared-roster parent
 * (deathwatch resolves to adeptus-astartes). Run as part of `checkReferentialIntegrity`.
 */

import { existsSync, readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname, resolve } from "node:path";
import type { ValidationResult } from "./validate.js";
import { SHARED_ROSTERS } from "./mfm/faction-map.js";

/** Weapon ids a faction can grant: its own weapons.json plus its shared-roster parents'. */
export function factionWeaponIds(root: string, faction: string): Set<string> {
  const ids = new Set<string>();
  for (const dir of [faction, ...(SHARED_ROSTERS[faction] ?? [])]) {
    const file = resolve(root, "core", dir, "weapons.json");
    if (!existsSync(file)) continue;
    for (const weapon of JSON.parse(readFileSync(file, "utf8")) as Array<{ id?: unknown }>) {
      if (typeof weapon.id === "string") ids.add(weapon.id);
    }
  }
  return ids;
}

/** Every `weapon_id` a `weapon-grant` effect names, at any depth of an effect tree. */
export function weaponGrantIds(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) weaponGrantIds(item, found);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "weapon-grant") {
      const modifier = record.modifier as Record<string, unknown> | undefined;
      if (typeof modifier?.weapon_id === "string") found.push(modifier.weapon_id);
    }
    for (const child of Object.values(record)) weaponGrantIds(child, found);
  }
  return found;
}

export async function checkWeaponGrantRefs(root: string, result: ValidationResult): Promise<void> {
  const files = await glob("enrichment/*/abilities.json", { cwd: root, absolute: true });
  for (const file of files.sort()) {
    const faction = basename(dirname(file));
    if (faction.startsWith("_")) continue;
    const records = JSON.parse(readFileSync(file, "utf8")) as Array<{ ability_id?: unknown }>;
    const weaponIds = factionWeaponIds(root, faction);
    let fileCounted = false;
    records.forEach((record, index) => {
      const granted = weaponGrantIds(record);
      // Only records that grant a weapon are counted, so unrelated records leave the totals unchanged.
      if (granted.length === 0) return;
      if (!fileCounted) {
        result.totalFiles++;
        fileCounted = true;
      }
      result.totalItems++;
      const missing = granted.filter((id) => !weaponIds.has(id));
      if (missing.length === 0) {
        result.passed++;
        return;
      }
      result.failed++;
      result.errors.push({
        file,
        index,
        errors: missing.map((id) => ({
          path: `/${index}/effect`,
          message: `ability "${String(record.ability_id)}" grants weapon "${id}", which ${faction} (or its shared roster) has no weapons.json entry for`,
        })),
      });
    });
  }
}
