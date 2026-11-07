/**
 * Weapon entities for inline weapon profiles that the dump prints against an enhancement or a
 * unit's wargear item. The owner's ability text names the weapon and stops before its stats, so
 * the stats come from the dump row that owns the weapon:
 *   - an enhancement links to exactly one wargear-item profile (enhancement_wargear_item_profile);
 *   - a unit's drone wargear item has one profile named after the weapon.
 *
 * A record is refused, not minted with a partial profile, when the dump row cannot be read as
 * one plain weapon: the names differ, the item has several profiles, or a keyword the catalog
 * cannot store (a rating or a qualifier) is printed.
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { detachmentScopedId, nameToId } from "../converters/id-generator.js";
import { mapWeaponKeyword, mintWeapon, type MintContext, type WeaponRecord } from "./gear-projection.js";
import { repoDirForFactionName, SHARED_ROSTERS } from "./faction-map.js";
import { CORE_DIR } from "./repo-files.js";

export interface MintedWeapon {
  /** Faction directory the weapon is filed under (the weapons.json owner). */
  dir: string;
  weapon: WeaponRecord;
  /** Dump name of the enhancement or wargear item that owns the profile. */
  source: string;
}

export interface WeaponRefusal {
  source: string;
  reason: string;
}

export interface WeaponMintResult {
  minted: MintedWeapon[];
  refusals: WeaponRefusal[];
}

export interface MintOptions {
  /** Whether `data/core/<dir>/weapons.json` exists. Injected by tests; defaults to the repo tree. */
  hasWeaponsFile?: (dir: string) => boolean;
}

/** Wargear items of the four drone datasheets that print a weapon profile, filed under tau-empire. */
export const DRONE_WARGEAR_ITEMS: readonly { item: string; dir: string }[] = [
  { item: "7b869f23-60c0-4d2a-8d4d-b6dbe9fff367", dir: "tau-empire" },
  { item: "21d80668-7582-4409-af0a-dd65c1292ff9", dir: "tau-empire" },
  { item: "189ee391-f402-4ad1-a044-2106662c7948", dir: "tau-empire" },
  { item: "e63aac10-6f51-4d7d-afff-4ef394b32978", dir: "tau-empire" },
];

const defaultHasWeaponsFile = (dir: string): boolean => existsSync(path.join(CORE_DIR, dir, "weapons.json"));

/**
 * The directory whose weapons.json receives entities for a faction directory: the faction's own
 * file when it has one, else its first shared-roster parent (deathwatch files under adeptus-astartes).
 */
export function weaponsDirFor(dir: string, hasWeaponsFile: (dir: string) => boolean): string | null {
  if (hasWeaponsFile(dir)) return dir;
  const parent = SHARED_ROSTERS[dir]?.[0];
  return parent && hasWeaponsFile(parent) ? parent : null;
}

/** Why a dump keyword cannot be stored as printed, or null when the catalog carries it. */
function keywordRefusal(ctx: MintContext, profileId: string): string | null {
  const { dump } = ctx;
  const abilitiesById = dump.byId("wargear_ability");
  for (const link of dump.groupBy("wargear_item_profile_wargear_ability", "wargearItemProfileId").get(profileId) ?? []) {
    const name = dump.enName(abilitiesById.get(link.wargearAbilityId));
    if (!name) continue;
    const mapped = mapWeaponKeyword(name);
    if (!mapped) return `keyword "${name}" has no catalog entry`;
    if (/[\d:]/.test(name) && mapped.some((keyword) => keyword.parameters === undefined)) {
      return `keyword "${name}" prints a rating or qualifier the catalog cannot store`;
    }
  }
  return null;
}

/** The single profile of a wargear item, or a refusal reason. */
function singleProfileId(ctx: MintContext, itemId: string): { id: string } | { reason: string } {
  const profiles = ctx.dump.groupBy("wargear_item_profile", "wargearItemId").get(itemId) ?? [];
  if (profiles.length !== 1) return { reason: `wargear item has ${profiles.length} profiles, expected 1` };
  return { id: profiles[0]!.id };
}

/**
 * Mint one weapon from a wargear item. Returns the weapon, or the reason it was refused.
 * `name` is the weapon name; `id` is the repo entity id.
 */
function mintFromItem(
  ctx: MintContext,
  itemId: string,
  id: string,
  name: string,
): { weapon: WeaponRecord } | { reason: string } {
  const item = ctx.dump.byId("wargear_item").get(itemId);
  if (!item) return { reason: "wargear item is missing from the dump" };
  const single = singleProfileId(ctx, itemId);
  if (!("id" in single)) return { reason: single.reason };
  const keyword = keywordRefusal(ctx, single.id);
  if (keyword) return { reason: keyword };
  const warnings: string[] = [];
  const weapon = mintWeapon({ dump: ctx.dump, gv: ctx.gv, warnings }, item, id, name);
  if (warnings.length > 0) return { reason: warnings.join("; ") };
  return { weapon };
}

/** Collect results, refusing a second record that would reuse an id already minted into a file. */
function collector(): { result: WeaponMintResult; add: (dir: string, source: string, outcome: { weapon: WeaponRecord } | { reason: string }) => void } {
  const result: WeaponMintResult = { minted: [], refusals: [] };
  const seen = new Set<string>();
  const add = (dir: string, source: string, outcome: { weapon: WeaponRecord } | { reason: string }): void => {
    if (!("weapon" in outcome)) {
      result.refusals.push({ source, reason: outcome.reason });
      return;
    }
    const key = `${dir}/${outcome.weapon.id}`;
    if (seen.has(key)) {
      result.refusals.push({ source, reason: `weapon id ${outcome.weapon.id} is already minted into ${dir}` });
      return;
    }
    seen.add(key);
    result.minted.push({ dir, weapon: outcome.weapon, source });
  };
  return { result, add };
}

/**
 * Mint the weapon of every enhancement that links to a wargear-item profile. Each weapon is named
 * after its enhancement and gets the id `<enhancement>-<detachment>`, so it cannot collide with a
 * same-named repo weapon of another stat line.
 */
export function mintEnhancementWeapons(ctx: MintContext, options: MintOptions = {}): WeaponMintResult {
  const { dump } = ctx;
  const hasWeaponsFile = options.hasWeaponsFile ?? defaultHasWeaponsFile;
  const { result, add } = collector();
  for (const link of dump.table("enhancement_wargear_item_profile")) {
    const enhancement = dump.byId("enhancement").get(link.enhancementId);
    const source = dump.enName(enhancement) ?? link.enhancementId;
    if (!enhancement) {
      add("", source, { reason: "enhancement row is missing from the dump" });
      continue;
    }
    const profile = dump.byId("wargear_item_profile").get(link.wargearItemProfileId);
    if (!profile) {
      add("", source, { reason: "linked wargear-item profile is missing from the dump" });
      continue;
    }
    const itemName = dump.enName(dump.byId("wargear_item").get(profile.wargearItemId));
    if (itemName !== source) {
      add("", source, { reason: `linked wargear item is named "${itemName ?? ""}", not the enhancement's name` });
      continue;
    }
    const factionName = dump.enName(dump.byId("faction_keyword").get(dump.factionKeywordOfDetachment(enhancement.detachmentId) ?? ""));
    const dir = repoDirForFactionName(factionName);
    const target = dir ? weaponsDirFor(dir, hasWeaponsFile) : null;
    if (!target) {
      add("", source, { reason: `faction "${factionName ?? ""}" has no weapons.json to file the weapon in` });
      continue;
    }
    const detachmentName = dump.enName(dump.byId("detachment").get(enhancement.detachmentId)) ?? "";
    const id = detachmentScopedId(source, detachmentName);
    add(target, source, mintFromItem(ctx, profile.wargearItemId, id, source));
  }
  return result;
}

/**
 * Mint the drone weapons in DRONE_WARGEAR_ITEMS. The weapon is named after its profile and gets
 * the id `<profile-name>-drone`, a suffix that keeps it apart from the repo's BS 4+ entities of the
 * same name.
 */
export function mintDroneWeapons(ctx: MintContext, items: readonly { item: string; dir: string }[] = DRONE_WARGEAR_ITEMS): WeaponMintResult {
  const { dump } = ctx;
  const { result, add } = collector();
  for (const { item, dir } of items) {
    const row = dump.byId("wargear_item").get(item);
    const source = dump.enName(row) ?? item;
    const single = singleProfileId(ctx, item);
    if (!("id" in single)) {
      add(dir, source, { reason: single.reason });
      continue;
    }
    const profileName = dump.enName(dump.byId("wargear_item_profile").get(single.id)) ?? source;
    add(dir, source, mintFromItem(ctx, item, `${nameToId(profileName)}-drone`, profileName));
  }
  return result;
}
