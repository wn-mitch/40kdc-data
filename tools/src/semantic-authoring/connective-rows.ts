import type { DatabaseSync } from "node:sqlite";

/**
 * Reviewed connectives the compiler reads: accepted CONNECTIVE proposals whose reviewed relation
 * the compiler consumes. A row's relation is its own `reason_json.reviewed_relation`; a
 * duplicate-text copy (`copied_from_proposal`, propagate.ts) carries none of its own and takes the
 * relation of the accepted row it copies.
 */

/** The relations compilation consumes. Every other reviewed relation is coverage only. */
export const CONSUMED_RELATIONS: ReadonlySet<string> = new Set(["condition-of"]);

export type ReviewedConnective = {
  ability_version_id: number;
  fragment: string;
  start_byte: number;
  end_byte: number;
  /** The connective's wording in the source ("If it does"). */
  surface: string;
  relation: string;
};

type Row = { id: number; ability_version_id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string; reason_json: string };

function idList(ids: Iterable<number>): string {
  return [...ids].map(Number).filter(Number.isSafeInteger).join(",") || "NULL";
}

function reasonOf(json: string): { reviewed_relation?: unknown; copied_from_proposal?: unknown } {
  const value = JSON.parse(json) as unknown;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as { reviewed_relation?: unknown; copied_from_proposal?: unknown } : {};
}

/**
 * The consumed connectives of the given source versions, ordered by version, fragment and position.
 * A copy whose source row is no longer accepted, or whose chain of copies loops, has no relation.
 */
/**
 * The SQL {@link reviewedConnectives} runs. CROSS JOIN fixes the join order: start from the
 * versions' spans (source_spans_ability_lookup), then their proposals
 * (proposals_span_role_lookup), never a scan of every accepted proposal.
 */
export function connectiveRowsSql(abilityVersionIds: Iterable<number>): string {
  return `
    SELECT proposals.id, source_spans.ability_version_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte, source_spans.exact_text, proposals.reason_json
    FROM source_spans CROSS JOIN proposals ON proposals.span_id = source_spans.id
    WHERE proposals.role = 'CONNECTIVE' AND proposals.status = 'accepted' AND source_spans.ability_version_id IN (${idList(abilityVersionIds)})
    ORDER BY source_spans.ability_version_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte, proposals.id
  `;
}

export function reviewedConnectives(db: DatabaseSync, abilityVersionIds: Iterable<number>): ReviewedConnective[] {
  const rows = db.prepare(connectiveRowsSql(abilityVersionIds)).all() as Row[];
  const source = db.prepare("SELECT reason_json FROM proposals WHERE id = ? AND role = 'CONNECTIVE' AND status = 'accepted'");
  const relationOf = (row: Row): string | null => {
    const seen = new Set<number>([row.id]);
    let reason = reasonOf(row.reason_json);
    while (typeof reason.reviewed_relation !== "string") {
      const from = Number(reason.copied_from_proposal);
      if (!Number.isSafeInteger(from) || seen.has(from)) return null;
      seen.add(from);
      const copied = source.get(from) as { reason_json: string } | undefined;
      if (!copied) return null;
      reason = reasonOf(copied.reason_json);
    }
    return reason.reviewed_relation;
  };
  const result: ReviewedConnective[] = [];
  const kept = new Set<string>();
  for (const row of rows) {
    const relation = relationOf(row);
    if (relation === null || !CONSUMED_RELATIONS.has(relation)) continue;
    // Two accepted rows on one span with one relation are one decision.
    const key = JSON.stringify([row.ability_version_id, row.fragment, row.start_byte, row.end_byte, relation]);
    if (kept.has(key)) continue;
    kept.add(key);
    result.push({ ability_version_id: row.ability_version_id, fragment: row.fragment, start_byte: row.start_byte, end_byte: row.end_byte, surface: row.exact_text, relation });
  }
  return result;
}
