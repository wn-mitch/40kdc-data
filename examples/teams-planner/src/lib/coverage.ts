/**
 * The coverage core: a team plan is a set of players, each on one or more
 * factions (optionally narrowed to specific detachments). A player "covers" a
 * force disposition when some detachment they're willing to field grants it.
 * The team is ready when every one of the five dispositions has at least one
 * covering player.
 *
 * Everything here is a pure function of the embedded `Dataset` + the plan, so
 * it's exercised directly in coverage.test.ts with no mocking. ID generation
 * lives in the UI (it needs the browser's crypto), not here.
 */
import type { Detachment, ForceDispositionId } from "@alpaca-software/40kdc-data";
import { DISPOSITIONS } from "../../../_shared/matchup-grid.js";
import { ds } from "./dataset";

/**
 * Stated intent for a disposition the player *can* field, layered above bare
 * capability. `"leaning"` = tentatively planning to cover it; `"prefer"` = a top
 * pick. The absence of a key means "can" — capable, no stated intent.
 */
export type IntentTier = "leaning" | "prefer";

export interface Player {
  id: string;
  name: string;
  /** Factions this player is willing to bring (one or more). */
  factionIds: string[];
  /**
   * Detachment narrowing *and* preference ranking. `null` = cover every
   * detachment in `factionIds` (the default, unranked). A list = restrict
   * coverage to exactly those detachment ids, where the **array order is the
   * preference ranking** (index 0 = top pick).
   */
  detachmentIds: string[] | null;
  /**
   * Per-disposition stated intent. Keys must be dispositions the player can
   * field (an entry on an unfieldable disposition is ignored); an absent key
   * means "can".
   */
  intent: Partial<Record<ForceDispositionId, IntentTier>>;
}

export interface TeamPlan {
  teamName: string;
  /** Roster size for the event — drives the "slots filled" hint, not the rule. */
  size: 5 | 8;
  players: Player[];
}

/** Players who stated each intent tier for a disposition (subsets of the capable). */
export interface IntentRollup {
  prefer: Player[];
  leaning: Player[];
}

export interface TeamCoverage {
  /** Players able to field each disposition, keyed by disposition id. */
  byDisposition: Record<ForceDispositionId, Player[]>;
  /** Players who stated a "prefer"/"leaning" intent for each disposition. */
  intentByDisposition: Record<ForceDispositionId, IntentRollup>;
  /** Each player's covered disposition set, keyed by player id. */
  perPlayer: Map<string, Set<ForceDispositionId>>;
  /** Dispositions no player can field. */
  gaps: ForceDispositionId[];
  /** True when every disposition has at least one covering player. */
  ready: boolean;
}

/**
 * The detachments a player might field: every detachment across their factions,
 * restricted to the narrowed ids when narrowing is on. When narrowed, the result
 * follows the player's `detachmentIds` **rank order** (index 0 = top pick), not
 * name order — the ranking the UI exposes. Unnarrowed stays name-sorted.
 */
export function candidateDetachments(p: Player): Detachment[] {
  const all = detachmentsForFactions(p.factionIds);
  if (p.detachmentIds == null) return all;
  const byId = new Map(all.map((d) => [d.id, d]));
  return p.detachmentIds
    .map((id) => byId.get(id))
    .filter((d): d is Detachment => d != null);
}

/** Union of force dispositions a player can field. */
export function playerCoverage(p: Player): Set<ForceDispositionId> {
  const out = new Set<ForceDispositionId>();
  for (const d of candidateDetachments(p)) {
    for (const fd of d.force_dispositions ?? []) {
      out.add(fd as ForceDispositionId);
    }
  }
  return out;
}

/** Coverage for the whole team, plus the readiness verdict. */
export function teamCoverage(plan: TeamPlan): TeamCoverage {
  const perPlayer = new Map<string, Set<ForceDispositionId>>();
  const byDisposition = Object.fromEntries(
    DISPOSITIONS.map((d) => [d, [] as Player[]]),
  ) as Record<ForceDispositionId, Player[]>;
  const intentByDisposition = Object.fromEntries(
    DISPOSITIONS.map((d) => [d, { prefer: [], leaning: [] } as IntentRollup]),
  ) as Record<ForceDispositionId, IntentRollup>;

  for (const p of plan.players) {
    const cov = playerCoverage(p);
    perPlayer.set(p.id, cov);
    for (const d of DISPOSITIONS) {
      if (!cov.has(d)) continue;
      byDisposition[d].push(p);
      // Intent only counts for a disposition the player can actually field.
      const tier = p.intent?.[d];
      if (tier === "prefer") intentByDisposition[d].prefer.push(p);
      else if (tier === "leaning") intentByDisposition[d].leaning.push(p);
    }
  }

  const gaps = DISPOSITIONS.filter((d) => byDisposition[d].length === 0);
  return { byDisposition, intentByDisposition, perPlayer, gaps, ready: gaps.length === 0 };
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
 * shape the narrowing checklist renders. Factions with no detachments are
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

/** A faction id is usable iff it resolves to a known faction with detachments. */
export function isKnownFaction(id: string): boolean {
  return ds.detachments.byFaction(id).length > 0;
}
