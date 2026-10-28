/**
 * Weapons a unit's wargear equips its bearers with, for damage scoring.
 *
 * A wargear item such as a drone grants weapons in two ways: its own printed rule (an
 * `ability_ids` entry `{id, wargear}` whose effect grants the weapon to "this model"), and
 * rules gated on the item (a `unit-wargear` condition around a weapon grant). Either way each
 * model carrying the item is equipped with the granted weapon. Several rules can describe the
 * same equipment (the item's own rule and army rules restating it), so one rule owns each item's
 * grants: the item's printed rule when the unit lists one, else the lowest ability id. An item's
 * printed rule applies only while the loadout includes the item.
 */
import type { Buff, BuffSource, EngineContext } from "../cruncher/index.js";
import type { Dataset } from "../data/dataset.js";
import { abilityRefId, abilityRefWargear } from "../data/ability-refs.js";
import { baseLoadout, type LoadoutModel } from "../data/loadout.js";
import type { AbilityView } from "../data/entities.js";
import type { Unit } from "../generated.js";
import { resolveUnitWeapon } from "./unit-damage.js";

/** The reason the translator gives a weapon grant it hands back to the caller. */
export const WEAPON_GRANT_REASON = 'effect type "weapon-grant" is not modelled by the buff layer';

/** One granted weapon: `perBearer` copies on each of the `wargearId` carriers. */
export interface WeaponGrant {
  abilityId: string;
  wargearId: string;
  weaponId: string;
  perBearer: number;
}

/** A grant for an item whose grants another rule owns. */
export interface DuplicateGrant extends WeaponGrant {
  /** The rule whose grants for the item are scored. */
  ownerAbilityId: string;
}

export interface WeaponGrants {
  /** The grants scored: every grant of each item's owning rule. */
  grants: WeaponGrant[];
  duplicates: DuplicateGrant[];
}

/** The wargear item whose printed rule each of the unit's `{id, wargear}` ability entries is. */
export function printedWargear(unit: Unit): Map<string, string> {
  const printed = new Map<string, string>();
  for (const ref of unit.ability_ids ?? []) {
    const wargear = abilityRefWargear(ref as Record<string, unknown>);
    if (wargear) printed.set(abilityRefId(ref as Record<string, unknown>), wargear);
  }
  return printed;
}

/** The unit's printed wargear rules whose item `counts` leaves out; they do not apply. */
export function unequippedRules(unit: Unit, counts: ReadonlyMap<string, number>): Set<string> {
  return new Set([...printedWargear(unit)].flatMap(([abilityId, wargear]) => (counts.get(wargear) ?? 0) > 0 ? [] : [abilityId]));
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const SELF_SUBJECTS = new Set([undefined, null, "this-unit", "this-model", "ability-unit"]);

/** Wargear items a condition requires the ability's own unit to carry: the item itself, or `and` operands. */
function requiredWargear(condition: unknown): string[] {
  if (!isObject(condition)) return [];
  if (condition.operator === "and" && Array.isArray(condition.operands)) return condition.operands.flatMap(requiredWargear);
  if (condition.type !== "unit-wargear" || !isObject(condition.parameters)) return [];
  const { subject, wargear, models } = condition.parameters;
  return SELF_SUBJECTS.has(subject as string) && typeof wargear === "string" && models === undefined ? [wargear] : [];
}

/**
 * The bearer-scoped weapon grants in an effect tree, by weapon id, with the wargear items their
 * enclosing conditions require. A weapon granted under different requirements maps to null.
 */
function grantGates(effect: unknown): Map<string, string[] | null> {
  const out = new Map<string, string[] | null>();
  const visit = (node: unknown, gates: readonly string[]): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, gates);
      return;
    }
    if (!isObject(node)) return;
    if (node.type === "weapon-grant") {
      const weaponId = isObject(node.modifier) ? node.modifier.weapon_id : undefined;
      if (node.target !== "this-model" || typeof weaponId !== "string") return;
      const previous = out.get(weaponId);
      const key = [...new Set(gates)].sort();
      out.set(weaponId, previous === undefined || (previous !== null && previous.join("|") === key.join("|")) ? key : null);
      return;
    }
    const inner = node.type === "conditional" ? [...gates, ...requiredWargear(node.condition)] : gates;
    for (const [key, value] of Object.entries(node)) if (key !== "condition") visit(value, inner);
  };
  visit(effect, []);
  return out;
}

/** Copies of the weapon each bearer gets: the grant's printed count, else one. */
function perBearer(fragment: Record<string, unknown>): number | null {
  const count = isObject(fragment.modifier) ? fragment.modifier.count : undefined;
  if (count === undefined) return 1;
  return Number.isInteger(count) && (count as number) > 0 ? count as number : null;
}

/**
 * The wargear of a unit's loadout: equipment ids that name a wargear record rather than one of
 * the unit's weapons, with how many models carry each.
 */
export function loadoutWargear(dataset: Dataset, unit: Unit, counts: ReadonlyMap<string, number>): Record<string, number> {
  const wargear: Record<string, number> = {};
  for (const [id, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    if (count > 0 && !resolveUnitWeapon(dataset, unit, id) && dataset.wargear.has(id)) wargear[id] = count;
  }
  return wargear;
}

/** The wargear of a unit's out-of-the-box loadout at `modelCount` models; see {@link loadoutWargear}. */
export function baseWargear(dataset: Dataset, unit: Unit, modelCount: number): Record<string, number> {
  const models = (dataset.unitCompositionOf(unit) as { models?: LoadoutModel[] } | undefined)?.models ?? [];
  return loadoutWargear(dataset, unit, baseLoadout(unit, modelCount, dataset.wargearOptionsOf(unit), models).counts);
}

/**
 * The live weapon grants of one translated ability. A grant is live when the translator reaches
 * it under `context`; its bearers are the carriers of the wargear its conditions require, or of
 * the wargear whose printed rule the ability is. A grant with no bearer item, or with conflicting
 * ones, is not scored.
 */
export function abilityWeaponGrants(
  ability: AbilityView,
  source: BuffSource,
  context: EngineContext,
  printedBy: string | undefined,
  rating?: string | number,
): WeaponGrant[] {
  const gates = grantGates(ability.raw.effect);
  const live = ability.describeBuffs(source, context, "attacker", rating).unsupported;
  const grants: WeaponGrant[] = [];
  for (const fragment of live) {
    const node = fragment.effectFragment;
    if (fragment.reason !== WEAPON_GRANT_REASON || !isObject(node) || !isObject(node.modifier)) continue;
    const weaponId = node.modifier.weapon_id;
    const copies = perBearer(node);
    const required = typeof weaponId === "string" ? gates.get(weaponId) : null;
    if (typeof weaponId !== "string" || copies === null || !required) continue;
    const items = [...new Set([...required, ...(printedBy ? [printedBy] : [])])];
    if (items.length !== 1 || grants.some((grant) => grant.weaponId === weaponId)) continue;
    grants.push({ abilityId: ability.id, wargearId: items[0], weaponId, perBearer: copies });
  }
  return grants;
}

/**
 * Every weapon the unit's loadout equips through its wargear, from its army rules and its own
 * abilities, under `context`, whose `attackerWargear` is the loadout's. A printed rule for an
 * item the loadout leaves out grants nothing. Each item's grants come from its owning rule; other
 * rules' grants for it are duplicates.
 */
export function unitWeaponGrants(dataset: Dataset, unit: Unit, factionId: string, context: EngineContext): WeaponGrants {
  const printed = printedWargear(unit);
  const candidates: Array<WeaponGrant & { printed: boolean }> = [];
  for (const entry of dataset.eligibleAbilities({ unitId: unit.id, factionId }, context.phase)) {
    if (entry.source.kind !== "army" && entry.source.kind !== "unit") continue;
    const printedBy = entry.source.kind === "unit" ? printed.get(entry.ability.id) : undefined;
    if (printedBy !== undefined && context.attackerWargear !== undefined && !((context.attackerWargear[printedBy] ?? 0) > 0)) continue;
    const source: BuffSource = { kind: "ability", abilityId: entry.ability.id, abilityKind: entry.source.kind };
    for (const grant of abilityWeaponGrants(entry.ability, source, context, printedBy, entry.rating)) {
      candidates.push({ ...grant, printed: printedBy === grant.wargearId });
    }
  }
  const owners = new Map<string, { abilityId: string; printed: boolean }>();
  for (const { abilityId, wargearId, printed: own } of candidates) {
    const owner = owners.get(wargearId);
    if (!owner || (own && !owner.printed) || (own === owner.printed && abilityId.localeCompare(owner.abilityId) < 0)) {
      owners.set(wargearId, { abilityId, printed: own });
    }
  }
  const result: WeaponGrants = { grants: [], duplicates: [] };
  const ordered = candidates.sort((left, right) => left.wargearId.localeCompare(right.wargearId) || left.abilityId.localeCompare(right.abilityId) || left.weaponId.localeCompare(right.weaponId));
  for (const { printed: _printed, ...grant } of ordered) {
    const owner = owners.get(grant.wargearId)!.abilityId;
    if (owner === grant.abilityId) result.grants.push(grant);
    else result.duplicates.push({ ...grant, ownerAbilityId: owner });
  }
  return result;
}

/** `context` with the wargear of the loadout `counts`, so `unit-wargear` conditions read the loadout. */
export function wargearContext(dataset: Dataset, unit: Unit, counts: ReadonlyMap<string, number>, context: EngineContext): EngineContext {
  return { ...context, attackerWargear: loadoutWargear(dataset, unit, counts) };
}

/**
 * `buffs` without those of the unit's own printed wargear rules whose item `counts` leaves out,
 * whether the rule reaches it as its own (`unit`) or back through its attached leader (`attached`
 * from this unit).
 */
export function equippedBuffs(unit: Unit, counts: ReadonlyMap<string, number>, buffs: readonly Buff[]): Buff[] {
  const unequipped = unequippedRules(unit, counts);
  if (unequipped.size === 0) return [...buffs];
  const own = (source: BuffSource): boolean => source.kind === "ability"
    && (source.abilityKind === "unit" || (source.abilityKind === "attached" && source.sourceUnitId === unit.id));
  return buffs.filter((buff) => !own(buff.source) || !unequipped.has((buff.source as { abilityId: string }).abilityId));
}

/** What a loadout's wargear changes about scoring it; see {@link loadoutWargearScoring}. */
export interface LoadoutWargearScoring {
  /** The caller's context with the loadout's wargear. */
  context: EngineContext;
  /** The weapons the wargear grants under {@link context}; pass `grants.grants` to `unitLoadoutDamage`. */
  grants: WeaponGrants;
  /** The shared buffs without the unit's printed rules for items the loadout leaves out. */
  buffs: Buff[];
}

/**
 * The wargear inputs to scoring one loadout, the way the damage matrix scores it: the weapons
 * the loadout's wargear grants and the shared `buffs` less the printed rules of items it leaves
 * out. The profiles still crunch under the caller's `context`, as the buffs were translated
 * without a loadout.
 */
export function loadoutWargearScoring(input: {
  dataset: Dataset;
  unit: Unit;
  factionId: string;
  counts: ReadonlyMap<string, number>;
  buffs: readonly Buff[];
  context: EngineContext;
}): LoadoutWargearScoring {
  const context = wargearContext(input.dataset, input.unit, input.counts, input.context);
  return {
    context,
    grants: unitWeaponGrants(input.dataset, input.unit, input.factionId, context),
    buffs: equippedBuffs(input.unit, input.counts, input.buffs),
  };
}

/** Equipment counts with each grant's weapons added for the carriers of its wargear. */
export function withGrantedWeapons(counts: ReadonlyMap<string, number>, grants: readonly WeaponGrant[]): Map<string, number> {
  const next = new Map(counts);
  for (const grant of grants) {
    const copies = (counts.get(grant.wargearId) ?? 0) * grant.perBearer;
    if (copies > 0) next.set(grant.weaponId, (next.get(grant.weaponId) ?? 0) + copies);
  }
  return next;
}

/** Per-model loadout groups with each grant's weapons added to the models carrying its wargear. */
export function groupsWithGrantedWeapons<G extends { count: number; weapons: readonly { id: string; count: number }[] }>(
  groups: readonly G[],
  grants: readonly WeaponGrant[],
): G[] {
  return groups.map((group) => {
    const weapons = new Map(group.weapons.map((weapon) => [weapon.id, weapon.count]));
    for (const grant of grants) {
      const copies = (weapons.get(grant.wargearId) ?? 0) * grant.perBearer;
      if (copies > 0) weapons.set(grant.weaponId, (weapons.get(grant.weaponId) ?? 0) + copies);
    }
    return { ...group, weapons: [...weapons].map(([id, count]) => ({ id, count })) };
  });
}
