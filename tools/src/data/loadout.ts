/**
 * Wargear-loadout maths shared by every consumer of the dataset: how many
 * models may take an option, what the maximal (take-every-swap) loadout looks
 * like, the valid count range for each weapon, and whether an edited loadout is
 * legal.
 *
 * The base loadout is derived, not stored: a weapon in `unit.weapon_ids` that
 * never appears as the *replacement* of any option is a **base** weapon, carried
 * by every model; a weapon that does appear as a replacement is **optional**,
 * carried only by the models that took the swap. This holds for uniform infantry
 * squads (every model shares the base loadout) and is exactly right for the
 * cases the corpus pins. Mirror of `crates/wh40kdc/src/data/loadout.rs`.
 *
 * @packageDocumentation
 */
import type { Unit, WargearOption } from "../generated.js";

/** Inclusive count range a single weapon/wargear id may take in a loadout. */
export interface WeaponBound {
  min: number;
  max: number;
}

/** A resolved loadout: entity id (weapon or wargear) → count across the unit. */
export interface Loadout {
  counts: Map<string, number>;
}

/** A loadout-rule violation. `id` is the offending weapon/wargear id. */
export interface Violation {
  id: string;
  code: "exceeds-max" | "below-min";
  message: string;
}

/**
 * The maximum number of models that may take `option` in a unit of `modelCount`
 * models: `any_number` → all models; else `per_n_models` → floor(n / per); else
 * `max_count ?? 1`; then clamped by `max_count` when set. A null constraint is
 * treated as unrestricted (every model). Never negative.
 */
export function optionCap(option: WargearOption, modelCount: number): number {
  const c = option.model_constraint;
  if (!c) return Math.max(0, modelCount);
  let cap: number;
  if (c.any_number) cap = modelCount;
  else if (c.per_n_models) cap = Math.floor(modelCount / c.per_n_models);
  else cap = c.max_count ?? 1;
  if (c.max_count != null) cap = Math.min(cap, c.max_count);
  return Math.max(0, cap);
}

/** The ids a single option can add, given the chosen choice branch (default 0). */
function addedIds(option: WargearOption, choiceIndex = 0): string[] {
  if (option.replacement) return option.replacement;
  return option.replacement_choice?.[choiceIndex] ?? [];
}

/** Every id that any option can add — across all choice branches. */
function allReplacementIds(options: readonly WargearOption[]): Set<string> {
  const out = new Set<string>();
  for (const o of options) {
    for (const id of o.replacement ?? []) out.add(id);
    for (const group of o.replacement_choice ?? []) for (const id of group) out.add(id);
  }
  return out;
}

/** Base (always-carried) weapon ids: in `weapon_ids`, never a replacement. */
function baseWeaponIds(unit: Unit, options: readonly WargearOption[]): string[] {
  const replacements = allReplacementIds(options);
  return (unit.weapon_ids ?? []).filter((id) => !replacements.has(id));
}

/**
 * The maximal loadout: every base weapon on every model, then each option
 * applied at its full {@link optionCap} (choices take their first branch). Swaps
 * move count from the replaced id to the added id; add-ons only add.
 */
export function maximalLoadout(
  unit: Unit,
  modelCount: number,
  options: readonly WargearOption[],
): Loadout {
  const counts = new Map<string, number>();
  for (const id of baseWeaponIds(unit, options)) {
    counts.set(id, (counts.get(id) ?? 0) + modelCount);
  }
  for (const option of options) {
    const cap = optionCap(option, modelCount);
    if (cap === 0) continue;
    for (const id of option.replaces ?? []) {
      counts.set(id, (counts.get(id) ?? 0) - cap);
    }
    for (const id of addedIds(option)) {
      counts.set(id, (counts.get(id) ?? 0) + cap);
    }
  }
  // Drop any id that nets to zero so the loadout reads cleanly.
  for (const [id, n] of counts) if (n === 0) counts.delete(id);
  return { counts };
}

/**
 * Inclusive valid count range for each weapon/wargear id, used to clamp a UI's
 * per-weapon inputs so invalid loadouts are unreachable. A base weapon ranges
 * `[modelCount − maxSwapsAway, modelCount]`; an optional (replacement) id ranges
 * `[0, Σ caps that add it]`.
 */
export function weaponBounds(
  unit: Unit,
  modelCount: number,
  options: readonly WargearOption[],
): Map<string, WeaponBound> {
  const bounds = new Map<string, WeaponBound>();
  for (const id of baseWeaponIds(unit, options)) {
    bounds.set(id, { min: modelCount, max: modelCount });
  }
  for (const option of options) {
    const cap = optionCap(option, modelCount);
    for (const id of option.replaces ?? []) {
      const b = bounds.get(id) ?? { min: 0, max: 0 };
      bounds.set(id, { min: Math.max(0, b.min - cap), max: b.max });
    }
    // A replacement id can appear in multiple options / both choice branches;
    // sum the caps so its ceiling reflects every way to add it.
    const adds = new Set<string>();
    for (const id of option.replacement ?? []) adds.add(id);
    for (const group of option.replacement_choice ?? []) for (const id of group) adds.add(id);
    for (const id of adds) {
      const b = bounds.get(id) ?? { min: 0, max: 0 };
      bounds.set(id, { min: b.min, max: b.max + cap });
    }
  }
  return bounds;
}

/**
 * Clamp a single weapon's requested count into its valid range. Ids with no
 * bound (not part of this unit's loadout) are returned unchanged but floored at
 * zero.
 */
export function clampWeaponCount(
  bounds: Map<string, WeaponBound>,
  id: string,
  requested: number,
): number {
  const b = bounds.get(id);
  const n = Math.max(0, Math.floor(requested) || 0);
  if (!b) return n;
  return Math.min(b.max, Math.max(b.min, n));
}

/** Report every weapon/wargear count that falls outside its valid range. */
export function validateLoadout(
  unit: Unit,
  modelCount: number,
  options: readonly WargearOption[],
  counts: Map<string, number>,
): Violation[] {
  const bounds = weaponBounds(unit, modelCount, options);
  const out: Violation[] = [];
  for (const [id, n] of counts) {
    const b = bounds.get(id);
    if (!b) continue;
    if (n > b.max) {
      out.push({ id, code: "exceeds-max", message: `${id}: ${n} exceeds max ${b.max}` });
    } else if (n < b.min) {
      out.push({ id, code: "below-min", message: `${id}: ${n} below min ${b.min}` });
    }
  }
  // Deterministic order so the result is stable for cross-impl comparison.
  out.sort((a, b) => (a.id === b.id ? a.code.localeCompare(b.code) : a.id.localeCompare(b.id)));
  return out;
}
