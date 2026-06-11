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

export interface Player {
  id: string;
  name: string;
  /** Factions this player is willing to bring (one or more). */
  factionIds: string[];
  /**
   * Detachment narrowing. `null` = cover every detachment in `factionIds`
   * (the default). A list = restrict coverage to exactly those detachment ids.
   */
  detachmentIds: string[] | null;
}

export interface TeamPlan {
  teamName: string;
  /** Roster size for the event — drives the "slots filled" hint, not the rule. */
  size: 5 | 8;
  players: Player[];
}

export interface TeamCoverage {
  /** Players able to field each disposition, keyed by disposition id. */
  byDisposition: Record<ForceDispositionId, Player[]>;
  /** Each player's covered disposition set, keyed by player id. */
  perPlayer: Map<string, Set<ForceDispositionId>>;
  /** Dispositions no player can field. */
  gaps: ForceDispositionId[];
  /** True when every disposition has at least one covering player. */
  ready: boolean;
}

/**
 * The detachments a player might field: every detachment across their factions,
 * restricted to the narrowed ids when narrowing is on.
 */
export function candidateDetachments(p: Player): Detachment[] {
  const all = detachmentsForFactions(p.factionIds);
  return p.detachmentIds == null
    ? all
    : all.filter((d) => p.detachmentIds!.includes(d.id));
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

  for (const p of plan.players) {
    const cov = playerCoverage(p);
    perPlayer.set(p.id, cov);
    for (const d of DISPOSITIONS) {
      if (cov.has(d)) byDisposition[d].push(p);
    }
  }

  const gaps = DISPOSITIONS.filter((d) => byDisposition[d].length === 0);
  return { byDisposition, perPlayer, gaps, ready: gaps.length === 0 };
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

/** A faction id is usable iff it resolves to a known faction with detachments. */
export function isKnownFaction(id: string): boolean {
  return ds.detachments.byFaction(id).length > 0;
}
