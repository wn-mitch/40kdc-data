/**
 * The best default weapons of each datasheet at each priced squad size. The hill climb finds the
 * unit's best legal wargear against each reference target in each phase; each of those winners,
 * and the out-of-the-box loadout, is then scored against every cell with the unit's own datasheet
 * rules, and the fit's price list picks the one worth the most points across all of them. A
 * candidate that gives up a non-weapon item the default carries (a vox-caster, a banner) is not
 * considered: only the weapons change.
 *
 * Measuring (here, in each faction's child process) records the candidates and their scores; the
 * choice waits for the fit ({@link chooseBestLoadouts}).
 *
 * @packageDocumentation
 */
import { resolveTarget, type ComparePhase } from "../compare.js";
import type { Buff, EngineContext } from "../cruncher/index.js";
import type { Dataset } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import { resolveFactionContext, type FactionContext } from "../stack-damage/factions.js";
import { damageScoringSession, emptySpec } from "../stack-damage/search.js";
import { unitLoadoutDamage } from "../stack-damage/unit-damage.js";
import type { MatrixConfig } from "../stack-damage/config.js";
import { INFANTRY_TARGET_IDS, PHASES, firstCopyPoints, pricedUnits } from "./features.js";
import { lineContext } from "./marginal.js";
import type { PriceModel } from "./fit.js";

export interface LoadoutCandidate {
  counts: Record<string, number>;
  /** Expected wounds dealt in each cell, in `cells` order. */
  scores: number[];
}

export interface SizeCandidates {
  unitId: string;
  models: number;
  /** Index 0 is the out-of-the-box loadout. */
  candidates: LoadoutCandidate[];
}

export interface CandidateSet {
  /** Cells as `phase:targetId`, the order every candidate's `scores` follow. */
  cells: string[];
  sizes: SizeCandidates[];
}

const key = (counts: ReadonlyMap<string, number>) => [...counts].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => `${id}=${n}`).join(",");

/** The squad sizes a unit is priced at as an army's first copy, within its datasheet's range. */
function pricedSizes(unit: UnitView): number[] {
  const min = unit.raw.model_count?.min ?? 1;
  const max = unit.raw.model_count?.max ?? min;
  const sizes = (unit.raw.points ?? []).map((entry) => entry.models).filter((models) => models >= min && models <= max);
  return [...new Set(sizes)].filter((models) => firstCopyPoints(unit.raw, models) !== null).sort((a, b) => a - b);
}

/** Whether the unit has any wargear choice at `models` models. */
function hasChoice(ds: Dataset, unit: UnitView, models: number): boolean {
  const bounds = ds.loadoutOf(unit.raw).bounds(models);
  return bounds !== null && [...bounds.values()].some((bound) => bound.min !== bound.max);
}

/** Every unit of the faction with a wargear choice, its candidate loadouts at each priced size. */
export function loadoutCandidates(ds: Dataset, factionId: string, targetIds: readonly string[], fullConfig: MatrixConfig): CandidateSet {
  const faction = resolveFactionContext(ds, factionId);
  const isolated: FactionContext = { ...faction, units: [] };
  const cells = PHASES.flatMap((phase) => targetIds.map((targetId) => {
    const profile = ds.targetProfiles.get(targetId);
    const target = profile ? resolveTarget(ds, profile) : null;
    if (!target) throw new Error(`unknown target profile ${targetId}`);
    return { phase, targetId, target };
  }));
  const sizes: SizeCandidates[] = [];
  const isWeapon = (id: string) => (ds.weapons.getInFaction(id, factionId) ?? ds.weapons.getAny(id)) !== undefined;
  for (const unit of pricedUnits(ds, faction)) {
    const rules = ds.loadoutOf(unit.raw);
    for (const models of pricedSizes(unit)) {
      if (!hasChoice(ds, unit, models)) continue;
      const base = rules.base(models);
      if (!base) continue;
      const found = new Map<string, Map<string, number>>([[key(base), base]]);
      for (const cell of cells) {
        const session = damageScoringSession({ dataset: ds, config: fullConfig, faction: isolated, target: cell.target, phase: cell.phase, modelCounts: new Map([[unit.id, models]]) });
        const counts = session.optimiseLevers(emptySpec(factionId, [{ unit, role: "bodyguard" }])).members[0]?.loadout.counts;
        if (!counts || rules.check(models, counts).length !== 0 || found.has(key(counts))) continue;
        // Only weapons change: a candidate keeps every non-weapon item (a vox-caster, a banner) the default carries.
        if ([...base].some(([id, n]) => !isWeapon(id) && (counts.get(id) ?? 0) < n)) continue;
        found.set(key(counts), new Map(counts));
      }
      if (found.size < 2) continue;
      const candidates = [...found.values()].map((counts): LoadoutCandidate => ({
        counts: Object.fromEntries([...counts].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b))),
        scores: cells.map((cell) => {
          const context: EngineContext = { ...lineContext(cell.phase), armyFaction: factionId };
          const buffs: Buff[] = ds.buffsFor({ unitId: unit.id, factionId }, context)
            .filter((buff) => buff.source.kind !== "ability" || buff.source.abilityKind === "unit");
          try {
            return unitLoadoutDamage({ dataset: ds, unit: unit.raw, modelCount: models, counts, target: { unit: cell.target.unitRaw, modelCount: cell.target.modelCount }, buffs, context, loadout: rules }).total;
          } catch {
            return 0;
          }
        }),
      }));
      sizes.push({ unitId: unit.id, models, candidates });
    }
  }
  return { cells: cells.map((cell) => `${cell.phase}:${cell.targetId}`), sizes };
}

/** Best loadouts that differ from the out-of-the-box one: faction → unit → model count → counts. */
export type BestLoadouts = Record<string, Record<string, Record<string, Record<string, number>>>>;

/** Points per expected wound dealt in a cell under `model`: its offense feature's price over the targets it averages. */
function cellPrice(model: PriceModel, cell: string, cells: readonly string[]): number {
  const [phase, targetId] = cell.split(":");
  const infantry = INFANTRY_TARGET_IDS.has(targetId);
  const feature = `${phase === "shooting" ? "shoot" : "fight"}-${infantry ? "infantry" : "armour"}`;
  const peers = cells.filter((other) => other.startsWith(`${phase}:`) && INFANTRY_TARGET_IDS.has(other.split(":")[1]) === infantry).length;
  const j = model.names.indexOf(feature);
  return j < 0 || peers === 0 ? 0 : model.coefficients[j] / peers;
}

/**
 * Each size's candidate worth the most points under the price list, kept when it beats the
 * out-of-the-box loadout by at least `margin` points (so near-ties keep the printed default).
 */
export function chooseBestLoadouts(model: PriceModel, sets: Record<string, CandidateSet>, margin = 1): BestLoadouts {
  const out: BestLoadouts = {};
  for (const [factionId, set] of Object.entries(sets).sort(([a], [b]) => a.localeCompare(b))) {
    const prices = set.cells.map((cell) => cellPrice(model, cell, set.cells));
    const worth = (candidate: LoadoutCandidate) => candidate.scores.reduce((sum, score, i) => sum + score * prices[i], 0);
    for (const size of set.sizes) {
      const best = size.candidates.reduce((top, candidate) => worth(candidate) > worth(top) ? candidate : top);
      if (worth(best) < worth(size.candidates[0]) + margin) continue;
      ((out[factionId] ??= {})[size.unitId] ??= {})[String(size.models)] = best.counts;
    }
  }
  return out;
}
