import type { DatabaseSync } from "node:sqlite";

import { renderMechanicsPreview, resolveAbilityEntity, round5cDataRoot } from "./assembly.js";
import { getAbility } from "./review.js";
import { previewStamp, stampApprovalEligibility } from "./stamps.js";
import { describeAbility } from "../translate/effect.js";

/**
 * The composition round trip for one source version: what the reviewer confirmed, what the
 * currently authored DSL says, and what each composition rule matching this source would
 * produce and render as. Read-only; nothing here approves or writes.
 */

type GraphSummary = {
  nodes: Array<{ id: string; kind: string; family: string | null; parameters: unknown; evidence: string }>;
  relations: Array<{ type: string; from: string; to: string }>;
};

export type RoundTripRule = {
  stamp_id: string;
  revision: number;
  label: string;
  status: string;
  challenge: string | null;
  /** The independent challenger's verdict and findings, when a challenge has run. */
  challenge_findings: string[];
  approvable: boolean;
  blocker: string | null;
  preview_status: string;
  graph: GraphSummary | null;
  mechanics: unknown;
  rendered_text: string | null;
  errors: string[];
  /** Mismatches between this rule and the reviewed decomposition a human should see first. */
  warnings: string[];
};

export type RoundTrip = {
  ability_version_id: number;
  source_text: string;
  decomposition: Array<{ kind: "leaf" | "structural" | "connective"; text: string; label: string; detail: unknown }>;
  current: { rendered_text: string | null; effect: unknown; error: string | null };
  rules: RoundTripRule[];
  drafts: Array<{ id: string; status: string; rendered_text: string | null; diagnostic: unknown; stamp_id: string; stamp_revision: number }>;
};

function summarizeGraph(value: unknown): GraphSummary | null {
  if (!value || typeof value !== "object") return null;
  const graph = value as { nodes?: Array<Record<string, unknown>>; relations?: Array<Record<string, unknown>> };
  return {
    nodes: (graph.nodes ?? []).map((node) => {
      const evidence = node.evidence as { first_segment_id?: string; last_segment_id?: string } | undefined;
      return {
        id: String(node.id), kind: String(node.kind), family: typeof node.family_id === "string" ? node.family_id : null, parameters: node.parameters ?? {},
        evidence: evidence ? (evidence.first_segment_id === evidence.last_segment_id ? String(evidence.first_segment_id) : `${evidence.first_segment_id}…${evidence.last_segment_id}`) : "",
      };
    }),
    relations: (graph.relations ?? []).map((relation) => ({ type: String(relation.type), from: String(relation.from_node_id), to: String(relation.to_node_id) })),
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
    : item);
}

/**
 * Cheap, explainable checks of a rule against what the reviewer confirmed: every graph leaf
 * must equal a reviewed leaf's family and parameters, every reviewed leaf must appear in the
 * graph, and mechanics without any condition cannot carry a reviewed condition.
 */
function ruleWarnings(graph: GraphSummary | null, mechanics: unknown, leaves: Array<{ family: string; parameters: unknown; text: string; role: string }>): string[] {
  const warnings: string[] = [];
  if (!graph) return warnings;
  const graphLeaves = graph.nodes.filter((node) => node.kind === "leaf");
  for (const node of graphLeaves) {
    if (!leaves.some((leaf) => leaf.family === node.family && stable(leaf.parameters) === stable(node.parameters))) {
      warnings.push(`Graph leaf ${node.id} (${node.family} ${stable(node.parameters)}) matches no reviewed leaf.`);
    }
  }
  for (const leaf of leaves) {
    if (!graphLeaves.some((node) => node.family === leaf.family && stable(node.parameters) === stable(leaf.parameters))) {
      warnings.push(`Reviewed ${leaf.role} "${leaf.text}" (${leaf.family}) is missing from the graph.`);
    }
  }
  // Events are often implicit in the effect (a Hit re-roll happens during an attack), so only a
  // missing condition is flagged; compare the rendered English for everything else.
  const serialized = mechanics === null || mechanics === undefined ? "" : JSON.stringify(mechanics);
  if (!/"type":"conditional"|"condition"/u.test(serialized)) {
    for (const leaf of leaves) if (leaf.role === "CONDITION") warnings.push(`Mechanics carry no condition, so "${leaf.text}" is dropped from the DSL.`);
  }
  return warnings;
}

function occurrenceFor(db: DatabaseSync, stampId: string, revision: number, abilityVersionId: number): { status: string; output: { graph?: unknown; mechanics?: unknown } | null } | null {
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const preview = previewStamp(db, stampId, revision, cursor ? { cursor } : {});
    const found = preview.examples.find((example) => example.ability_version_id === abilityVersionId);
    if (found) return { status: found.status, output: found.output as { graph?: unknown; mechanics?: unknown } | null };
    if (!preview.next_cursor) return null;
    cursor = preview.next_cursor;
  }
  return null;
}

export function abilityRoundTrip(db: DatabaseSync, abilityVersionId: number): RoundTrip {
  const view = getAbility(db, abilityVersionId);
  const connectives = db.prepare(`
    SELECT source_spans.exact_text, json_extract(proposals.reason_json, '$.connective_kind') AS kind,
      json_extract(proposals.reason_json, '$.reviewed_relation') AS relation
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.role = 'CONNECTIVE' AND proposals.status = 'accepted' AND source_spans.ability_version_id = ?
    ORDER BY source_spans.start_byte
  `).all(view.id) as Array<{ exact_text: string; kind: string | null; relation: string | null }>;
  const decomposition: RoundTrip["decomposition"] = [
    ...view.annotations.map((annotation) => ({
      kind: "leaf" as const, text: annotation.exact_text, label: `${annotation.role} · ${annotation.family_id}`,
      detail: annotation.parameters, start: annotation.start_byte,
    })),
    ...view.atoms.reviews.map((review) => ({ kind: "structural" as const, text: review.exact_text, label: review.kind, detail: null, start: review.start_byte })),
  ].sort((left, right) => left.start - right.start).map(({ start: _start, ...rest }) => rest);
  decomposition.push(...connectives.map((row) => ({ kind: "connective" as const, text: row.exact_text, label: `connective · ${row.kind ?? "other"}`, detail: row.relation ? { relation: row.relation } : null })));

  let current: RoundTrip["current"];
  try {
    const entity = resolveAbilityEntity(round5cDataRoot(), view.faction_id, view.ability_id);
    current = { rendered_text: describeAbility(entity.entry as never), effect: entity.entry.effect ?? null, error: null };
  } catch (error) {
    current = { rendered_text: null, effect: null, error: error instanceof Error ? error.message : String(error) };
  }

  const stamps = db.prepare(`
    SELECT stamps.id, stamps.revision, stamps.status, json_extract(stamps.definition_json, '$.label') AS label
    FROM stamps
    WHERE stamps.kind = 'composition' AND stamps.status <> 'superseded'
      AND stamps.revision = (SELECT max(revision) FROM stamps AS latest WHERE latest.id = stamps.id)
    ORDER BY stamps.updated_at DESC
  `).all() as Array<{ id: string; revision: number; status: string; label: string | null }>;
  const rules: RoundTripRule[] = [];
  for (const stamp of stamps) {
    let occurrence: ReturnType<typeof occurrenceFor>;
    try {
      occurrence = occurrenceFor(db, stamp.id, stamp.revision, view.id);
    } catch (error) {
      // A rule whose evidence no longer validates cannot preview; surface it only if it names this source.
      continue;
    }
    if (!occurrence) continue;
    const eligibility = stampApprovalEligibility(db, stamp.id, stamp.revision);
    const challengeRun = db.prepare(`
      SELECT model_runs.output_json FROM stamps JOIN model_runs ON model_runs.id = stamps.challenge_run_id
      WHERE stamps.id = ? AND stamps.revision = ?
    `).get(stamp.id, stamp.revision) as { output_json: string | null } | undefined;
    const challengeFindings: string[] = [];
    if (challengeRun?.output_json) {
      const output = JSON.parse(challengeRun.output_json) as { items?: Array<{ item_id?: string; result?: { verdict?: string; findings?: Array<{ message?: string }> } }> };
      const result = output.items?.find((item) => item.item_id === `${stamp.id}@${stamp.revision}`)?.result;
      if (result?.verdict) challengeFindings.push(`Verdict: ${result.verdict}`);
      for (const finding of result?.findings ?? []) if (finding.message) challengeFindings.push(finding.message);
    }
    const render = renderMechanicsPreview(view.faction_id, view.ability_id, occurrence.output?.mechanics ?? null);
    const graph = summarizeGraph(occurrence.output?.graph);
    rules.push({
      stamp_id: stamp.id,
      revision: stamp.revision,
      label: stamp.label ?? stamp.id,
      status: stamp.status,
      challenge: eligibility.challenge.required ? eligibility.challenge.state : "not-required",
      challenge_findings: challengeFindings,
      approvable: eligibility.approvable,
      blocker: eligibility.blocker?.message ?? null,
      preview_status: occurrence.status,
      graph,
      mechanics: occurrence.output?.mechanics ?? null,
      rendered_text: render.rendered_text,
      errors: render.errors,
      warnings: ruleWarnings(graph, occurrence.output?.mechanics ?? null, view.annotations.map((annotation) => ({
        family: annotation.family_id, parameters: annotation.parameters, text: annotation.exact_text, role: annotation.role,
      }))),
    });
  }

  const drafts = (db.prepare(`
    SELECT assembly_drafts.id, assembly_drafts.status, assembly_drafts.rendered_text, assembly_drafts.diagnostic_json,
      stamp_applications.stamp_id, stamp_applications.stamp_revision
    FROM assembly_drafts JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    WHERE stamp_applications.ability_version_id = ? AND assembly_drafts.status <> 'stale'
    ORDER BY assembly_drafts.updated_at DESC
  `).all(view.id) as Array<{ id: string; status: string; rendered_text: string | null; diagnostic_json: string; stamp_id: string; stamp_revision: number }>)
    .map(({ diagnostic_json, ...row }) => ({ ...row, diagnostic: JSON.parse(diagnostic_json) }));

  return { ability_version_id: view.id, source_text: view.source_text, decomposition, current, rules, drafts };
}
