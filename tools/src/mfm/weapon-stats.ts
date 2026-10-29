/**
 * weapon-stats.ts — reconcile every unit's weapons with the wargear items its MFM datasheet
 * fields: profile names, ranges, stats, parser-derived keywords and Hunter target restrictions.
 *
 * Each repo unit resolves to its dump datasheet; each weapon the unit references is matched by
 * name to one item that datasheet fields, and that item is minted ({@link mintWeapon}). The minted
 * profiles replace the repo profiles, except that keyword details the dump does not carry (the
 * repo-authored parameters the weapon mapping lists, such as `required_target_keywords_any` or
 * battle-size ratings) carry over to the aligned profile. A weapon whose repo-authored details
 * cannot be placed on a minted profile is refused, never overwritten.
 *
 * A weapon id several units share keeps one entry. When those units' datasheets field different
 * stat lines, the id keeps the line most of them field (its current line when one of them does),
 * and every other unit gets a `${id}-${unitId}` variant, with its references rewired, as
 * {@link runWeaponVariants} does for duplicate ids. Dry-run by default; `--write` routes the
 * projected files through {@link applyWrites}.
 *
 * @packageDocumentation
 */
import * as path from "path";
import { MfmDump } from "./loader.js";
import { readJsonArray, CORE_DIR } from "./repo-files.js";
import { findDatasheet } from "./project-loadout.js";
import { mintWeapon, type WeaponProfile, type WeaponRecord } from "./gear-projection.js";
import { wargearItemsForDatasheet } from "./wargear.js";
import { rewireComp, rewireOption, rewireUnit, weaponFp, type CoreWeapon } from "./weapon-variants.js";
import { nameToId } from "../converters/id-generator.js";
import { addExternalRef } from "../external-refs.js";
import { repoDirs } from "./faction-map.js";
import type { StagedWrite } from "./apply.js";
import { currentGameVersion } from "./dataslate.js";

type Keyword = NonNullable<WeaponProfile["keywords"]>[number];
type Profile = WeaponProfile & { target_restrictions?: { required_keywords_any?: string[]; excluded_keywords?: string[] } };

export interface UnitRow {
  id: string;
  weapon_ids?: string[];
  wargear_budgets?: { items: string[]; [k: string]: unknown }[];
  wargear_costs?: { item_id: string; [k: string]: unknown }[];
  [k: string]: unknown;
}
export interface CompRow {
  unit_id: string;
  models?: { default_weapon_ids?: string[]; loadout_variants?: { weapon_ids: string[]; [k: string]: unknown }[]; [k: string]: unknown }[];
  [k: string]: unknown;
}
export interface OptionRow {
  unit_id: string;
  replaces?: string[];
  replacement?: string[];
  replacement_choice?: string[][];
  [k: string]: unknown;
}

export interface ReconcileInput {
  weapons: CoreWeapon[];
  units: UnitRow[];
  comps: CompRow[];
  options: OptionRow[];
  /** The weapons each unit's datasheet fields, minted from the dump; absent for units without one. */
  dumpWeapons: ReadonlyMap<string, readonly WeaponRecord[]>;
}

export interface ReconcileResult {
  weapons: CoreWeapon[];
  units: UnitRow[];
  comps: CompRow[];
  options: OptionRow[];
  /** Weapon ids whose entry changed in place. */
  updated: string[];
  /** Variant ids added, each for one unit. */
  variants: string[];
  /** Weapons left unchanged because reconciling them would lose repo-authored detail or is ambiguous. */
  refusals: string[];
  /** Units that reference a changed id but have no datasheet to confirm the new line. */
  unconfirmed: string[];
}

/** Parameters the MFM keyword parser derives; anything else on a keyword is repo-authored. */
const PARSED_PARAMETERS = new Set(["target_keyword", "threshold", "value", "required_target_keywords_any", "excluded_target_keywords"]);

function isRepoAuthored(keyword: Keyword): boolean {
  return Object.entries(keyword.parameters ?? {}).some(([key, value]) =>
    !PARSED_PARAMETERS.has(key) || (key === "value" && typeof value === "object" && value !== null));
}

/** Whether a repo keyword is the minted one with repo-authored detail added. */
function extends_(repo: Keyword, minted: Keyword): boolean {
  if (repo.keyword_id !== minted.keyword_id) return false;
  return [...new Set([...PARSED_PARAMETERS, ...Object.keys(minted.parameters ?? {})])].every((key) => {
    const want = minted.parameters?.[key];
    const have = repo.parameters?.[key];
    if (want === undefined) return true;
    // A repo-authored rating replaces the printed flat one.
    if (key === "value" && typeof have === "object" && have !== null) return true;
    return JSON.stringify(have) === JSON.stringify(want);
  });
}

const profileKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The repo weapon's profiles replaced by the minted ones, carrying repo-authored keyword detail
 * and target exclusions to the aligned profile. Profiles align by name, else by position when the
 * counts match, else a single repo profile aligns with the minted profile of the weapon's name.
 * Undefined, with the reason, when repo-authored detail would be lost.
 */
export function mergeProfiles(repo: CoreWeapon, minted: WeaponRecord): { profiles: Profile[] } | { refusal: string } {
  const repoProfiles = repo.profiles as Profile[];
  const aligned = new Map<number, Profile>();
  minted.profiles.forEach((profile, index) => {
    // Profiles sharing a name (a ranged and a melee "Warblade") align in order.
    const taken = new Set(aligned.values());
    const byName = repoProfiles.find((candidate) => !taken.has(candidate) &&
      (profileKey(candidate.name) === profileKey(profile.name) || profileKey(candidate.name).endsWith(` ${profileKey(profile.name)}`)));
    if (byName) aligned.set(index, byName);
    else if (repoProfiles.length === minted.profiles.length) aligned.set(index, repoProfiles[index]);
    else if (repoProfiles.length === 1 && profileKey(profile.name) === profileKey(repo.name)) aligned.set(index, repoProfiles[0]);
  });
  const used = new Set(aligned.values());
  for (const profile of repoProfiles) {
    if (used.has(profile)) continue;
    if ((profile.keywords ?? []).some(isRepoAuthored) || profile.target_restrictions?.excluded_keywords) {
      return { refusal: `profile "${profile.name}" carries repo-authored detail and matches no dump profile` };
    }
  }
  const profiles: Profile[] = [];
  for (const [index, profile] of (minted.profiles as Profile[]).entries()) {
    const old = aligned.get(index);
    const keywords: Keyword[] = (profile.keywords ?? []).map((keyword) =>
      old?.keywords?.find((candidate) => isRepoAuthored(candidate) && extends_(candidate, keyword)) ?? keyword);
    for (const keyword of old?.keywords ?? []) {
      if (!isRepoAuthored(keyword) || keywords.includes(keyword)) continue;
      return { refusal: `profile "${old!.name}" keyword ${keyword.keyword_id} carries repo-authored detail the dump profile lacks` };
    }
    const restrictions = { ...profile.target_restrictions, ...(old?.target_restrictions?.excluded_keywords ? { excluded_keywords: old.target_restrictions.excluded_keywords } : {}) };
    profiles.push({
      ...profile,
      keywords,
      ...(Object.keys(restrictions).length > 0 ? { target_restrictions: restrictions } : {}),
    });
  }
  return { profiles };
}

/** Fingerprint including target restrictions, which {@link weaponFp} leaves out. */
function lineFp(profiles: readonly Profile[]): string {
  return JSON.stringify([weaponFp(profiles as WeaponProfile[]), profiles.map((profile) => profile.target_restrictions ?? null)]);
}

/** Every weapon id a unit references. */
function references(unit: UnitRow, comps: readonly CompRow[], options: readonly OptionRow[]): Set<string> {
  const ids = new Set<string>(unit.weapon_ids ?? []);
  for (const budget of unit.wargear_budgets ?? []) for (const id of budget.items) ids.add(id);
  for (const cost of unit.wargear_costs ?? []) ids.add(cost.item_id);
  for (const comp of comps) {
    if (comp.unit_id !== unit.id) continue;
    for (const model of comp.models ?? []) {
      for (const id of model.default_weapon_ids ?? []) ids.add(id);
      for (const variant of model.loadout_variants ?? []) for (const id of variant.weapon_ids) ids.add(id);
    }
  }
  for (const option of options) {
    if (option.unit_id !== unit.id) continue;
    for (const id of [...(option.replaces ?? []), ...(option.replacement ?? []), ...(option.replacement_choice ?? []).flat()]) ids.add(id);
  }
  return ids;
}

/** Reconcile one faction directory's weapons with the dump weapons its units field. */
export function reconcileWeaponStats(input: ReconcileInput): ReconcileResult {
  const weapons = input.weapons.map((weapon) => ({ ...weapon }));
  let units = input.units;
  let comps = input.comps;
  let options = input.options;
  const byId = new Map(weapons.map((weapon) => [weapon.id, weapon]));
  const refusals: string[] = [];
  // weapon id → line fingerprint → { profiles, minted, units }
  const claims = new Map<string, Map<string, { profiles: Profile[]; minted: WeaponRecord; units: string[] }>>();
  const referencedBy = new Map<string, string[]>();

  for (const unit of [...input.units].sort((a, b) => a.id.localeCompare(b.id))) {
    const refs = references(unit, input.comps, input.options);
    for (const id of refs) (referencedBy.get(id) ?? referencedBy.set(id, []).get(id)!).push(unit.id);
    const fielded = input.dumpWeapons.get(unit.id);
    if (!fielded) continue;
    const byName = new Map<string, WeaponRecord[]>();
    for (const minted of fielded) (byName.get(profileKey(minted.name)) ?? byName.set(profileKey(minted.name), []).get(profileKey(minted.name))!).push(minted);
    for (const id of [...refs].sort()) {
      const repo = byId.get(id);
      if (!repo) continue;
      const key = profileKey(repo.name);
      // A datasheet prints a twin or a squad's weapon in the singular or plural ("Bolt Rifle(s)").
      const candidates = byName.get(key) ?? byName.get(key.replace(/s$/, "")) ?? byName.get(`${key}s`) ?? [];
      if (candidates.length === 0) continue;
      const merged = candidates.map((minted) => ({ minted, result: mergeProfiles(repo, minted) }));
      const lines = new Map<string, { profiles: Profile[]; minted: WeaponRecord }>();
      for (const { minted, result } of merged) {
        if ("refusal" in result) {
          refusals.push(`${unit.id}: ${id}: ${result.refusal}`);
          continue;
        }
        lines.set(lineFp(result.profiles), { profiles: result.profiles, minted });
      }
      if (lines.size !== 1) {
        if (lines.size > 1) refusals.push(`${unit.id}: ${id}: the datasheet fields ${lines.size} different "${repo.name}" items`);
        continue;
      }
      const [[fp, line]] = [...lines];
      const forId = claims.get(id) ?? claims.set(id, new Map()).get(id)!;
      (forId.get(fp) ?? forId.set(fp, { ...line, units: [] }).get(fp)!).units.push(unit.id);
    }
  }

  const updated: string[] = [];
  const variants: string[] = [];
  const unconfirmed: string[] = [];
  for (const [id, lines] of [...claims].sort(([a], [b]) => a.localeCompare(b))) {
    const repo = byId.get(id)!;
    const current = lineFp(repo.profiles as Profile[]);
    const ranked = [...lines].sort(([fpA, a], [fpB, b]) =>
      Number(fpB === current) - Number(fpA === current) || b.units.length - a.units.length || a.units[0].localeCompare(b.units[0]));
    // The bare id changes line only when every unit referencing it confirms the new one; a unit
    // whose datasheet is silent on it keeps the current line, so the claimants take variants.
    const confirmed = new Set([...lines.values()].flatMap((line) => line.units));
    const silent = (referencedBy.get(id) ?? []).filter((unitId) => !confirmed.has(unitId));
    const keepCurrent = ranked[0][0] !== current && silent.length > 0;
    const [[keeperFp, keeper], ...rest] = ranked;
    const others = keepCurrent ? ranked : rest;
    if (keepCurrent) {
      for (const unitId of silent) unconfirmed.push(`${unitId}: ${id}`);
    } else if (keeperFp !== current) {
      repo.profiles = keeper.profiles as CoreWeapon["profiles"];
      repo.type = keeper.minted.type;
      for (const ref of keeper.minted.external_refs) addExternalRef(repo, ref.namespace, ref.id);
      updated.push(id);
    }
    for (const [, line] of others) {
      for (const unitId of line.units) {
        const variantId = `${id}-${unitId}`;
        const rename = new Map([[id, variantId]]);
        const existing = byId.get(variantId);
        if (existing && lineFp(existing.profiles as Profile[]) !== lineFp(line.profiles)) {
          refusals.push(`${unitId}: ${id}: variant id ${variantId} already exists with another line`);
          continue;
        }
        if (existing) {
          // The unit's own variant already carries this line: point its remaining bare references at it.
          units = units.map((unit) => (unit.id === unitId ? rewireUnit(unit, rename) : unit));
          comps = comps.map((comp) => (comp.unit_id === unitId ? rewireComp(comp, rename) : comp));
          options = options.map((option) => (option.unit_id === unitId ? rewireOption(option, rename) : option));
          continue;
        }
        const variant: CoreWeapon = { ...repo, id: variantId, type: line.minted.type, profiles: line.profiles as CoreWeapon["profiles"], external_refs: [...(repo.external_refs ?? [])] };
        for (const ref of line.minted.external_refs) addExternalRef(variant, ref.namespace, ref.id);
        weapons.push(variant);
        byId.set(variantId, variant);
        variants.push(variantId);
        units = units.map((unit) => (unit.id === unitId ? rewireUnit(unit, rename) : unit));
        comps = comps.map((comp) => (comp.unit_id === unitId ? rewireComp(comp, rename) : comp));
        options = options.map((option) => (option.unit_id === unitId ? rewireOption(option, rename) : option));
      }
    }
  }
  return { weapons, units, comps, options, updated, variants, refusals, unconfirmed };
}

export interface WeaponStatsReport {
  dirs: { dir: string; updated: string[]; variants: string[]; refusals: string[]; unconfirmed: string[]; warnings: string[] }[];
  staged: StagedWrite[];
}

/** The weapons each unit's datasheet fields, minted from the dump. */
function dumpWeaponsFor(dump: MfmDump, dir: string, units: readonly UnitRow[], warnings: string[]): Map<string, WeaponRecord[]> {
  const out = new Map<string, WeaponRecord[]>();
  for (const unit of units) {
    const datasheet = findDatasheet(dump, unit.id, dir);
    if (!datasheet) continue;
    const ctx = { dump, gv: (unit.game_version as WeaponRecord["game_version"] | undefined) ?? currentGameVersion(dump), warnings: [] as string[] };
    const minted: WeaponRecord[] = [];
    // A limited-choice bundle can name an older item that shares a name with the one the
    // datasheet's loadout fields (Strike Squad's "Close combat weapon" beside a Psilencer): the
    // loadout's item is the datasheet's line, and the bundle names that weapon, not a second one.
    const primary = new Set(wargearItemsForDatasheet(dump, datasheet.id, { includeLimited: false }).map((item) => item.id));
    const primaryNames = new Set(wargearItemsForDatasheet(dump, datasheet.id, { includeLimited: false })
      .map((item) => dump.enName(item)?.toLowerCase()).filter((name): name is string => !!name));
    for (const item of wargearItemsForDatasheet(dump, datasheet.id)) {
      if (item.wargearType !== "weapon") continue;
      const name = dump.enName(item);
      if (!name) continue;
      if (!primary.has(item.id) && primaryNames.has(name.toLowerCase())) continue;
      try {
        minted.push(mintWeapon(ctx, item, nameToId(name), name));
      } catch (error) {
        warnings.push(`${unit.id}: could not mint "${name}": ${(error as Error).message}`);
      }
    }
    for (const warning of ctx.warnings) warnings.push(`${unit.id}: ${warning}`);
    out.set(unit.id, minted);
  }
  return out;
}

/** Build the reconcile projection for one or every faction dir. */
export function runWeaponStats(dump: MfmDump, onlyDir?: string): WeaponStatsReport {
  const staged: StagedWrite[] = [];
  const dirs: WeaponStatsReport["dirs"] = [];
  for (const dir of [...repoDirs()].filter((d) => !onlyDir || d === onlyDir).sort()) {
    const files = {
      weapons: path.join(CORE_DIR, dir, "weapons.json"),
      units: path.join(CORE_DIR, dir, "units.json"),
      comps: path.join(CORE_DIR, dir, "unit-compositions.json"),
      options: path.join(CORE_DIR, dir, "wargear-options.json"),
    };
    const weapons = readJsonArray<CoreWeapon>(files.weapons);
    if (weapons.length === 0) continue;
    const units = readJsonArray<UnitRow>(files.units);
    const comps = readJsonArray<CompRow>(files.comps);
    const options = readJsonArray<OptionRow>(files.options);
    const warnings: string[] = [];
    const result = reconcileWeaponStats({ weapons, units, comps, options, dumpWeapons: dumpWeaponsFor(dump, dir, units, warnings) });
    const changed = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after);
    if (changed(weapons, result.weapons)) staged.push({ path: files.weapons, value: result.weapons });
    if (changed(units, result.units)) staged.push({ path: files.units, value: result.units });
    if (changed(comps, result.comps)) staged.push({ path: files.comps, value: result.comps });
    if (changed(options, result.options)) staged.push({ path: files.options, value: result.options });
    dirs.push({ dir, updated: result.updated, variants: result.variants, refusals: result.refusals, unconfirmed: result.unconfirmed, warnings });
  }
  return { dirs, staged };
}

/** Render the dry-run/applied report as markdown. */
export function buildWeaponStatsReport(report: WeaponStatsReport): string {
  const lines = ["# MFM weapon stats reconcile", ""];
  const total = (key: "updated" | "variants" | "refusals" | "unconfirmed") => report.dirs.reduce((sum, dir) => sum + dir[key].length, 0);
  lines.push(`Updated in place ${total("updated")}, variants added ${total("variants")}, refused ${total("refusals")}, unconfirmed references ${total("unconfirmed")}.`, "");
  for (const dir of report.dirs) {
    if (dir.updated.length + dir.variants.length + dir.refusals.length + dir.unconfirmed.length === 0) continue;
    lines.push(`## ${dir.dir}`, "");
    if (dir.updated.length) lines.push(`- updated: ${dir.updated.join(", ")}`);
    if (dir.variants.length) lines.push(`- variants: ${dir.variants.join(", ")}`);
    for (const refusal of dir.refusals) lines.push(`- refused: ${refusal}`);
    for (const reference of dir.unconfirmed) lines.push(`- unconfirmed: ${reference}`);
    lines.push("");
  }
  return lines.join("\n");
}
