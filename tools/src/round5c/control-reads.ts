import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { HUMAN_REVIEWERS } from "./authority.js";
import { compileLeaves } from "./compile.js";
import { currentFamilyVersion, REVIEWED_FAMILY_REGISTRY } from "./contracts.js";
import { getCurrentCoverage } from "./coverage.js";
import { tiledSources } from "./leaf-view.js";
import { evaluateStep, type RepairClass, type StepManifest } from "./pilot-report.js";

/**
 * The read-only control-plane views. Every function here only reads; the CLI opens the
 * database read-only before calling them. Counts are by distinct source text (`source_hash`)
 * unless a field says records.
 */

const TRUSTED = "annotations.authority_kind IN ('human', 'derived')";

function rows<T>(db: DatabaseSync, sql: string, ...args: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...args) as T[];
}

// ---------------------------------------------------------------------------------------------
// Family status

export type FamilyState = "DEFINED" | "OBSERVED" | "SUPPORTED" | "MATURE" | "DEPRECATED";

export type FamilyStatus = {
  family_id: string; version: number | null; role: string; state: FamilyState;
  occurrences: number; wordings: number; texts: number; human: number; derived: number; machine: number;
  pending_proposals: number; pending_texts: number;
};

/**
 * Derived family states. OBSERVED: at least one trusted occurrence. SUPPORTED: trusted evidence
 * across at least 3 distinct wordings and 2 distinct texts. MATURE: at least 5 wordings and 10
 * texts. DEPRECATED: every registered version is retired. DEFINED: registered, never observed.
 */
export function familyStatus(db: DatabaseSync): FamilyStatus[] {
  const evidence = new Map(rows<{ family_id: string; occurrences: number; wordings: number; texts: number; human: number; derived: number; machine: number }>(db, `
    SELECT fingerprints.family_id, sum(annotations.authority_kind <> 'machine') AS occurrences,
      count(DISTINCT CASE WHEN ${TRUSTED} THEN source_spans.normalized_surface END) AS wordings,
      count(DISTINCT CASE WHEN ${TRUSTED} THEN abilities.source_hash END) AS texts,
      sum(annotations.authority_kind = 'human') AS human, sum(annotations.authority_kind = 'derived') AS derived,
      sum(annotations.authority_kind = 'machine') AS machine
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id AND abilities.current = 1
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' GROUP BY fingerprints.family_id
  `).map((row) => [row.family_id, row]));
  const pending = new Map(rows<{ family_id: string; proposals: number; texts: number }>(db, `
    SELECT fingerprints.family_id, count(*) AS proposals, count(DISTINCT abilities.source_hash) AS texts
    FROM proposals JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id AND abilities.current = 1
    WHERE proposals.status = 'pending' GROUP BY fingerprints.family_id
  `).map((row) => [row.family_id, row]));
  const ids = [...new Set(REVIEWED_FAMILY_REGISTRY.map((family) => family.id))].sort();
  return ids.map((id) => {
    const versions = REVIEWED_FAMILY_REGISTRY.filter((family) => family.id === id);
    const live = versions.filter((family) => !family.deprecated);
    const found = evidence.get(id);
    const occurrences = found?.occurrences ?? 0;
    const wordings = found?.wordings ?? 0;
    const texts = found?.texts ?? 0;
    const state: FamilyState = live.length === 0 ? "DEPRECATED"
      : wordings >= 5 && texts >= 10 ? "MATURE"
        : wordings >= 3 && texts >= 2 ? "SUPPORTED"
          : occurrences > 0 ? "OBSERVED" : "DEFINED";
    return {
      family_id: id, version: live.length ? currentFamilyVersion(id) : null, role: versions.at(-1)!.role, state,
      occurrences, wordings, texts, human: found?.human ?? 0, derived: found?.derived ?? 0, machine: found?.machine ?? 0,
      pending_proposals: pending.get(id)?.proposals ?? 0, pending_texts: pending.get(id)?.texts ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Frontier

export type FrontierKind = "wording" | "family" | "near-complete" | "disagreement" | "first-evidence";
export const FRONTIER_KINDS: readonly FrontierKind[] = ["wording", "family", "near-complete", "disagreement", "first-evidence"];

type PendingSpan = {
  proposal_id: number; ability_version_id: number; source_hash: string; normalized_surface: string | null; exact_text: string;
  fingerprint_id: string | null; family_id: string | null; parameters_json: string | null; role: string; span_id: number;
};

function pendingSpans(db: DatabaseSync): PendingSpan[] {
  return rows<PendingSpan>(db, `
    SELECT proposals.id AS proposal_id, abilities.id AS ability_version_id, abilities.source_hash, source_spans.normalized_surface,
      source_spans.exact_text, proposals.fingerprint_id, fingerprints.family_id, fingerprints.parameters_json, proposals.role, source_spans.id AS span_id
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id AND abilities.current = 1
    LEFT JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    WHERE proposals.status = 'pending' AND proposals.role <> 'CONNECTIVE'
  `);
}

/**
 * Where the next human decision buys the most. Each item carries `weight` (higher first) and
 * the action that would take it:
 * - wording: one pending wording, weight = distinct texts it occurs in × purity (the share of its
 *   proposals agreeing on one meaning); confirming it as a surface decides every occurrence.
 * - near-complete: texts with trusted leaves whose remaining unaccounted bytes are few; weight =
 *   1 / remaining bytes.
 * - family: families by distinct texts waiting on a pending proposal of that family.
 * - disagreement: pending spans where Jev's top family differs from the proposal's.
 * - first-evidence: families with no trusted occurrence yet but pending proposals.
 */
export function frontier(db: DatabaseSync, kind: FrontierKind, limit: number): Array<Record<string, unknown>> {
  if (kind === "wording") {
    const bySurface = new Map<string, PendingSpan[]>();
    for (const span of pendingSpans(db)) {
      if (!span.normalized_surface || !span.fingerprint_id) continue;
      bySurface.set(span.normalized_surface, [...(bySurface.get(span.normalized_surface) ?? []), span]);
    }
    return [...bySurface.entries()].map(([surface, spans]) => {
      const counts = new Map<string, number>();
      for (const span of spans) counts.set(span.fingerprint_id!, (counts.get(span.fingerprint_id!) ?? 0) + 1);
      const [top, topCount] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]!;
      const example = spans.find((span) => span.fingerprint_id === top)!;
      const texts = new Set(spans.map((span) => span.source_hash)).size;
      const purity = topCount / spans.length;
      return {
        kind, weight: texts * purity, surface, texts, occurrences: spans.length, purity,
        family_id: example.family_id, parameters: JSON.parse(example.parameters_json!), example_proposal_id: example.proposal_id,
        action: "surface",
      };
    }).sort((left, right) => right.weight - left.weight).slice(0, limit);
  }
  if (kind === "near-complete") {
    const seen = new Set<string>();
    const hashes = new Map(rows<{ id: number; source_hash: string; faction_id: string; ability_id: string }>(db, "SELECT id, source_hash, faction_id, ability_id FROM abilities WHERE current = 1").map((row) => [row.id, row]));
    const items: Array<Record<string, unknown> & { weight: number }> = [];
    for (const [id, coverage] of getCurrentCoverage(db)) {
      const ability = hashes.get(id)!;
      if (coverage.leaf_bytes.numerator === 0 || coverage.unaccounted.length === 0 || seen.has(ability.source_hash)) continue;
      seen.add(ability.source_hash);
      const remaining = coverage.unaccounted.reduce((sum, item) => sum + item.end_byte - item.start_byte, 0);
      items.push({
        kind, weight: 1 / Math.max(remaining, 1), ability_version_id: id, faction_id: ability.faction_id, ability_id: ability.ability_id,
        remaining_bytes: remaining, leaf_fraction: coverage.leaf_fraction,
        remaining: coverage.unaccounted.map((item) => ({ fragment: item.fragment, start_byte: item.start_byte, end_byte: item.end_byte, text: item.text })),
        action: "review",
      });
    }
    return items.sort((left, right) => right.weight - left.weight).slice(0, limit);
  }
  if (kind === "family" || kind === "first-evidence") {
    return familyStatus(db)
      .filter((family) => family.pending_texts > 0 && (kind === "family" || family.state === "DEFINED"))
      .map((family) => ({ kind, weight: family.pending_texts, ...family, action: "review" }))
      .sort((left, right) => right.weight - left.weight).slice(0, limit);
  }
  // disagreement
  const jev = new Map(rows<{ span_id: number; family_id: string; score: number | null }>(db, "SELECT span_id, family_id, score FROM span_signals WHERE source = 'jev-family' AND rank = 1").map((row) => [row.span_id, row]));
  return pendingSpans(db)
    .flatMap((span) => {
      const top = jev.get(span.span_id);
      if (!top || !span.family_id || top.family_id === span.family_id) return [];
      return [{
        kind, weight: top.score ?? 0, proposal_id: span.proposal_id, ability_version_id: span.ability_version_id, exact_text: span.exact_text,
        proposed_family: span.family_id, jev_family: top.family_id, jev_probability: top.score, action: "review",
      }];
    })
    .sort((left, right) => right.weight - left.weight).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Segmentation and classification health

/** Every pilot step's frozen evaluation, and their sum over reviewed texts. */
export function segmentationHealth(db: DatabaseSync, artifactDirectory: string): Record<string, unknown> {
  const root = resolve(artifactDirectory, "pilot-steps");
  const steps = existsSync(root) ? readdirSync(root).filter((name) => existsSync(resolve(root, name, "manifest.json"))).sort() : [];
  const totals: Record<RepairClass, number> = { unchanged: 0, expanded: 0, shrunk: 0, split: 0, merged: 0, added: 0, removed: 0 };
  let reviewedTexts = 0;
  const perStep = steps.map((step) => {
    const manifest = JSON.parse(readFileSync(resolve(root, step, "manifest.json"), "utf8")) as StepManifest;
    const evaluation = evaluateStep(db, manifest);
    if (evaluation.repairs) {
      for (const [name, count] of Object.entries(evaluation.repairs)) totals[name as RepairClass] += count;
      reviewedTexts += evaluation.reviewed_abilities.length;
    }
    return { step, reviewed: evaluation.reviewed_abilities.length, unreviewed: evaluation.unreviewed_abilities.length, repairs: evaluation.repairs, unchanged_rate: evaluation.segmentation_unchanged_rate };
  });
  const cut = totals.unchanged + totals.expanded + totals.shrunk + totals.split + totals.merged + totals.removed;
  const repaired = Object.entries(totals).reduce((sum, [name, count]) => sum + (name === "unchanged" ? 0 : count), 0);
  return {
    steps: perStep, reviewed_texts: reviewedTexts, repairs: totals,
    unchanged_rate: cut === 0 ? null : totals.unchanged / cut,
    repairs_per_text: reviewedTexts === 0 ? null : repaired / reviewedTexts,
  };
}

/**
 * How often the model's family and Jev's ranking match what Will decided on the same bytes,
 * corpus-wide (not only pilot steps). The top confusions name the family pairs to fix first.
 */
export function classificationHealth(db: DatabaseSync, limit: number): Record<string, unknown> {
  const decided = rows<{ span_id: number; family_id: string }>(db, `
    SELECT source_spans.id AS span_id, fingerprints.family_id FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND annotations.authority_kind = 'human'
  `);
  const human = new Map(decided.map((row) => [row.span_id, row.family_id]));
  const model = rows<{ span_id: number; family_id: string; origin: string }>(db, `
    SELECT proposals.span_id, fingerprints.family_id, proposals.origin FROM proposals JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    WHERE proposals.origin = 'luna' AND proposals.status IN ('accepted', 'rejected', 'corrected')
  `);
  const confusions = new Map<string, number>();
  let modelCorrect = 0;
  let modelCompared = 0;
  for (const row of model) {
    const truth = human.get(row.span_id);
    if (!truth) continue;
    modelCompared += 1;
    if (truth === row.family_id) modelCorrect += 1;
    else confusions.set(`${row.family_id} → ${truth}`, (confusions.get(`${row.family_id} → ${truth}`) ?? 0) + 1);
  }
  const ranked = new Map<number, string[]>();
  for (const row of rows<{ span_id: number; family_id: string; rank: number }>(db, "SELECT span_id, family_id, rank FROM span_signals WHERE source = 'jev-family' ORDER BY span_id, rank")) {
    ranked.set(row.span_id, [...(ranked.get(row.span_id) ?? []), row.family_id]);
  }
  let top1 = 0;
  let top3 = 0;
  let jevCompared = 0;
  for (const [spanId, families] of ranked) {
    const truth = human.get(spanId);
    if (!truth) continue;
    jevCompared += 1;
    if (families[0] === truth) top1 += 1;
    if (families.slice(0, 3).includes(truth)) top3 += 1;
  }
  return {
    model_family: { correct: modelCorrect, compared: modelCompared, accuracy: modelCompared ? modelCorrect / modelCompared : null },
    jev_family: { top1, top3, compared: jevCompared, top1_rate: jevCompared ? top1 / jevCompared : null, top3_rate: jevCompared ? top3 / jevCompared : null },
    top_confusions: [...confusions.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit).map(([pair, count]) => ({ pair, count })),
  };
}

// ---------------------------------------------------------------------------------------------
// Gaps

/**
 * Open gaps as recorded (by type), plus the derived taxonomy: LEAF (texts with trusted leaves
 * and source still unaccounted), COMPOSITION (fully tiled texts that do not compile, grouped by
 * the first compile error), DSL (recorded DSL gaps).
 */
export function gapsReport(db: DatabaseSync, limit: number): Record<string, unknown> {
  const recorded = rows<{ type: string; n: number }>(db, "SELECT type, count(*) AS n FROM gaps WHERE status = 'open' GROUP BY type ORDER BY n DESC");
  const dsl = rows<{ ability_version_id: number; faction_id: string; ability_id: string; description: string }>(db, `
    SELECT gaps.ability_version_id, abilities.faction_id, abilities.ability_id, gaps.description FROM gaps
    JOIN abilities ON abilities.id = gaps.ability_version_id WHERE gaps.status = 'open' AND gaps.type = 'DSL_GAP' ORDER BY gaps.id DESC
  `);
  const hashes = new Map(rows<{ id: number; source_hash: string }>(db, "SELECT id, source_hash FROM abilities WHERE current = 1").map((row) => [row.id, row.source_hash]));
  const leafTexts = new Set<string>();
  let leafBytes = 0;
  for (const [id, coverage] of getCurrentCoverage(db)) {
    if (coverage.leaf_bytes.numerator === 0 || coverage.unaccounted.length === 0) continue;
    const hash = hashes.get(id)!;
    if (leafTexts.has(hash)) continue;
    leafTexts.add(hash);
    leafBytes += coverage.unaccounted.reduce((sum, item) => sum + item.end_byte - item.start_byte, 0);
  }
  const errors = new Map<string, { count: number; examples: string[] }>();
  const compiled = new Set<string>();
  let tiledTexts = 0;
  for (const source of tiledSources(db)) {
    if (compiled.has(source.source_hash)) continue;
    compiled.add(source.source_hash);
    tiledTexts += 1;
    const result = compileLeaves(source.leaves, source.source_text);
    if (result.ok) continue;
    const key = result.errors[0] ?? "unknown";
    const entry = errors.get(key) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push(`${source.faction_id}/${source.ability_id} (${source.id})`);
    errors.set(key, entry);
  }
  const compositionFailures = [...errors.values()].reduce((sum, entry) => sum + entry.count, 0);
  return {
    recorded_open: Object.fromEntries(recorded.map((row) => [row.type, row.n])),
    leaf: { texts: leafTexts.size, unaccounted_bytes: leafBytes },
    composition: {
      tiled_texts: tiledTexts, failing_texts: compositionFailures,
      errors: [...errors.entries()].sort((left, right) => right[1].count - left[1].count).slice(0, limit).map(([error, entry]) => ({ error, ...entry })),
    },
    dsl: { open: dsl.length, recent: dsl.slice(0, limit) },
  };
}

// ---------------------------------------------------------------------------------------------
// Sessions and the horizontal-to-vertical trigger

const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * Human review sessions: human batches separated by less than 30 minutes of idle time. Each
 * reports its decisions (annotation, connective and proposal members written).
 */
export function reviewSessions(db: DatabaseSync, limit: number): Array<{ started_at: string; ended_at: string; batches: number; decisions: number }> {
  const batches = rows<{ id: string; reviewer: string; created_at: string; decisions: number }>(db, `
    SELECT annotation_batches.id, annotation_batches.reviewer, annotation_batches.created_at,
      (SELECT count(*) FROM batch_members WHERE batch_members.batch_id = annotation_batches.id) AS decisions
    FROM annotation_batches WHERE annotation_batches.operation IN ('review', 'pilot-review') ORDER BY annotation_batches.created_at
  `).filter((batch) => HUMAN_REVIEWERS.has(batch.reviewer));
  const sessions: Array<{ started_at: string; ended_at: string; batches: number; decisions: number }> = [];
  for (const batch of batches) {
    const last = sessions.at(-1);
    if (last && Date.parse(batch.created_at) - Date.parse(last.ended_at) < SESSION_IDLE_MS) {
      last.ended_at = batch.created_at;
      last.batches += 1;
      last.decisions += batch.decisions;
    } else {
      sessions.push({ started_at: batch.created_at, ended_at: batch.created_at, batches: 1, decisions: batch.decisions });
    }
  }
  return sessions.slice(-limit);
}

/** Distinct texts whose whole source is accounted for by trusted rows. */
export function leafCompleteTexts(db: DatabaseSync): number {
  const hashes = new Map(rows<{ id: number; source_hash: string }>(db, "SELECT id, source_hash FROM abilities WHERE current = 1").map((row) => [row.id, row.source_hash]));
  const complete = new Set<string>();
  for (const [id, coverage] of getCurrentCoverage(db)) {
    if (coverage.leaf_bytes.numerator > 0 && coverage.unaccounted.length === 0) complete.add(hashes.get(id)!);
  }
  return complete.size;
}

// ---------------------------------------------------------------------------------------------
// Query

/** Run one SQL statement against a read-only connection; at most `limit` rows come back. */
export function readQuery(db: DatabaseSync, sql: string, limit: number): { rows: unknown[]; truncated: boolean } {
  if (!sql.trim()) throw Object.assign(new Error("query needs SQL."), { code: "INVALID_ARGUMENT" });
  const statement = db.prepare(sql);
  const result: unknown[] = [];
  for (const row of statement.iterate()) {
    if (result.length === limit) return { rows: result, truncated: true };
    result.push(row);
  }
  return { rows: result, truncated: false };
}
