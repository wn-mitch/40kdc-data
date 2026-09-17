/**
 * Unit point-cost maths shared by every consumer of the dataset: given a unit,
 * a model count, and the unit's army ordinal, which `points` tier applies.
 *
 * 11e prices some datasheets by **army ordinal** — how many copies of that
 * datasheet you have already taken. The schema models this with optional
 * `unit_count_min`/`unit_count_max` bands on each `points` tier (1-based,
 * inclusive; an open-ended top band has `unit_count_max: null`). Every band
 * repeats across each model-count tier, e.g. World Eaters Chaos Terminators:
 *
 *   5m=175 [#1-2], 10m=350 [#1-2], 5m=185 [#3+], 10m=360 [#3+]
 *
 * Selecting a cost is therefore a two-step filter: keep the tiers whose ordinal
 * band contains this copy, then pick the highest model-count tier the count
 * reaches. A tier with no `unit_count_min` is unbanded and applies to every copy
 * (the common case).
 *
 * Some units also carry `allied_points` — alternate tiers scoped to a
 * `host_faction` that apply when the unit is fielded in another faction's army
 * (an Agents of the Imperium unit allied into any IMPERIUM army; a shared
 * Space Marine datasheet a chapter section reprices). {@link hostPointsTiers}
 * selects the tier table in effect for a host army and
 * {@link hostUnitPoints} prices from it; {@link baseUnitPoints} stays
 * native-only for callers without army context. Mirror of
 * `crates/wh40kdc/src/data/pricing.rs`.
 *
 * @packageDocumentation
 */
import type { Faction, Unit } from "../generated.js";

type PointsTier = NonNullable<Unit["points"]>[number];
type AlliedTier = NonNullable<Unit["allied_points"]>[number];
/** The band/size/cost shape shared by native and allied tiers. */
type CostTier = PointsTier | AlliedTier;

/** True when `ordinal` (1-based army copy) falls within `tier`'s ordinal band. */
function tierCoversOrdinal(tier: CostTier, ordinal: number): boolean {
  const min = tier.unit_count_min;
  if (min == null) return true; // unbanded: applies to every copy
  if (ordinal < min) return false;
  const max = tier.unit_count_max;
  return max == null || ordinal <= max;
}

/**
 * Base point cost for a unit of `modelCount` models taken as its `ordinal`-th
 * army copy (1-based; defaults to the 1st copy). Among the tiers whose ordinal
 * band covers this copy, returns the cost of the highest `models` threshold the
 * count reaches (lowest tier when none is reached). `models` is the tier's range
 * floor (a range-priced tier spans `models`..`models_max` at one cost, e.g.
 * Venatari 4–6 @320), so a count inside a range resolves to that range's cost.
 * Returns 0 when no tier applies — the caller surfaces a violation rather than
 * guessing.
 */
export function baseUnitPoints(unit: Unit, modelCount: number, ordinal = 1): number {
  return tierCost(unit.points ?? [], modelCount, ordinal);
}

/** The two-step tier selection over an explicit tier table (native or allied). */
function tierCost(table: readonly CostTier[], modelCount: number, ordinal: number): number {
  const tiers = table
    .filter((t) => tierCoversOrdinal(t, ordinal))
    .slice()
    .sort((a, b) => a.models - b.models);
  if (tiers.length === 0) return 0;
  let chosen = tiers[0];
  for (const t of tiers) {
    if (modelCount >= t.models) chosen = t;
  }
  return chosen.cost;
}

/** `Imperium` → `imperium`: faction keywords are display names, `host_faction` values are id slugs. */
function keywordSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * The points tiers in effect for a unit fielded in `hostFaction`'s army.
 *
 * A unit native to the host army (its `faction_id` IS the army's faction)
 * always prices from `points` — `allied_points` only ever applies to a unit
 * included in ANOTHER faction's army. For a foreign unit, an entry whose
 * `host_faction` names the army's faction id exactly wins (a chapter reprice:
 * an `adeptus-astartes` datasheet priced for `blood-angels`); otherwise an
 * entry naming a super-faction keyword the army's faction carries applies (an
 * Agents unit's `imperium` price in any Imperium army). With no matching
 * entry — or no army context at all — the native table stands, matching
 * consumers that ignore allied pricing.
 */
export function hostPointsTiers(
  unit: Unit,
  hostFaction?: Faction | null,
): readonly CostTier[] {
  const native = unit.points ?? [];
  const entries = unit.allied_points ?? [];
  if (!hostFaction || entries.length === 0 || unit.faction_id === hostFaction.id) return native;
  const exact = entries.filter((t) => t.host_faction === hostFaction.id);
  if (exact.length > 0) return exact;
  const owned = new Set((hostFaction.keywords ?? []).map(keywordSlug));
  const grouped = entries.filter((t) => owned.has(t.host_faction));
  return grouped.length > 0 ? grouped : native;
}

/**
 * {@link baseUnitPoints}, but priced from the tier table in effect inside
 * `hostFaction`'s army (see {@link hostPointsTiers}). With no `hostFaction`
 * this IS `baseUnitPoints`. Size coverage is identical across tables (allied
 * tiers reprice the native sizes), so `pointsTierMissing` stays native-only.
 */
export function hostUnitPoints(
  unit: Unit,
  modelCount: number,
  ordinal = 1,
  hostFaction?: Faction | null,
): number {
  return tierCost(hostPointsTiers(unit, hostFaction), modelCount, ordinal);
}

/**
 * True when no points tier covers `modelCount` for this `ordinal` — the count
 * falls outside every tier's `[models, models_max]` range (below the smallest
 * tier, above the largest, or in a gap between non-contiguous tiers), or the
 * ordinal has no banded price. A single-size tier (no `models_max`) covers only
 * `models`. Mirrors the band filter of {@link baseUnitPoints}.
 */
export function pointsTierMissing(unit: Unit, modelCount: number, ordinal = 1): boolean {
  const tiers = (unit.points ?? []).filter((t) => tierCoversOrdinal(t, ordinal));
  if (tiers.length === 0) return true;
  return !tiers.some((t) => t.models <= modelCount && modelCount <= (t.models_max ?? t.models));
}

/**
 * Per-item MFM wargear surcharge for a unit whose final loadout has `counts`
 * copies of each weapon/wargear id (see {@link Loadout}). Each `unit.wargear_costs`
 * entry charges `cost` for every copy of `item_id` present — a Terminator Assault
 * Squad's five thunder hammers add 25, a Chapter Ancient's Banner of Macragge adds
 * 10. Items with no cost entry are free. Absent `wargear_costs` (the common case)
 * contributes 0, so a unit's total is `baseUnitPoints + wargearPoints + enhancement`.
 * Mirror of `crates/wh40kdc/src/data/pricing.rs`.
 */
export function wargearPoints(unit: Unit, counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const wc of unit.wargear_costs ?? []) total += wc.cost * (counts.get(wc.item_id) ?? 0);
  return total;
}
