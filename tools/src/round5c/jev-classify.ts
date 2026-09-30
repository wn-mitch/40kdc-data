import { noul, choice, type ChoiceCriteria, type Questions } from "@typesafe-ai/sdk";
import type { DatabaseSync } from "node:sqlite";

import { familyFitsKind, REVIEWED_FAMILY_REGISTRY, type SemanticFamilyDefinition } from "./contracts.js";
import { mapWithConcurrency } from "./concurrency.js";
import { askChoiceRanked, askMany, clip, JevBudget, JEV_MODEL, NONE_OF_THESE, type JevClient } from "./jev-core.js";
import { choices, type Property } from "./leaf-prefill.js";
import { leafSurfaceKey } from "./matching.js";

/**
 * Jev as a family classifier for an already-cut span ("arm A"): one `choice` over every active
 * family that fits the ability's rule kind, plus none, each option glossed by its label,
 * description, and at most three trusted example wordings. A second request asks the chosen
 * family's closed parameters, all in one state. Jev sees only the span's own text, never another
 * labeler's answer, so its agreement with DeepSeek is an independent second opinion.
 *
 * Results are signals (`span_signals`), never decisions. Examples come from trusted rows only
 * and never include the span's own wording, so a span cannot be classified by copying itself.
 */

export const EXAMPLES_PER_FAMILY = 3;
const TIMEOUT_MS = 60_000;
const STATE_CONTEXT = "A phrase cut from a Warhammer 40,000 rule. Which rule piece does it express?";

export type ClassifySpan = { span_id: number; text: string; kind: string | null; fragment?: string };

export type JevClassification = {
  span_id: number;
  /** Families by probability, most probable first (at most five), `none-of-these` included. */
  ranked: Array<{ family_id: string; probability: number }>;
  margin: number | null;
  parameters: Record<string, unknown> | null;
  parameter_confidence: Record<string, number>;
  unresolved_parameters: string[];
};

export type JevClassifyReport = {
  model: string; spans: number; classified: number; already: number; unanswered: number;
  cost_usd: number; requests: number; cache_hits: number; latency_ms: number; budget_exhausted: boolean;
};

type Example = { surface: string; text: string; count: number };

/** Trusted wordings per family, most frequent first. */
function trustedWordings(db: DatabaseSync): Map<string, Example[]> {
  const byFamily = new Map<string, Map<string, Example>>();
  for (const row of db.prepare(`
    SELECT fingerprints.family_id, source_spans.exact_text
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND annotations.authority_kind IN ('human', 'derived')
  `).all() as Array<{ family_id: string; exact_text: string }>) {
    const surface = leafSurfaceKey(row.exact_text);
    if (!surface) continue;
    const family = byFamily.get(row.family_id) ?? new Map<string, Example>();
    const example = family.get(surface) ?? { surface, text: row.exact_text.trim(), count: 0 };
    example.count += 1;
    family.set(surface, example);
    byFamily.set(row.family_id, family);
  }
  return new Map([...byFamily].map(([family, examples]) => [family, [...examples.values()].sort((left, right) => right.count - left.count || left.surface.localeCompare(right.surface))]));
}

const tokens = (text: string) => new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
function overlap(left: Set<string>, right: Set<string>): number {
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

/**
 * Up to three examples that span a family's wording: the most frequent (its canonical form),
 * then repeatedly the wording least like those already chosen. A common family gets no more
 * room than a rare one.
 */
export function pickExamples(examples: readonly Example[], exclude: string): string[] {
  const pool = examples.filter((example) => example.surface !== exclude);
  if (pool.length === 0) return [];
  const chosen: Example[] = [pool[0]!];
  while (chosen.length < EXAMPLES_PER_FAMILY) {
    const chosenTokens = chosen.map((example) => tokens(example.surface));
    let best: Example | null = null;
    let bestScore = Infinity;
    for (const candidate of pool) {
      if (chosen.includes(candidate)) continue;
      const score = Math.max(...chosenTokens.map((set) => overlap(tokens(candidate.surface), set)));
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map((example) => clip(example.text, 80));
}

function activeFamilies(kind: string | null): SemanticFamilyDefinition[] {
  return REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated && (kind === null || familyFitsKind(family, kind)));
}

function familyCriteria(families: readonly SemanticFamilyDefinition[], wordings: Map<string, Example[]>, exclude: string): ChoiceCriteria {
  const criteria: ChoiceCriteria = { [NONE_OF_THESE]: "The phrase is not any of these rule pieces." };
  for (const family of families) {
    const examples = pickExamples(wordings.get(family.id) ?? [], exclude);
    const gloss = `${family.label}: ${clip(family.description)}`;
    criteria[family.id] = examples.length > 0 ? `${gloss} Examples: ${examples.map((example) => `"${example}"`).join("; ")}` : gloss;
  }
  return criteria;
}

/** The chosen family's closed parameters (enums and booleans), as one question each. */
function parameterQuestions(family: SemanticFamilyDefinition): { questions: Questions; open: string[] } {
  const properties = (family.parameterSchema as { properties?: Record<string, Property> }).properties ?? {};
  const questions: Questions = {};
  const open: string[] = [];
  for (const [name, property] of Object.entries(properties)) {
    const options = choices(property);
    if (property.type === "boolean") questions[name] = noul(`For "${family.label}", is "${name}" true of this phrase?`);
    else if (options.length > 0) {
      const criteria: ChoiceCriteria = { [NONE_OF_THESE]: "None of these; the phrase does not say." };
      for (const option of options) criteria[option] = null;
      questions[name] = choice(`For "${family.label}", what is "${name}" in this phrase?`, criteria);
    } else open.push(name);
  }
  return { questions, open };
}

/**
 * Classify spans with Jev and record each answer as signals. A span that already has a
 * `jev-family` signal is skipped, so a resumed step never pays twice.
 */
export async function classifySpans(
  db: DatabaseSync, client: JevClient, spans: readonly ClassifySpan[],
  options: { spendCapUsd: number; concurrency?: number; priorSpendUsd?: number } ,
): Promise<{ report: JevClassifyReport; results: JevClassification[] }> {
  const budget = new JevBudget(Math.max(0, options.spendCapUsd - (options.priorSpendUsd ?? 0)));
  const wordings = trustedWordings(db);
  const done = db.prepare("SELECT 1 FROM span_signals WHERE span_id = ? AND source = 'jev-family' LIMIT 1");
  // One question per span: two runs (or two proposals) on the same bytes share one answer.
  const unique = [...new Map(spans.map((span) => [span.span_id, span])).values()];
  const pending = unique.filter((span) => !done.get(span.span_id));
  const results: JevClassification[] = [];
  let unanswered = 0;
  await mapWithConcurrency(pending, options.concurrency ?? 8, async (span) => {
    if (budget.exhausted()) { unanswered += 1; return; }
    const surface = leafSurfaceKey(span.text);
    // A Stratagem's WHEN line is its use window or a trigger, nothing else.
    const families = activeFamilies(span.kind).filter((family) => span.kind !== "stratagem" || span.fragment !== "WHEN" || family.id === "use-window" || family.role === "EVENT");
    const state = { phrase: span.text, context: STATE_CONTEXT };
    const key = `span:${span.span_id}`;
    const ranked = await askChoiceRanked(client, TIMEOUT_MS, budget, key, "family", state, "Which rule piece does this phrase express?", familyCriteria(families, wordings, surface));
    if (!ranked) { unanswered += 1; return; }
    const top = ranked.slice(0, 5).map((item) => ({ family_id: item.value, probability: item.probability }));
    const result: JevClassification = {
      span_id: span.span_id, ranked: top,
      margin: top.length > 1 ? top[0]!.probability - top[1]!.probability : null,
      parameters: null, parameter_confidence: {}, unresolved_parameters: [],
    };
    const family = families.find((item) => item.id === top[0]?.family_id);
    if (family && !budget.exhausted()) {
      const { questions, open } = parameterQuestions(family);
      result.unresolved_parameters.push(...open);
      if (Object.keys(questions).length > 0) {
        const answers = await askMany(client, TIMEOUT_MS, budget, key, "parameter", state, questions);
        if (answers) {
          result.parameters = {};
          for (const [name, answer] of Object.entries(answers)) {
            if (answer.type === "noul") { result.parameters[name] = answer.noul >= 0.5; result.parameter_confidence[name] = Math.max(answer.noul, 1 - answer.noul); }
            else if (answer.type === "choice" && answer.choice !== NONE_OF_THESE) { result.parameters[name] = answer.choice; result.parameter_confidence[name] = answer.confidence; }
            else result.unresolved_parameters.push(name);
          }
        } else result.unresolved_parameters.push(...Object.keys(questions));
      }
    }
    results.push(result);
  });
  const insert = db.prepare(`
    INSERT INTO span_signals (span_id, source, family_id, family_version, rank, score, payload_json, model_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `);
  const now = new Date().toISOString();
  const costBySpan = new Map<string, number>();
  for (const entry of budget.log) costBySpan.set(entry.span_key, (costBySpan.get(entry.span_key) ?? 0) + entry.cost_usd);
  const version = (id: string) => REVIEWED_FAMILY_REGISTRY.find((family) => family.id === id && !family.deprecated)?.version ?? null;
  for (const result of results) {
    result.ranked.forEach((item, index) => insert.run(result.span_id, "jev-family", item.family_id, version(item.family_id), index + 1, item.probability,
      JSON.stringify({ model: JEV_MODEL, margin: index === 0 ? result.margin : null, ...(index === 0 ? { cost_usd: costBySpan.get(`span:${result.span_id}`) ?? 0 } : {}) }), now));
    if (result.parameters !== null || result.unresolved_parameters.length > 0) {
      const top = result.ranked[0]!;
      insert.run(result.span_id, "jev-parameters", top.family_id, version(top.family_id), 1, null,
        JSON.stringify({ model: JEV_MODEL, parameters: result.parameters, confidence: result.parameter_confidence, unresolved: result.unresolved_parameters }), now);
    }
  }
  return {
    results,
    report: {
      model: JEV_MODEL, spans: unique.length, classified: results.length, already: unique.length - pending.length, unanswered,
      cost_usd: budget.totalCostUsd, requests: budget.requests, cache_hits: budget.cacheHits, latency_ms: budget.totalLatencyMs,
      budget_exhausted: budget.exhausted(),
    },
  };
}

/** What Jev has already cost for these spans: the per-span cost stored on each top-ranked signal. */
export function jevSpendFor(db: DatabaseSync, spanIds: readonly number[]): number {
  if (spanIds.length === 0) return 0;
  const row = db.prepare(`
    SELECT COALESCE(SUM(json_extract(payload_json, '$.cost_usd')), 0) AS total FROM span_signals
    WHERE source = 'jev-family' AND rank = 1 AND span_id IN (${spanIds.map(Number).filter(Number.isSafeInteger).join(",")})
  `).get() as { total: number };
  return row.total;
}

/** The Jev family ranking and parameter answer recorded for each span. */
export function jevSignalsFor(db: DatabaseSync, spanIds: readonly number[]): Map<number, { ranked: Array<{ family_id: string; probability: number }>; parameters: Record<string, unknown> | null }> {
  const result = new Map<number, { ranked: Array<{ family_id: string; probability: number }>; parameters: Record<string, unknown> | null }>();
  if (spanIds.length === 0) return result;
  const list = spanIds.map(Number).filter(Number.isSafeInteger).join(",");
  for (const row of db.prepare(`SELECT span_id, source, family_id, rank, score, payload_json FROM span_signals WHERE span_id IN (${list}) AND source IN ('jev-family', 'jev-parameters') ORDER BY span_id, source, rank`).all() as Array<{ span_id: number; source: string; family_id: string; rank: number; score: number | null; payload_json: string }>) {
    const entry = result.get(row.span_id) ?? { ranked: [], parameters: null };
    if (row.source === "jev-family") entry.ranked.push({ family_id: row.family_id, probability: row.score ?? 0 });
    else entry.parameters = (JSON.parse(row.payload_json) as { parameters: Record<string, unknown> | null }).parameters;
    result.set(row.span_id, entry);
  }
  return result;
}
