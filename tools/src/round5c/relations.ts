import type { DatabaseSync } from "node:sqlite";

import { RELATION_TYPES } from "../round4b/contracts.js";
import type { SourceGraph } from "./contracts.js";
import { EFFECTIVE_STRUCTURAL_REVIEW } from "./coverage.js";
import { CONNECTIVE_KINDS, type ConnectiveKind } from "./luna-schema.js";

/**
 * Round 5C composition relations: the imported Round 4B vocabulary plus a local
 * `coexists-with` for plain conjunction, which Round 4B has no relation for. Round 4B's own
 * contract is unchanged.
 */
export const ROUND5C_RELATION_TYPES = [...RELATION_TYPES, "coexists-with"] as const;
export type Round5CRelationType = typeof ROUND5C_RELATION_TYPES[number];

/**
 * Relations that may witness each connective kind. `while` is polysemous; the reviewer's
 * chosen relation (recorded on confirmation) then decides. `other` accepts any relation.
 */
export const CONNECTIVE_RELATIONS: Record<ConnectiveKind, readonly Round5CRelationType[] | null> = {
  and: ["coexists-with"],
  or: ["choice-vs-disjunction"],
  if: ["condition-of"],
  unless: ["condition-of"],
  while: ["condition-of", "duration-of"],
  until: ["duration-of"],
  during: ["duration-of"],
  before: ["precedes", "antecedent-of"],
  after: ["precedes", "antecedent-of"],
  then: ["precedes", "antecedent-of"],
  reference: ["binds-to"],
  other: null,
};

/** Map a stored connective kind (free-form in v1 rows) onto the typed v2 vocabulary. */
export function normalizeConnectiveKind(kind: string | null | undefined, exactText: string): ConnectiveKind {
  const candidate = (kind ?? "").trim().toLowerCase();
  if ((CONNECTIVE_KINDS as readonly string[]).includes(candidate)) return candidate as ConnectiveKind;
  const word = exactText.trim().toLowerCase();
  if ((CONNECTIVE_KINDS as readonly string[]).includes(word)) return word as ConnectiveKind;
  if (/conj|and/u.test(candidate)) return "and";
  if (/disj|alternat|\bor\b/u.test(candidate)) return "or";
  if (/condition/u.test(candidate)) return "if";
  if (/sequen|order/u.test(candidate)) return "then";
  if (/refer|bind/u.test(candidate)) return "reference";
  return "other";
}

/** The relations that may witness one accepted connective. `null` means any relation. */
export function witnessRelations(kind: ConnectiveKind, reviewedRelation: string | null): readonly string[] | null {
  if (reviewedRelation) return [reviewedRelation];
  return CONNECTIVE_RELATIONS[kind];
}

export type WitnessInputs = {
  connectives: Array<{ proposal_id: number; fragment: string; start_byte: number; end_byte: number; kind: ConnectiveKind; reviewed_relation: string | null }>;
  structural: Array<{ review_id: number; fragment: string; start_byte: number; end_byte: number; kind: string }>;
};

/** Accepted connectives and effective structural reviews one source graph must witness. */
export function loadWitnessInputs(db: DatabaseSync, abilityVersionId: number): WitnessInputs {
  const connectives = (db.prepare(`
    SELECT proposals.id AS proposal_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
      source_spans.exact_text, json_extract(proposals.reason_json, '$.connective_kind') AS kind,
      json_extract(proposals.reason_json, '$.reviewed_relation') AS reviewed_relation
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.role = 'CONNECTIVE' AND proposals.status = 'accepted' AND source_spans.ability_version_id = ?
    ORDER BY source_spans.start_byte, proposals.id
  `).all(abilityVersionId) as Array<{ proposal_id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string; kind: string | null; reviewed_relation: string | null }>)
    .map((row) => ({ ...row, kind: normalizeConnectiveKind(row.kind, row.exact_text) }));
  const structural = db.prepare(`
    SELECT source_atom_reviews.id AS review_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte, source_atom_reviews.kind
    FROM source_atom_reviews JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
    WHERE source_spans.ability_version_id = ? AND ${EFFECTIVE_STRUCTURAL_REVIEW}
    ORDER BY source_spans.start_byte, source_atom_reviews.id
  `).all(abilityVersionId) as WitnessInputs["structural"];
  return { connectives: connectives.map(({ exact_text: _text, ...row }) => row), structural };
}

/**
 * Every reason a grounded source graph fails to witness the reviewed source structure:
 * each accepted connective needs a kind-compatible relation whose evidence covers its exact
 * bytes; each reviewed structural constituent needs a same-kind node on exactly its bytes; and
 * each non-leaf node must be grounded in such a reviewed constituent.
 */
export function sourceWitnessProblems(graph: SourceGraph, inputs: WitnessInputs): string[] {
  const problems: string[] = [];
  for (const connective of inputs.connectives) {
    const allowed = witnessRelations(connective.kind, connective.reviewed_relation);
    const witnessed = graph.relations.some((relation) => relation.evidence.fragment === connective.fragment
      && (relation.evidence.start_byte ?? Infinity) <= connective.start_byte
      && (relation.evidence.end_byte ?? -Infinity) >= connective.end_byte
      && relation.from_node_id !== relation.to_node_id
      && (allowed === null || allowed.includes(relation.type)));
    if (!witnessed) {
      problems.push(`Accepted ${connective.kind} connective at ${connective.fragment}:${connective.start_byte}-${connective.end_byte} has no ${allowed === null ? "" : `${allowed.join(" or ")} `}relation whose evidence covers it.`);
    }
  }
  const exactNode = (fragment: string, start: number, end: number, kind: string) => graph.nodes.some((node) => node.kind === kind
    && node.evidence.fragment === fragment && node.evidence.start_byte === start && node.evidence.end_byte === end);
  for (const constituent of inputs.structural) {
    if (!exactNode(constituent.fragment, constituent.start_byte, constituent.end_byte, constituent.kind)) {
      problems.push(`Reviewed ${constituent.kind} at ${constituent.fragment}:${constituent.start_byte}-${constituent.end_byte} has no same-kind graph node on exactly its bytes.`);
    }
  }
  for (const node of graph.nodes) {
    if (node.kind === "leaf") continue;
    const grounded = inputs.structural.some((constituent) => constituent.kind === node.kind && constituent.fragment === node.evidence.fragment
      && constituent.start_byte === node.evidence.start_byte && constituent.end_byte === node.evidence.end_byte);
    if (!grounded) problems.push(`Graph ${node.kind} node ${node.id} is not grounded in a reviewed ${node.kind} constituent.`);
  }
  return problems;
}
