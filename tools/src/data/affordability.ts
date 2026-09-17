/**
 * candidate_affordability — given the units already in a list and a points
 * budget, price the cheapest next copy of each candidate unit and flag whether
 * it still fits. Powers the list-builder's "sort cheapest-first / grey out the
 * unaffordable" catalog affordance, and is exposed as a cross-impl primitive so
 * the maths is pinned by `conformance/affordability/`.
 *
 * The cost of "one more copy" is ordinal-aware: 11e prices some datasheets by
 * army ordinal (see {@link baseUnitPoints}), so the next copy of a datasheet you
 * already field twice may cost more than the first. `nextCopyCost` is the
 * cheapest *entry point* — the minimum over the unit's points tiers of
 * `baseUnitPoints(unit, tier.models, nextOrdinal)` — i.e. taking it at its
 * smallest legal size, at the ordinal it would enter the army.
 *
 * Mirror of `crates/wh40kdc/src/data/affordability.rs`,
 * `python/src/wh40kdc/data/affordability.py`, `go/affordability.go`.
 *
 * @packageDocumentation
 */
import type { BattleSize } from "../import/types.js";
import type { Faction, Unit } from "../generated.js";
import type { Dataset } from "./dataset.js";
import type { UnitView } from "./entities.js";
import { pointsLimitForBattleSize } from "./battle-sizes.js";
import { hostPointsTiers, hostUnitPoints } from "./pricing.js";

/** One unit already in the list (fixes the running total + per-datasheet ordinals). */
export interface AffordabilityUnit {
  unitId: string;
  modelCount: number;
  enhancementId?: string | null;
}

/** Compact input shared by {@link candidateAffordability} and the runner op. */
export interface AffordabilitySpec {
  factionId: string | null;
  battleSize: BattleSize | null;
  /** Explicit points limit; overrides the battle-size default when set. */
  pointsLimitOverride?: number | null;
  units: AffordabilityUnit[];
  /** Units to price; defaults to every unit in `factionId` when omitted. */
  candidateUnitIds?: string[] | null;
}

/** Affordability verdict for one candidate unit. */
export interface CandidateCost {
  unitId: string;
  nextCopyCost: number;
  affordable: boolean;
}

/** The cheapest cost to field one more copy of `view` at army ordinal `nextOrdinal`. */
function cheapestNextCopy(
  view: UnitView,
  nextOrdinal: number,
  hostFaction?: Faction | null,
): number {
  const tiers = hostPointsTiers(view.raw as Unit, hostFaction);
  if (tiers.length === 0) return 0;
  let min = Infinity;
  for (const t of tiers) {
    const cost = hostUnitPoints(view.raw, t.models, nextOrdinal, hostFaction);
    if (cost < min) min = cost;
  }
  return min === Infinity ? 0 : min;
}

/**
 * Price the cheapest next copy of each candidate and flag affordability against
 * the remaining budget. Returns one {@link CandidateCost} per candidate that
 * resolves in the dataset, sorted ascending by `(nextCopyCost, unitId)` —
 * deterministic for conformance.
 */
export function candidateAffordability(spec: AffordabilitySpec, dataset: Dataset): CandidateCost[] {
  const resolve = (unitId: string): UnitView | undefined => {
    if (!unitId) return undefined;
    if (spec.factionId) {
      const scoped = dataset.units.getInFaction(unitId, spec.factionId);
      if (scoped) return scoped;
    }
    return dataset.units.getAny(unitId);
  };

  // Running total of the current list (ordinal-aware) + enhancement costs.
  // Host-aware: foreign units with an allied_points entry for this army price
  // from that entry (see hostPointsTiers).
  const hostFaction = spec.factionId ? dataset.factions.get(spec.factionId)?.raw : undefined;
  const ordinals = new Map<string, number>();
  let spent = 0;
  for (const u of spec.units) {
    const view = resolve(u.unitId);
    if (!view) continue;
    const ord = (ordinals.get(u.unitId) ?? 0) + 1;
    ordinals.set(u.unitId, ord);
    spent += hostUnitPoints(view.raw, u.modelCount, ord, hostFaction);
    if (u.enhancementId) spent += dataset.enhancements.get(u.enhancementId)?.cost ?? 0;
  }

  const limit =
    spec.pointsLimitOverride != null ? spec.pointsLimitOverride : pointsLimitForBattleSize(spec.battleSize);
  const remaining = limit == null ? Infinity : limit - spent;

  // Candidate set: explicit list, else every unit in the faction.
  const candidateIds =
    spec.candidateUnitIds ??
    (spec.factionId ? dataset.units.byFaction(spec.factionId).map((v) => v.id) : []);

  const out: CandidateCost[] = [];
  for (const unitId of candidateIds) {
    const view = resolve(unitId);
    if (!view) continue;
    const nextOrdinal = (ordinals.get(unitId) ?? 0) + 1;
    const nextCopyCost = cheapestNextCopy(view, nextOrdinal, hostFaction);
    out.push({ unitId: view.id, nextCopyCost, affordable: nextCopyCost <= remaining });
  }
  out.sort((a, b) => (a.nextCopyCost === b.nextCopyCost ? a.unitId.localeCompare(b.unitId) : a.nextCopyCost - b.nextCopyCost));
  return out;
}
