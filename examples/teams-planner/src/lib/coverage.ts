/**
 * The coverage core: a team plan is a set of players, each fielding one or more
 * factions and a *pool of prospective armies*. An "army" is a named combo of
 * detachments (≤3 detachment points, soft-capped). A player "covers" a force
 * disposition when some army in their pool can field it — i.e. one of the army's
 * detachments grants that disposition. The team is ready when every one of the
 * five dispositions has at least one covering player.
 *
 * Preferences are expressed per `(army × disposition)` capability ("placement"),
 * each dropped into one of three bands — could / pref / want — and ranked within
 * the flat `preferences` list (array index = global rank). A disposition's
 * *effective* placement is its highest-banded copy (ties broken by rank); that
 * single placement drives both the matrix symbol and the army label.
 *
 * Everything here is a pure function of the embedded `Dataset` + the plan, so
 * it's exercised directly in coverage.test.ts with no mocking. ID generation
 * lives in the UI (it needs the browser's crypto), not here.
 */
import type { Detachment, ForceDispositionId } from "@alpaca-software/40kdc-data";
import { DISPOSITIONS } from "../../../_shared/matchup-grid.js";
import { ds } from "./dataset";

/**
 * Desire tier for a disposition a player can field. `"could"` = capable, no
 * stated lean; `"pref"` = a real preference; `"want"` = a top pick. Rendered as
 * ○ / ● / ★; an uncoverable disposition is blank.
 */
export type PrefTier = "could" | "pref" | "want";

/** Tier ordering for picking a disposition's effective (best) placement. */
const TIER_RANK: Record<PrefTier, number> = { want: 3, pref: 2, could: 1 };

/** A named ≤3-DP combo of detachments — the unit a player actually brings. */
export interface Army {
  id: string;
  name: string;
  /** The detachments in the combo. DP is soft-capped at 3 (warned, not blocked). */
  detachmentIds: string[];
}

/**
 * One `(army × disposition)` capability, placed in a band. The army can field
 * `disposition` (some detachment grants it); `tier` is the player's stated
 * desire for fielding *this* army as *that* disposition.
 */
export interface Placement {
  armyId: string;
  disposition: ForceDispositionId;
  tier: PrefTier;
}

export interface Player {
  id: string;
  name: string;
  /** Factions this player is willing to bring (one or more). */
  factionIds: string[];
  /** The player's prospective army pool. Coverage is derived *only* from this. */
  armies: Army[];
  /**
   * Ranked placements — one per `(army, disposition)` the pool can field. Array
   * index is the global rank; `tier` is the band. Kept in sync with the pool by
   * {@link syncPreferences} (new capabilities default to the `could` band).
   */
  preferences: Placement[];
  /**
   * Captain lock-ins: a disposition → the army id committed to play it. Pins a
   * specific army so later preference reshuffles don't silently move a decision.
   */
  locked: Partial<Record<ForceDispositionId, string>>;
}

export interface TeamPlan {
  teamName: string;
  /** Roster size for the event — drives the "slots filled" hint, not the rule. */
  size: 5 | 8;
  players: Player[];
}

/** Players grouped by their effective desire tier for a disposition. */
export interface TierRollup {
  want: Player[];
  pref: Player[];
  could: Player[];
}

export interface TeamCoverage {
  /** Players able to field each disposition, keyed by disposition id. */
  byDisposition: Record<ForceDispositionId, Player[]>;
  /** Players bucketed by their *effective* desire tier for each disposition. */
  tierByDisposition: Record<ForceDispositionId, TierRollup>;
  /** Players who have locked an army into each disposition. */
  lockedByDisposition: Record<ForceDispositionId, Player[]>;
  /** Each player's covered disposition set, keyed by player id. */
  perPlayer: Map<string, Set<ForceDispositionId>>;
  /** Dispositions no player can field. */
  gaps: ForceDispositionId[];
  /** True when every disposition has at least one covering player. */
  ready: boolean;
}

/**
 * A disposition is "spoken for" once this many players lock an army into it; the
 * matrix then dims that column's still-open cells for everyone else.
 */
export const LOCK_CAP = 2;

/** Detachment-point cost of one detachment (0 when unassigned/unknown). */
export function detachmentPointCost(detachmentId: string): number {
  return ds.detachments.get(detachmentId)?.detachment_points ?? 0;
}

/** Total DP of an army's combo. Soft-capped at 3 in the UI, not enforced here. */
export function armyDetachmentPoints(army: Army): number {
  return army.detachmentIds.reduce((sum, id) => sum + detachmentPointCost(id), 0);
}

/** The force dispositions an army can field — the union over its detachments. */
export function armyDispositions(army: Army): Set<ForceDispositionId> {
  const out = new Set<ForceDispositionId>();
  for (const id of army.detachmentIds) {
    for (const fd of ds.detachments.get(id)?.force_dispositions ?? []) {
      out.add(fd as ForceDispositionId);
    }
  }
  return out;
}

/** Union of force dispositions a player can field across their whole army pool. */
export function playerCoverage(p: Player): Set<ForceDispositionId> {
  const out = new Set<ForceDispositionId>();
  for (const army of p.armies) {
    for (const d of armyDispositions(army)) out.add(d);
  }
  return out;
}

/**
 * Reconcile a player's `preferences` against their current pool: append a
 * `could` placement for every `(army, disposition)` capability that lacks one,
 * and drop placements whose army is gone or whose army can no longer field that
 * disposition. Existing placements keep their band *and* their relative order;
 * only the tail (new capabilities) is appended. Pure — returns a new array.
 */
export function syncPreferences(p: Player): Placement[] {
  // Capability set: "armyId disposition" keys the pool currently supports.
  const capable = new Set<string>();
  for (const army of p.armies) {
    for (const d of armyDispositions(army)) capable.add(`${army.id} ${d}`);
  }

  const seen = new Set<string>();
  const kept: Placement[] = [];
  for (const pl of p.preferences) {
    const key = `${pl.armyId} ${pl.disposition}`;
    if (!capable.has(key) || seen.has(key)) continue; // dropped / de-duped
    seen.add(key);
    kept.push(pl);
  }

  // Append any capability with no surviving placement, in pool/disposition order.
  for (const army of p.armies) {
    for (const d of DISPOSITIONS) {
      const key = `${army.id} ${d}`;
      if (capable.has(key) && !seen.has(key)) {
        seen.add(key);
        kept.push({ armyId: army.id, disposition: d, tier: "could" });
      }
    }
  }
  return kept;
}

/**
 * The placement that represents a player on a disposition: the highest-banded
 * copy (want > pref > could), ties broken by rank (earliest in `preferences`).
 * `null` when the player can't field the disposition at all. Drives the matrix
 * symbol and the displayed army label.
 */
export function effectivePlacement(p: Player, d: ForceDispositionId): Placement | null {
  let best: Placement | null = null;
  for (const pl of p.preferences) {
    if (pl.disposition !== d) continue;
    if (best === null || TIER_RANK[pl.tier] > TIER_RANK[best.tier]) best = pl;
    // Equal tier → keep the earlier one (already `best`), so rank wins ties.
  }
  return best;
}

/** Army lookup within a player's pool. */
export function findArmy(p: Player, armyId: string): Army | undefined {
  return p.armies.find((a) => a.id === armyId);
}

/**
 * Move the element keyed `fromKey` to occupy `toKey`'s slot, shifting the rest;
 * the relative order of every other element is preserved. Returns the input
 * unchanged when either key is absent or identical — so callers can assign the
 * result blindly. The single reorder primitive behind drag-to-rank and steppers.
 */
export function reorder<T>(list: T[], fromKey: string, toKey: string, keyOf: (x: T) => string): T[] {
  const from = list.findIndex((x) => keyOf(x) === fromKey);
  const to = list.findIndex((x) => keyOf(x) === toKey);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Stable key for a placement (its `(army, disposition)` identity). */
export function placementKey(pl: Pick<Placement, "armyId" | "disposition">): string {
  return `${pl.armyId} ${pl.disposition}`;
}

/** Reorder placements, moving `fromKey` to `toKey`'s slot. */
export function reorderPlacements(prefs: Placement[], fromKey: string, toKey: string): Placement[] {
  return reorder(prefs, fromKey, toKey, placementKey);
}

/**
 * Move a placement into `tier`, repositioning it just before `beforeKey` (or to
 * the end of the list when `beforeKey` is null/absent). One operation covers
 * both "drop into another band" and "rank within the target band". Pure.
 */
export function setPlacementTier(
  prefs: Placement[],
  key: string,
  tier: PrefTier,
  beforeKey: string | null = null,
): Placement[] {
  const from = prefs.findIndex((pl) => placementKey(pl) === key);
  if (from < 0) return prefs;
  const next = [...prefs];
  const [moved] = next.splice(from, 1);
  const retiered: Placement = { ...moved, tier };
  const at = beforeKey == null ? -1 : next.findIndex((pl) => placementKey(pl) === beforeKey);
  if (at < 0) next.push(retiered);
  else next.splice(at, 0, retiered);
  return next;
}

/** Coverage for the whole team, plus the readiness verdict. */
export function teamCoverage(plan: TeamPlan): TeamCoverage {
  const perPlayer = new Map<string, Set<ForceDispositionId>>();
  const byDisposition = Object.fromEntries(
    DISPOSITIONS.map((d) => [d, [] as Player[]]),
  ) as Record<ForceDispositionId, Player[]>;
  const tierByDisposition = Object.fromEntries(
    DISPOSITIONS.map((d) => [d, { want: [], pref: [], could: [] } as TierRollup]),
  ) as Record<ForceDispositionId, TierRollup>;
  const lockedByDisposition = Object.fromEntries(
    DISPOSITIONS.map((d) => [d, [] as Player[]]),
  ) as Record<ForceDispositionId, Player[]>;

  for (const p of plan.players) {
    const cov = playerCoverage(p);
    perPlayer.set(p.id, cov);
    for (const d of DISPOSITIONS) {
      if (!cov.has(d)) continue;
      byDisposition[d].push(p);
      const eff = effectivePlacement(p, d);
      if (eff) tierByDisposition[d][eff.tier].push(p);
      // A lock only counts when the locked army still fields the disposition.
      const lockedArmy = p.locked?.[d];
      if (lockedArmy && findArmy(p, lockedArmy) && armyDispositions(findArmy(p, lockedArmy)!).has(d)) {
        lockedByDisposition[d].push(p);
      }
    }
  }

  const gaps = DISPOSITIONS.filter((d) => byDisposition[d].length === 0);
  return { byDisposition, tierByDisposition, lockedByDisposition, perPlayer, gaps, ready: gaps.length === 0 };
}

/** A disposition is "full" once `LOCK_CAP` players have locked an army into it. */
export function columnFull(coverage: TeamCoverage, d: ForceDispositionId): boolean {
  return coverage.lockedByDisposition[d].length >= LOCK_CAP;
}

export interface FactionOption {
  id: string;
  name: string;
}

/** Selectable factions: those with at least one detachment, sorted by name. */
export function factionOptions(): FactionOption[] {
  return ds.factions.all
    .filter((f) => ds.detachments.byFaction(f.id).length > 0)
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct detachments across the given factions, sorted by name. */
export function detachmentsForFactions(factionIds: string[]): Detachment[] {
  const seen = new Set<string>();
  const out: Detachment[] = [];
  for (const f of factionIds) {
    for (const d of ds.detachments.byFaction(f)) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface FactionDetachments {
  faction: FactionOption;
  detachments: Detachment[];
}

/**
 * Detachments grouped under their faction, in the player's faction order — the
 * shape the army-builder checklist renders. Factions with no detachments are
 * omitted.
 */
export function detachmentsByFaction(factionIds: string[]): FactionDetachments[] {
  return factionIds
    .map((id) => ({
      faction: { id, name: ds.factions.get(id)?.name ?? id },
      detachments: ds.detachments
        .byFaction(id)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.detachments.length > 0);
}

/** Detachment display name (falls back to the id when unknown). */
export function detachmentName(id: string): string {
  return ds.detachments.get(id)?.name ?? id;
}

/** The force dispositions a single detachment grants. */
export function detachmentDispositions(id: string): ForceDispositionId[] {
  return (ds.detachments.get(id)?.force_dispositions ?? []) as ForceDispositionId[];
}

/** The auto name for a combo: its detachment names joined with " / ". */
export function autoArmyName(detachmentIds: string[]): string {
  return detachmentIds.map(detachmentName).join(" / ");
}

/**
 * Reconcile an army's name when its detachment combo changes from `oldIds` to
 * `newIds`. The detachment-derived prefix stays in sync; anything the player
 * appended after it (notes) is preserved. A fully hand-written name — one that
 * doesn't start with the old auto-name — is left untouched. Empty `current`
 * (a brand-new army) auto-fills cleanly.
 */
export function reconcileArmyName(current: string, oldIds: string[], newIds: string[]): string {
  const oldAuto = autoArmyName(oldIds);
  const newAuto = autoArmyName(newIds);
  if (current === oldAuto) return newAuto; // pure auto, no notes (covers "")
  if (oldAuto !== "" && current.startsWith(oldAuto)) {
    return (newAuto + current.slice(oldAuto.length)).trimStart();
  }
  return current; // custom name — leave it alone
}

/** A faction id is usable iff it resolves to a known faction with detachments. */
export function isKnownFaction(id: string): boolean {
  return ds.detachments.byFaction(id).length > 0;
}

/** True iff the detachment id resolves in the dataset. */
export function isKnownDetachment(id: string): boolean {
  return ds.detachments.get(id) != null;
}
