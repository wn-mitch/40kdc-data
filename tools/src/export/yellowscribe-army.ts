/**
 * Yellowscribe army data (`yellowscribeArmy`): a {@link Roster} lowered to the
 * 11th-edition `armyData` that Yellowscribe's Tabletop Simulator mod loads from
 * `GET /get_army_by_id` (github.com/ThePants999/Yellowscribe,
 * `bin/10e11eDataModel.js`). The `.ros` serializer in `yellowscribe.ts` feeds
 * Yellowscribe's own uploader; this module skips that hop so a server can hand
 * the mod an army directly.
 *
 * Shape per unit (keyed by an 8-hex `uuid`, listed in `order`):
 * - `abilities` maps a name to `{name, desc}`. Core and Faction abilities
 *   collapse into one `Core` and one `Faction` entry whose `desc` lists their
 *   names, as Yellowscribe does.
 * - `models.models` maps a 16-hex key to a stack of identically equipped
 *   models: `{name, abilities, weapons: [{name, number}], number}`, where
 *   `number` on a weapon is per model.
 * - `modelProfiles` maps a profile name to `{name, m, t, sv, w, ld, oc, insv?}`.
 * - `weapons` maps a weapon name to its stat line; a weapon with several
 *   profiles contributes one entry per profile.
 *
 * Ability text comes from the DSL describer ({@link AbilityView.describe}); no
 * rules prose is emitted. Keys are derived from roster positions, so the same
 * roster always produces the same output.
 */
import { abilityRefId, abilityRefValue, abilityRefWargear } from "../data/ability-refs.js";
import type { Dataset } from "../data/dataset.js";
import type { UnitView, WeaponView } from "../data/entities.js";
import { resolveRosterUnit } from "../data/roster-resolve.js";
import type { Roster, RosterLoadoutGroup, RosterUnit, RosterWargear } from "../import/types.js";
import { fmtMove, fmtTarget, keywordLabel } from "./yellowscribe.js";

export interface YellowscribeAbility {
  name: string;
  desc: string;
}

export interface YellowscribeModel {
  name: string;
  abilities: string[];
  weapons: { name: string; number: number }[];
  number: number;
}

export interface YellowscribeProfile {
  name: string;
  m: string;
  t: string;
  sv: string;
  w: string;
  ld: string;
  oc: string;
  insv?: string;
}

export interface YellowscribeWeapon {
  name: string;
  range: string;
  a: string;
  bsws: string;
  s: string;
  ap: string;
  d: string;
  number: number;
  abilities: string;
  shortAbilities: string;
}

export interface YellowscribeUnit {
  name: string;
  factionKeywords: string[];
  keywords: string[];
  abilities: Record<string, YellowscribeAbility>;
  models: { models: Record<string, YellowscribeModel>; totalNumberOfModels: number };
  modelProfiles: Record<string, YellowscribeProfile>;
  weapons: Record<string, YellowscribeWeapon>;
  rules: string[];
  uuid: string;
  unassignedWeapons: never[];
  isSingleModel: boolean;
}

export interface YellowscribeArmy {
  edition: "11e";
  order: string[];
  units: Record<string, YellowscribeUnit>;
  /** Roster units left out because they don't resolve to a datasheet, by roster name. */
  skipped: string[];
}

const hex = (n: number, width: number): string => n.toString(16).padStart(width, "0");

function resolveWeapon(w: RosterWargear, dataset: Dataset, factionId: string): WeaponView | undefined {
  const id = w.ref.id;
  if (id === null) return undefined;
  return dataset.weapons.getInFaction(id, factionId) ?? dataset.weapons.getAny(id);
}

/** The datasheet's stat lines, keyed by profile name. */
function modelProfiles(view: UnitView): Record<string, YellowscribeProfile> {
  const out: Record<string, YellowscribeProfile> = {};
  view.raw.profiles.forEach((p, i) => {
    const name = p.name ?? (i === 0 ? view.name : `${view.name} (${i + 1})`);
    const profile: YellowscribeProfile = {
      name,
      m: fmtMove(p.M),
      t: String(p.T),
      sv: fmtTarget(p.Sv),
      w: String(p.W),
      ld: fmtTarget(p.Ld),
      oc: String(p.OC),
    };
    if (p.invuln_sv !== undefined && p.invuln_sv !== null) profile.insv = fmtTarget(p.invuln_sv);
    out[name] = profile;
  });
  return out;
}

/** The unit's abilities: those its datasheet prints (wargear abilities only when the wargear is taken) plus its enhancement. */
function unitAbilities(unit: RosterUnit, view: UnitView, dataset: Dataset): Record<string, YellowscribeAbility> {
  const taken = new Set(unit.wargear.map((w) => w.ref.id).concat((unit.loadout_groups ?? []).flatMap((g) => g.wargear.map((w) => w.ref.id))));
  const core: string[] = [];
  const faction: string[] = [];
  const out: Record<string, YellowscribeAbility> = {};
  for (const ref of view.raw.ability_ids ?? []) {
    const wargear = abilityRefWargear(ref);
    if (wargear !== undefined && !taken.has(wargear)) continue;
    const ability = dataset.abilities.get(abilityRefId(ref));
    if (!ability) continue;
    const rating = abilityRefValue(ref);
    const name = rating === undefined ? ability.name : `${ability.name} ${String(rating)}`;
    if (ability.raw.ability_type === "core") core.push(name);
    else if (ability.raw.ability_type === "faction") faction.push(name);
    else out[name] = { name, desc: ability.describe() };
  }
  const enhancement = unit.enhancement?.id ? dataset.enhancements.get(unit.enhancement.id) : undefined;
  if (enhancement) {
    const ability = enhancement.ability_id ? dataset.abilities.get(enhancement.ability_id) : undefined;
    out[enhancement.name] = { name: enhancement.name, desc: ability ? ability.describe() : "Enhancement" };
  }
  if (faction.length > 0) out.Faction = { name: "Faction", desc: faction.join(", ") };
  if (core.length > 0) out.Core = { name: "Core", desc: core.join(", ") };
  return out;
}

/** One weapon profile's stat line. */
function weaponLine(weapon: WeaponView, i: number, name: string): YellowscribeWeapon {
  const ranged = weapon.raw.type === "ranged";
  const p = weapon.profileAt(i);
  const skill = ranged ? p.stats.BS : p.stats.WS;
  const keywords = weapon.keywordsAt(i).map((k) => keywordLabel(k.keyword.name, k.parameters)).join(", ");
  const abilities = keywords === "" ? "-" : keywords;
  return {
    name,
    range: !ranged ? "Melee" : p.range === "N/A" ? "N/A" : fmtMove(p.range ?? 0),
    a: String(p.stats.A),
    bsws: typeof skill === "number" ? fmtTarget(skill) : "N/A",
    s: String(p.stats.S),
    ap: String(p.stats.AP),
    d: String(p.stats.D),
    number: 1,
    abilities,
    shortAbilities: abilities,
  };
}

/** Registers each of the weapon's profiles in `weapons` under a name unique within the unit, returning those names. */
function profileNames(weapon: WeaponView, weapons: Record<string, YellowscribeWeapon>, owners: Map<string, string>): string[] {
  return weapon.raw.profiles.map((profile, i) => {
    const base = weapon.raw.profiles.length > 1 && profile.name !== weapon.name ? `${weapon.name} - ${profile.name}` : weapon.name;
    const owner = `${weapon.id}#${i}`;
    let name = base;
    if (owners.has(name) && owners.get(name) !== owner) name = `${base} (${weapon.raw.type})`;
    for (let n = 2; owners.has(name) && owners.get(name) !== owner; n++) name = `${base} (${n})`;
    owners.set(name, owner);
    weapons[name] = weaponLine(weapon, i, name);
    return name;
  });
}

/**
 * The unit's model stacks. A loadout group is one stack; without groups the flat
 * wargear totals are spread evenly, and each item left over goes to a model split
 * out of the main stack and named after it.
 */
function stacks(unit: RosterUnit, view: UnitView): RosterLoadoutGroup[] {
  if (unit.loadout_groups && unit.loadout_groups.length > 0) return unit.loadout_groups;
  const count = Math.max(unit.model_count, 1);
  const base: RosterWargear[] = [];
  const extras: RosterWargear[] = [];
  for (const w of unit.wargear) {
    const each = Math.floor(w.count / count);
    if (each > 0) base.push({ ...w, count: each });
    for (let r = 0; r < w.count % count; r++) extras.push({ ...w, count: 1 });
  }
  const split: RosterLoadoutGroup[] = [];
  extras.forEach((w, i) => {
    if (i < count - 1 || split.length === 0) split.push({ model_name: `${view.name} w/ ${w.ref.raw_name}`, count: 1, wargear: [...base, w] });
    else split[(i - (count - 1)) % split.length]!.wargear.push(w);
  });
  const rest = count - split.length;
  return rest > 0 ? [{ model_name: null, count: rest, wargear: base }, ...split] : split;
}

function armyUnit(unit: RosterUnit, uuid: string, view: UnitView, dataset: Dataset): YellowscribeUnit {
  const abilities = unitAbilities(unit, view, dataset);
  const abilityNames = Object.keys(abilities);
  const weapons: Record<string, YellowscribeWeapon> = {};
  const owners = new Map<string, string>();
  const models: Record<string, YellowscribeModel> = {};
  let total = 0;
  stacks(unit, view).forEach((group, gi) => {
    const carried = new Map<string, number>();
    for (const w of group.wargear) {
      const weapon = resolveWeapon(w, dataset, view.factionId);
      if (!weapon) continue;
      for (const name of profileNames(weapon, weapons, owners)) carried.set(name, (carried.get(name) ?? 0) + w.count);
    }
    models[`${uuid}${hex(gi, 8)}`] = {
      name: group.model_name ?? view.name,
      abilities: abilityNames,
      weapons: [...carried].map(([name, number]) => ({ name, number })),
      number: group.count,
    };
    total += group.count;
  });
  const keywords = [...view.keywords, ...(unit.keyword_overrides ?? []).filter((k) => !view.keywords.includes(k))];
  if (unit.is_warlord) keywords.push("Warlord");
  return {
    name: view.name,
    factionKeywords: [...view.factionKeywords],
    keywords,
    abilities,
    models: { models, totalNumberOfModels: total },
    modelProfiles: modelProfiles(view),
    weapons,
    rules: [],
    uuid,
    unassignedWeapons: [],
    isSingleModel: total === 1,
  };
}

/** The roster as Yellowscribe 11e army data. Units that don't resolve to a datasheet are listed in `skipped`. */
export function yellowscribeArmy(roster: Roster, dataset: Dataset): YellowscribeArmy {
  const order: string[] = [];
  const units: Record<string, YellowscribeUnit> = {};
  const skipped: string[] = [];
  roster.units.forEach((unit, i) => {
    const view = resolveRosterUnit(unit, dataset, roster.faction_id);
    if (!view) {
      skipped.push(unit.ref.raw_name);
      return;
    }
    const uuid = hex(i + 1, 8);
    order.push(uuid);
    units[uuid] = armyUnit(unit, uuid, view, dataset);
  });
  return { edition: "11e", order, units, skipped };
}
