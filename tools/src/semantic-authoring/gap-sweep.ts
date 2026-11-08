import type { DatabaseSync } from "node:sqlite";

import { getCurrentCoverage } from "./coverage.js";

/** What closes the open gaps nothing needs any more. */
export type StaleGaps = {
  /** Undecided proposals whose span is now covered; rejecting one resolves its linked leaf gaps. */
  reject_proposal_ids: number[];
  /** Gaps closed directly: on a superseded source version, or covered with an already decided proposal. */
  resolve: Array<{ gap_id: number; reason: string }>;
};

type OpenGap = {
  id: number; type: string; ability_version_id: number; current: number;
  proposal_id: number | null; proposal_status: string | null; start_byte: number | null; end_byte: number | null;
};

/**
 * Open gaps that no longer describe missing work: every gap on a superseded source version, and
 * each leaf gap whose span reviewed leaves, accepted structural atoms and accepted connectives now
 * account for. A leaf gap over any unaccounted byte stays open, as do DSL, relation, composition
 * and source-ambiguity gaps on current versions: whether those are fixed is a reviewer's call.
 */
export function staleGaps(db: DatabaseSync, factionId?: string): StaleGaps {
  const gaps = db.prepare(`
    SELECT gaps.id, gaps.type, gaps.ability_version_id, abilities.current, gaps.proposal_id,
      proposals.status AS proposal_status, source_spans.start_byte, source_spans.end_byte
    FROM gaps JOIN abilities ON abilities.id = gaps.ability_version_id
    LEFT JOIN proposals ON proposals.id = gaps.proposal_id LEFT JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE gaps.status = 'open' ${factionId ? "AND abilities.faction_id = ?" : ""} ORDER BY gaps.id
  `).all(...(factionId ? [factionId] : [])) as OpenGap[];
  const leafAbilities = new Set(gaps.filter((gap) => gap.current === 1 && gap.type === "LEAF_GAP" && gap.start_byte !== null).map((gap) => gap.ability_version_id));
  const coverage = leafAbilities.size ? getCurrentCoverage(db, { abilityVersionIds: leafAbilities }) : new Map();
  const reject = new Set<number>();
  const resolve: StaleGaps["resolve"] = [];
  for (const gap of gaps) {
    if (gap.current === 0) {
      resolve.push({ gap_id: gap.id, reason: "Its source version is superseded." });
      continue;
    }
    if (gap.type !== "LEAF_GAP" || gap.start_byte === null || gap.end_byte === null) continue;
    const unaccounted = coverage.get(gap.ability_version_id)?.unaccounted ?? [];
    if (unaccounted.some((interval: { start_byte: number; end_byte: number }) => interval.start_byte < gap.end_byte! && gap.start_byte! < interval.end_byte)) continue;
    if (gap.proposal_status === "pending" || gap.proposal_status === "unresolved") reject.add(gap.proposal_id!);
    else resolve.push({ gap_id: gap.id, reason: "Its span is covered by reviewed leaves and connectives." });
  }
  return { reject_proposal_ids: [...reject], resolve };
}
