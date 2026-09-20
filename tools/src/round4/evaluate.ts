import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AnnotationAtom,
  AtomCandidate,
  CandidateAbilityResult,
  FailureCode,
  FrozenDataset,
  FrozenAbility,
  RelationQuestion,
  SemanticAnnotation,
  SemanticGraph,
  StageManifest,
} from "./contracts.js";
import { SEMANTIC_FAMILIES } from "./contracts.js";
import type { CompositionResult, RelationJudgment, composeAtoms } from "./composer.js";
import type { RawDirectResult } from "./direct-control.js";
import type { JevAnswer, JevRequestResult, RawJevResults } from "./jev.js";
import { hashFile, hashJson, verifyHash } from "./hash.js";
import { readJson, readRunManifest, writeJson, writeRunManifest } from "./manifest.js";
import { isCharBoundary } from "./spans.js";
import {
  ANNOTATIONS_PATH,
  DATASET_PATH,
  GOLD_ROOT,
  EVALUATOR_ROOT,
  MANIFEST_PATH,
  PROCESS_APP,
  PROCESS_OUTPUT,
  REPORT_PATH,
} from "./paths.js";

type FrozenComposer = { composeAtoms: typeof composeAtoms };
type CandidateRaw = {
  run_id: string;
  dataset_hash: string;
  parser_bundle_hash: string;
  records: Array<CandidateAbilityResult & { primary_stratum: string }>;
};
type AnnotationArtifact = { run_id: string; annotations: SemanticAnnotation[] };

interface DistributionSummary {
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

interface CountMetric {
  count: number;
  denominator: number;
  rate?: number | null;
  accuracy?: number | null;
}

interface CandidateFamilyMetric {
  required: number;
  misses: number;
  recall: number;
  retained_candidates: number;
  matched_candidates: number;
  precision: number | null;
}

interface CandidateEvaluation {
  run_id: string;
  population: { abilities: number; required_atoms: number };
  recall: Record<"at_1" | "at_3" | "at_5" | "all_retained", CountMetric>;
  domain_sizes: DistributionSummary;
  channel_attribution: Record<string, number>;
  family: Record<string, CandidateFamilyMetric>;
  atom_results: Array<Record<string, unknown>>;
  stop_condition: {
    stop: boolean;
    reasons: string[];
    observed_all_retained_recall: number;
    observed_zero_domain_rate: number;
    observed_p95_domain_size: number;
  };
}

interface JevEvaluation {
  run_id: string;
  status: "not_run" | "complete";
  reason?: string;
  conditional_denominator?: number;
  top_1?: CountMetric;
  top_2?: CountMetric;
  abstentions?: CountMetric;
  stable_question_types?: string[];
  unstable_question_types?: string[];
  requests?: Record<string, unknown>;
  question_results?: Array<Record<string, unknown>>;
  stop_condition?: { stop: boolean; reason: string };
}

interface CompositionEvaluationRow {
  identity: string;
  jev_arm: { composition: CompositionResult; fidelity: { matched: number; required: number; complete: boolean } };
  correct_atom_arm: { composition: CompositionResult; fidelity: { matched: number; required: number; complete: boolean } };
  exact_dsl_agreement: { agrees: boolean | null; historical_gold_hash: string | null; comparison: string } | null;
  dsl_gaps: string[];
}

interface CompositionEvaluation {
  run_id: string;
  status: "not_run" | "complete";
  reason?: string;
  abilities?: number;
  jev_complete?: number;
  correct_atom_complete?: number;
  relation_question_types_required?: string[];
  results?: CompositionEvaluationRow[];
}

interface DirectEvaluation {
  run_id: string;
  status: "not_run" | "complete";
  reason?: string;
  schema_valid?: number;
  complete_fidelity?: number;
  latency_ms?: DistributionSummary;
  tokens?: DistributionSummary;
  cost_usd?: DistributionSummary & { total: number };
  results?: Array<Record<string, unknown>>;
}

const CANDIDATE_RAW = join(PROCESS_OUTPUT, "round4-candidates.raw.json");
const JEV_RAW = join(PROCESS_OUTPUT, "round4-jev-results.raw.json");
const DIRECT_RAW = join(PROCESS_OUTPUT, "round4-direct-results.raw.json");

function keyOf(identity: { faction_id: string; ability_id: string }): string {
  return `${identity.faction_id}/${identity.ability_id}`;
}

function overlap(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return left.start < right.end && right.start < left.end;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number;
}

function summary(values: number[]): DistributionSummary {
  return {
    count: values.length,
    mean: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

function matchingDomain(atom: AnnotationAtom, candidates: AtomCandidate[]): AtomCandidate[] {
  return candidates
    .filter((candidate) => candidate.family === atom.family && candidate.evidence.some((evidence) => atom.spans.some((span) => overlap(evidence.span, span))))
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
}

function exactCandidate(atom: AnnotationAtom, domain: AtomCandidate[]): AtomCandidate | undefined {
  return domain.find((candidate) => candidate.role === atom.role);
}

function evaluateCandidates(
  dataset: FrozenDataset,
  candidateRaw: CandidateRaw,
  annotations: AnnotationArtifact,
): CandidateEvaluation {
  const candidatesById = new Map(candidateRaw.records.map((record) => [keyOf(record), record]));
  const rows: Array<Record<string, unknown>> = [];
  const domainSizes: number[] = [];
  const channelAttribution: Record<string, number> = {};
  const missesByFamily: Record<string, number> = {};
  const totalsByFamily: Record<string, number> = {};
  const candidatesByFamily: Record<string, number> = {};
  const matchedCandidatesByFamily: Record<string, Set<string>> = {};
  for (const record of candidateRaw.records) {
    for (const candidate of record.candidates) {
      candidatesByFamily[candidate.family] = (candidatesByFamily[candidate.family] ?? 0) + 1;
    }
  }
  const recalls = { at_1: 0, at_3: 0, at_5: 0, all_retained: 0 };

  for (const annotation of annotations.annotations) {
    const identity = keyOf(annotation.identity);
    const result = candidatesById.get(identity);
    if (!result) throw new Error(`Candidate output omitted frozen identity ${identity}`);
    for (const atom of annotation.atoms.filter((item) => item.required)) {
      totalsByFamily[atom.family] = (totalsByFamily[atom.family] ?? 0) + 1;
      const domain = matchingDomain(atom, result.candidates);
      domainSizes.push(domain.length);
      const exact = exactCandidate(atom, domain);
      const rank = exact ? domain.findIndex((candidate) => candidate.id === exact.id) + 1 : null;
      if (rank !== null) {
        recalls.all_retained += 1;
        if (rank <= 5) recalls.at_5 += 1;
        if (rank <= 3) recalls.at_3 += 1;
        if (rank <= 1) recalls.at_1 += 1;
        for (const evidence of exact!.evidence) channelAttribution[evidence.channel] = (channelAttribution[evidence.channel] ?? 0) + 1;
        const matched = matchedCandidatesByFamily[atom.family] ?? new Set<string>();
        matched.add(`${identity}/${exact!.id}`);
        matchedCandidatesByFamily[atom.family] = matched;
      } else missesByFamily[atom.family] = (missesByFamily[atom.family] ?? 0) + 1;
      rows.push({
        identity,
        annotation_atom_id: atom.id,
        primary_stratum: result.primary_stratum,
        annotation_spans: atom.spans,
        candidate_evidence: exact?.evidence ?? [],
        domain_channels: [...new Set(domain.flatMap((candidate) => candidate.evidence.map((evidence) => evidence.channel)))],
        family: atom.family,
        role: atom.role,
        state: atom.state,
        domain_size: domain.length,
        retained_candidate_ids: domain.map((candidate) => candidate.id),
        correct_candidate_id: exact?.id ?? null,
        correct_rank: rank,
        failure: exact ? null : atom.state === "DSL_GAP" ? "DSL_GAP" : atom.state === "ANNOTATION_AMBIGUITY" ? "ANNOTATION_AMBIGUITY" : "CANDIDATE_MISS",
      });
    }
  }
  const denominator = rows.length;
  const metric = (count: number): CountMetric => ({
    count,
    denominator,
    rate: denominator ? count / denominator : null,
  });
  const rates: CandidateEvaluation["recall"] = {
    at_1: metric(recalls.at_1),
    at_3: metric(recalls.at_3),
    at_5: metric(recalls.at_5),
    all_retained: metric(recalls.all_retained),
  };
  const p95 = quantile(domainSizes, 0.95) ?? 0;
  const allRate = denominator ? recalls.all_retained / denominator : 0;
  const stopReasons: string[] = [];
  if (p95 > 12) stopReasons.push("retained domains materially exceed the hypothesized 2-8 range");
  const zeroDomainRate = domainSizes.filter((size) => size === 0).length / Math.max(1, domainSizes.length);
  if (allRate < 0.5 && zeroDomainRate > 0.4) stopReasons.push("correct semantics routinely require whole-ability reinterpretation rather than local domains");
  return {
    run_id: dataset.run_id,
    population: { abilities: dataset.records.length, required_atoms: denominator },
    recall: rates,
    domain_sizes: summary(domainSizes),
    channel_attribution: channelAttribution,
    family: Object.fromEntries(Object.keys(totalsByFamily).sort().map((family) => {
      const retainedCandidates = candidatesByFamily[family] ?? 0;
      const matchedCandidates = matchedCandidatesByFamily[family]?.size ?? 0;
      return [family, {
        required: totalsByFamily[family],
        misses: missesByFamily[family] ?? 0,
        recall: ((totalsByFamily[family] ?? 0) - (missesByFamily[family] ?? 0)) / (totalsByFamily[family] ?? 1),
        retained_candidates: retainedCandidates,
        matched_candidates: matchedCandidates,
        precision: retainedCandidates ? matchedCandidates / retainedCandidates : null,
      }];
    })),
    atom_results: rows,
    stop_condition: {
      stop: stopReasons.length > 0,
      reasons: stopReasons,
      observed_all_retained_recall: allRate,
      observed_zero_domain_rate: zeroDomainRate,
      observed_p95_domain_size: p95,
    },
  };
}

function expectedCandidate(
  question: RelationQuestion,
  candidateRecord: CandidateAbilityResult,
  annotation: SemanticAnnotation,
): { answer: string; present: boolean; ambiguous: boolean } {
  const optionIds = new Set(question.options.filter((option) => option.kind === "candidate").map((option) => option.id));
  const options = candidateRecord.candidates.filter((candidate) => optionIds.has(candidate.id));
  const ambiguous = annotation.atoms.some((atom) => atom.state === "ANNOTATION_AMBIGUITY" && atom.spans.some((span) => overlap(span, question.source_span)));
  let best: { id: string; score: number } | null = null;
  for (const candidate of options) {
    for (const atom of annotation.atoms) {
      let score = 0;
      if (candidate.family === atom.family) score += 4;
      if (candidate.role === atom.role) score += 5;
      if (candidate.evidence.some((evidence) => atom.spans.some((span) => overlap(evidence.span, span)))) score += 8;
      const distance = Math.min(...candidate.evidence.flatMap((evidence) => atom.spans.map((span) => Math.abs(evidence.span.start - span.start))));
      if (distance <= 180) score += Math.max(0, 3 - distance / 60);
      if (!best || score > best.score || (score === best.score && candidate.id < best.id)) best = { id: candidate.id, score };
    }
  }
  if (best && best.score >= 9) return { answer: best.id, present: true, ambiguous };
  return { answer: "unknown", present: question.options.some((option) => option.id === "unknown"), ambiguous };
}

function authoritativeAnswers(raw: RawJevResults): Map<string, { answer: JevAnswer; request: JevRequestResult }> {
  const output = new Map<string, { answer: JevAnswer; request: JevRequestResult }>();
  for (const request of raw.requests) {
    for (const answer of request.answers) {
      const prior = output.get(answer.question_id);
      if (!prior || (request.representative && request.mode === "solo")) output.set(answer.question_id, { answer, request });
    }
  }
  return output;
}

export function conditionalJevMetrics(rows: Array<Record<string, unknown>>): {
  denominator: number;
  top_1: number;
  top_2: number;
} {
  const eligible = rows.filter(
    (row) => row.correct_candidate_present === true && row.failure !== "ANNOTATION_AMBIGUITY",
  );
  return {
    denominator: eligible.length,
    top_1: eligible.filter((row) => row.top_1_correct === true).length,
    top_2: eligible.filter((row) => row.top_2_correct === true).length,
  };
}

function evaluateJev(
  dataset: FrozenDataset,
  candidateRaw: CandidateRaw,
  annotations: AnnotationArtifact,
): JevEvaluation {
  if (!existsSync(JEV_RAW)) {
    return { run_id: dataset.run_id, status: "not_run", reason: "Jev raw output is absent" };
  }
  const raw = readJson<RawJevResults & { run_id: string }>(JEV_RAW);
  const answers = authoritativeAnswers(raw);
  const annotationsById = new Map(annotations.annotations.map((annotation) => [keyOf(annotation.identity), annotation]));
  const rows: Array<Record<string, unknown>> = [];
  let eligible = 0;
  let top1 = 0;
  let top2 = 0;
  let abstentions = 0;
  for (const candidateRecord of candidateRaw.records) {
    const annotation = annotationsById.get(keyOf(candidateRecord));
    if (!annotation) throw new Error(`Missing annotation for ${keyOf(candidateRecord)}`);
    for (const question of candidateRecord.questions) {
      const observed = answers.get(question.id);
      if (!observed) throw new Error(`Jev raw output omitted question ${question.id}`);
      const expected = expectedCandidate(question, candidateRecord, annotation);
      const ranked = Object.entries(observed.answer.probabilities).sort((left, right) => right[1] - left[1]).map(([label]) => label);
      const correctCandidatePresent = expected.present && expected.answer !== "unknown" && expected.answer !== "none";
      if (correctCandidatePresent && !expected.ambiguous) {
        eligible += 1;
        if (observed.answer.selected === expected.answer) top1 += 1;
        if (ranked.slice(0, 2).includes(expected.answer)) top2 += 1;
      }
      const abstained = observed.answer.selected === "unknown" || observed.answer.selected === "none";
      if (abstained) abstentions += 1;
      let failure: FailureCode | null = null;
      if (expected.ambiguous) failure = "ANNOTATION_AMBIGUITY";
      else if (!correctCandidatePresent) failure = "CANDIDATE_MISS";
      else if (abstained) failure = "JEV_ABSTENTION";
      else if (observed.answer.selected !== expected.answer) failure = "JEV_MISSELECTION";
      rows.push({
        primary_stratum: candidateRecord.primary_stratum,
        identity: keyOf(candidateRecord),
        source_span: question.source_span,
        question_id: question.id,
        question_type: question.type,
        candidate_set: question.options,
        candidate_channels: candidateRecord.candidates.filter((candidate) => question.subject_atom_ids.includes(candidate.id)).flatMap((candidate) => candidate.evidence.map((evidence) => evidence.channel)),
        answer: observed.answer,
        selected_answer: observed.answer.selected,
        expected_answer: expected.answer,
        correct_candidate_present: correctCandidatePresent,
        top_1_correct: correctCandidatePresent && observed.answer.selected === expected.answer,
        top_2_correct: correctCandidatePresent && ranked.slice(0, 2).includes(expected.answer),
        abstention: abstained,
        failure,
        request_hash: observed.request.request_hash,
        request_mode: observed.request.mode,
        tokens: observed.request.usage,
        latency_ms: observed.request.latency_ms,
        cost_usd: observed.request.cost_usd,
        cost_kind: observed.request.cost_kind,
      });
    }
  }
  const requestTokens = raw.requests.map((request) => request.usage.input_tokens + request.usage.output_tokens);
  const latencies = raw.requests.map((request) => request.latency_ms);
  const costs = raw.requests.map((request) => request.cost_usd);
  const conditional = conditionalJevMetrics(rows);
  return {
    run_id: dataset.run_id,
    status: "complete",
    conditional_denominator: conditional.denominator,
    top_1: {
      count: conditional.top_1,
      denominator: conditional.denominator,
      accuracy: conditional.denominator ? conditional.top_1 / conditional.denominator : null,
    },
    top_2: {
      count: conditional.top_2,
      denominator: conditional.denominator,
      accuracy: conditional.denominator ? conditional.top_2 / conditional.denominator : null,
    },
    abstentions: { count: abstentions, denominator: rows.length, rate: rows.length ? abstentions / rows.length : null },
    stable_question_types: raw.stable_question_types,
    unstable_question_types: raw.unstable_question_types,
    requests: { count: raw.requests.length, tokens: summary(requestTokens), latency_ms: summary(latencies), cost_usd: summary(costs), total_cost_usd: costs.reduce((total, value) => total + value, 0) },
    question_results: rows,
    stop_condition: {
      stop: conditional.denominator > 0 && conditional.top_1 / conditional.denominator < 0.5,
      reason: "conditional top-1 below 0.50 on retained local domains",
    },
  };
}

function annotationAsCandidate(atom: AnnotationAtom): AtomCandidate {
  return {
    id: atom.id,
    family: atom.family,
    rank: 1,
    role: atom.role,
    meaning: atom.meaning,
    value: atom.value,
    participant: atom.participant,
    arguments: atom.arguments,
    evidence: atom.spans.map((span) => ({ span, channel: "local-context" })),
  };
}

function annotationQuestions(annotation: SemanticAnnotation): { questions: RelationQuestion[]; judgments: RelationJudgment[] } {
  const typeFor = (edge: { type: string }): RelationQuestion["type"] => {
    if (edge.type === "guards") return "attachment";
    if (edge.type === "attaches-to") return "duration-scope";
    if (edge.type === "binds" || edge.type === "binds-to") return "iterator-collection";
    if (edge.type === "selects-branch") return "branch-kind";
    return "argument-filling";
  };
  const atomById = new Map(annotation.atoms.map((atom) => [atom.id, atom]));
  const semanticEdges = annotation.graph.edges.filter((edge) => edge.type !== "source-order");
  const questions = semanticEdges.map((edge, index): RelationQuestion => {
    const source = atomById.get(edge.from) as AnnotationAtom;
    const target = atomById.get(edge.to) as AnnotationAtom;
    return {
      id: `gold-relation-${String(index + 1).padStart(3, "0")}`,
      identity: annotation.identity,
      type: typeFor(edge),
      source_span: source.spans[0] as { start: number; end: number },
      source_context: "",
      prompt: edge.type,
      subject_atom_ids: [target.id],
      options: [{ id: target.id, label: target.meaning, description: target.role, kind: "candidate", atom_id: target.id }],
    };
  });
  const judgments = questions.map((question): RelationJudgment => ({
    question_id: question.id,
    question_type: question.type,
    selected: question.options[0]!.id,
    source_span: question.source_span,
  }));
  return { questions, judgments };
}

async function loadComposer(expectedHash: string): Promise<FrozenComposer> {
  const path = join(PROCESS_APP, "composer.mjs");
  verifyHash("composer bundle", expectedHash, hashFile(path));
  // Runtime-selected private artifact: Process B must execute the exact hash-frozen bundle.
  const loaded = await import(pathToFileURL(path).href);
  if (typeof loaded.composeAtoms !== "function") throw new Error("Frozen composer bundle has no composeAtoms export");
  return loaded as FrozenComposer;
}

function selectedCandidateAtoms(
  record: CandidateAbilityResult,
  jevRows: Array<Record<string, unknown>>,
): { atoms: AtomCandidate[]; judgments: RelationJudgment[] } {
  const selectedByQuestion = new Map(jevRows.map((row) => [String(row.question_id), String(row.selected_answer)]));
  const removed = new Set<string>();
  const kept = new Set<string>();
  const judgments: RelationJudgment[] = [];
  for (const question of record.questions) {
    const selected = selectedByQuestion.get(question.id) ?? "unknown";
    if (question.type === "argument-filling") {
      question.subject_atom_ids.forEach((id) => removed.add(id));
      if (selected !== "none" && selected !== "unknown") kept.add(selected);
    }
    judgments.push({ question_id: question.id, question_type: question.type, selected, source_span: question.source_span });
  }
  const atoms = record.candidates.filter((candidate) => !removed.has(candidate.id) || kept.has(candidate.id));
  return { atoms, judgments };
}

function compositionFidelity(atoms: AtomCandidate[], annotation: SemanticAnnotation): { matched: number; required: number; complete: boolean } {
  let matched = 0;
  const required = annotation.atoms.filter((atom) => atom.required && atom.state !== "ANNOTATION_AMBIGUITY");
  for (const atom of required) if (exactCandidate(atom, matchingDomain(atom, atoms))) matched += 1;
  return { matched, required: required.length, complete: matched === required.length };
}

async function evaluateComposition(
  dataset: FrozenDataset,
  manifestComposerHash: string,
  candidateRaw: CandidateRaw,
  annotations: AnnotationArtifact,
  jevEvaluation: JevEvaluation,
): Promise<CompositionEvaluation> {
  if (jevEvaluation.status !== "complete") return { run_id: dataset.run_id, status: "not_run", reason: "Jev evaluation is unavailable" };
  if (jevEvaluation.stop_condition?.stop === true) {
    return { run_id: dataset.run_id, status: "not_run", reason: "Jev stop condition triggered" };
  }
  const composer = await loadComposer(manifestComposerHash);
  const questionRows = Array.isArray(jevEvaluation.question_results) ? jevEvaluation.question_results as Array<Record<string, unknown>> : [];
  const annotationById = new Map(annotations.annotations.map((annotation) => [keyOf(annotation.identity), annotation]));
  const rows = [];
  for (const record of candidateRaw.records) {
    const identity = keyOf(record);
    const annotation = annotationById.get(identity) as SemanticAnnotation;
    const jevRows = questionRows.filter((row) => row.identity === identity);
    const selected = selectedCandidateAtoms(record, jevRows);
    const jevComposition = composer.composeAtoms(selected.atoms, record.questions, selected.judgments) as CompositionResult;
    const adjudicated = annotationQuestions(annotation);
    const correctAtoms = annotation.atoms.map(annotationAsCandidate);
    const correctComposition = composer.composeAtoms(correctAtoms, adjudicated.questions, adjudicated.judgments) as CompositionResult;
    const jevFidelity = compositionFidelity(selected.atoms, annotation);
    const correctFidelity = compositionFidelity(correctAtoms, annotation);
    const anchor = ["helm-of-brazen-ire-berzerker-warband", "hack-and-slash-berzerker-warband", "relentless-rage", "deep-strike"].includes(record.ability_id);
    let exactDslAgreement: boolean | null = null;
    let goldHash: string | null = null;
    if (anchor) {
      const goldPath = join(GOLD_ROOT, `${record.ability_id}.json`);
      const gold = readJson<{ record: unknown }>(goldPath);
      goldHash = hashFile(goldPath);
      exactDslAgreement = hashJson(correctComposition.roots) === hashJson(gold.record);
    }
    rows.push({
      identity,
      jev_arm: { composition: jevComposition, fidelity: jevFidelity },
      correct_atom_arm: { composition: correctComposition, fidelity: correctFidelity },
      exact_dsl_agreement: anchor ? { agrees: exactDslAgreement, historical_gold_hash: goldHash, comparison: "secondary-only" } : null,
      dsl_gaps: annotation.atoms.filter((atom) => atom.state === "DSL_GAP").map((atom) => atom.id),
    });
  }
  return {
    run_id: dataset.run_id,
    status: "complete",
    abilities: rows.length,
    jev_complete: rows.filter((row) => row.jev_arm.fidelity.complete).length,
    correct_atom_complete: rows.filter((row) => row.correct_atom_arm.fidelity.complete).length,
    relation_question_types_required: [...new Set(rows.flatMap((row) => row.correct_atom_arm.composition.roots.flatMap((root) => root.relation?.question_type ? [root.relation.question_type] : [])))].sort(),
    results: rows,
  };
}

function graphContractErrors(graph: SemanticGraph, record: FrozenAbility): string[] {
  const errors: string[] = [];
  const unexpected = (label: string, value: object, allowed: string[]): void => {
    const extras = Object.keys(value).filter((key) => !allowed.includes(key));
    if (extras.length) errors.push(`${label} has unexpected fields: ${extras.join(",")}`);
  };
  unexpected("graph", graph, ["identity", "atoms", "edges", "roots"]);
  if (!graph.identity || typeof graph.identity !== "object" || Array.isArray(graph.identity)) {
    errors.push("identity is not an object");
  } else {
    unexpected("identity", graph.identity, ["faction_id", "ability_id"]);
    if (graph.identity.faction_id !== record.faction_id || graph.identity.ability_id !== record.ability_id) {
      errors.push("identity does not match request");
    }
  }
  if (!Array.isArray(graph.atoms)) return [...errors, "atoms is not an array"];
  const sourceBytes = Buffer.from(record.source_text, "utf8");
  const ids = new Set<string>();
  for (const [index, atom] of graph.atoms.entries()) {
    if (!atom || typeof atom !== "object" || Array.isArray(atom)) {
      errors.push(`atom ${index} is not an object`);
      continue;
    }
    unexpected(`atom ${index}`, atom, ["id", "family", "role", "meaning", "value", "participant", "arguments", "spans"]);
    if (typeof atom.id !== "string" || !atom.id || ids.has(atom.id)) errors.push(`atom ${index} has missing or duplicate id`);
    else ids.add(atom.id);
    if (!SEMANTIC_FAMILIES.includes(atom.family)) errors.push(`atom ${index} has invalid family`);
    if (typeof atom.role !== "string" || !atom.role) errors.push(`atom ${index} has invalid role`);
    if (typeof atom.meaning !== "string" || !atom.meaning) errors.push(`atom ${index} has invalid meaning`);
    if (!Object.hasOwn(atom, "value")) errors.push(`atom ${index} has no value`);
    if (atom.participant !== null && typeof atom.participant !== "string") errors.push(`atom ${index} has invalid participant`);
    if (!atom.arguments || typeof atom.arguments !== "object" || Array.isArray(atom.arguments)) errors.push(`atom ${index} has invalid arguments`);
    if (!Array.isArray(atom.spans) || atom.spans.length === 0) {
      errors.push(`atom ${index} has no source provenance`);
      continue;
    }
    for (const span of atom.spans) {
      if (
        !Number.isInteger(span.start)
        || !Number.isInteger(span.end)
        || span.start < 0
        || span.end <= span.start
        || span.end > sourceBytes.length
        || !isCharBoundary(sourceBytes, span.start)
        || !isCharBoundary(sourceBytes, span.end)
      ) errors.push(`atom ${index} has invalid UTF-8 byte span`);
    }
  }
  if (!Array.isArray(graph.edges)) {
    errors.push("edges is not an array");
  } else {
    for (const [index, edge] of graph.edges.entries()) {
      if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
        errors.push(`edge ${index} is not an object`);
        continue;
      }
      unexpected(`edge ${index}`, edge, ["from", "type", "to"]);
      if (typeof edge.type !== "string" || !edge.type) errors.push(`edge ${index} has invalid type`);
      if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`edge ${index} references unknown atom`);
    }
  }
  if (!Array.isArray(graph.roots)) {
    errors.push("roots is not an array");
  } else {
    for (const root of graph.roots) {
      if (typeof root !== "string" || !ids.has(root)) errors.push("root references unknown atom");
    }
  }
  return errors;
}

function evaluateDirect(
  dataset: FrozenDataset,
  annotations: AnnotationArtifact,
): DirectEvaluation {
  if (!existsSync(DIRECT_RAW)) return { run_id: dataset.run_id, status: "not_run", reason: "Direct-control raw output is absent" };
  const raw = readJson<{ run_id: string; status?: "blocked"; blocked_reason?: string; results: RawDirectResult[] }>(DIRECT_RAW);
  if (raw.status === "blocked") {
    return {
      run_id: dataset.run_id,
      status: "not_run",
      reason: raw.blocked_reason ?? "Direct-control arm was blocked",
    };
  }
  const annotationsById = new Map(annotations.annotations.map((annotation) => [keyOf(annotation.identity), annotation]));
  const recordsById = new Map(dataset.records.map((record) => [keyOf(record), record]));
  const rows = raw.results.map((result) => {
    const identity = keyOf(result.identity);
    const annotation = annotationsById.get(identity) as SemanticAnnotation;
    const record = recordsById.get(identity);
    if (!record) throw new Error(`Direct output contains an unfrozen identity: ${identity}`);
    const contractErrors = result.graph ? graphContractErrors(result.graph, record) : ["semantic graph is absent"];
    const validationErrors = [...new Set([...result.validation_errors, ...contractErrors])];
    const graphAtoms: AtomCandidate[] = (Array.isArray(result.graph?.atoms) ? result.graph.atoms : [])
      .filter((atom) => atom && typeof atom.id === "string" && Array.isArray(atom.spans))
      .map((atom) => ({
        ...atom,
        rank: 1,
        evidence: atom.spans.map((span) => ({ span, channel: "local-context" as const })),
      }));
    const required = annotation.atoms.filter((atom) => atom.required && atom.state !== "ANNOTATION_AMBIGUITY");
    const matched = required.filter((atom) => exactCandidate(atom, matchingDomain(atom, graphAtoms))).length;
    const hallucinated = graphAtoms.filter((candidate) => !annotation.atoms.some((atom) => exactCandidate(atom, matchingDomain(atom, [candidate])))).map((candidate) => candidate.id);
    const omissions = required.filter((atom) => !exactCandidate(atom, matchingDomain(atom, graphAtoms))).map((atom) => atom.id);
    return {
      identity,
      schema_valid: validationErrors.length === 0,
      source_adjudicated_fidelity: { matched, required: required.length, rate: required.length ? matched / required.length : null },
      silent_omissions: omissions,
      hallucinated_semantics: hallucinated,
      grounding_provenance_valid: contractErrors.every((error) => !error.includes("provenance") && !error.includes("byte span")),
      validation_errors: validationErrors,
      latency_ms: result.latency_ms,
      tokens: result.usage,
      cost_usd: result.cost_usd,
      cost_kind: result.cost_kind,
      returned_model: result.returned_model,
      failure: validationErrors.length || omissions.length || hallucinated.length ? "DIRECT_GENERATION_ERROR" : null,
    };
  });
  return {
    run_id: dataset.run_id,
    status: "complete",
    schema_valid: rows.filter((row) => row.schema_valid).length,
    complete_fidelity: rows.filter((row) => row.source_adjudicated_fidelity.matched === row.source_adjudicated_fidelity.required).length,
    latency_ms: summary(rows.map((row) => row.latency_ms)),
    tokens: summary(rows.map((row) => row.tokens.input_tokens + row.tokens.output_tokens)),
    cost_usd: { ...summary(rows.map((row) => row.cost_usd)), total: rows.reduce((total, row) => total + row.cost_usd, 0) },
    results: rows,
  };
}

export function upstreamFailure(
  candidateRow: Record<string, unknown> | undefined,
  jevRow: Record<string, unknown> | undefined,
  direct: boolean,
): FailureCode | null {
  if (candidateRow?.failure) return candidateRow.failure as FailureCode;
  if (jevRow?.failure) return jevRow.failure as FailureCode;
  return direct ? "DIRECT_GENERATION_ERROR" : null;
}

function report(
  dataset: FrozenDataset,
  manifestHash: string,
  candidate: CandidateEvaluation,
  jev: JevEvaluation,
  composition: CompositionEvaluation,
  direct: DirectEvaluation,
  evaluationHash: string,
): string {
  const familyRows = Object.entries(candidate.family)
    .map(([family, value]) => `- ${family}: ${JSON.stringify(value)}`)
    .join("\n");
  const jeopardy = jev.status === "complete" && jev.top_1 && jev.top_2
    ? `${jev.top_1.count}/${jev.top_1.denominator} top-1; ${jev.top_2.count}/${jev.top_2.denominator} top-2`
    : "not run";
  const directSummary = direct.status === "complete"
    ? `${direct.complete_fidelity ?? 0}/${dataset.records.length} complete; ${direct.schema_valid ?? 0}/${dataset.records.length} schema-valid`
    : direct.reason
      ? `blocked: ${direct.reason}`
      : "not run";
  const stop = candidate.stop_condition.stop || (jev.stop_condition?.stop ?? false);
  const largestFailureFamily = Object.entries(candidate.family)
    .sort(([, left], [, right]) => right.misses - left.misses)[0]?.[0] ?? "none";
  const stableTypes = jev.stable_question_types ?? [];
  const unstableTypes = jev.unstable_question_types ?? [];
  const allRetainedRate = candidate.recall.all_retained.rate ?? 0;
  const cohortRows = dataset.records
    .map((record) => `- ${record.primary_stratum}: \`${record.faction_id}/${record.ability_id}\``)
    .join("\n");
  const familySlice = (families: string[]): string => families
    .filter((family) => candidate.family[family])
    .map((family) => `- ${family}: ${JSON.stringify(candidate.family[family])}`)
    .join("\n") || "- No required atoms in this slice.";
  return [
    "# Round 4 Semantic-Atom Experiment",
    "",
    "## A. Verdicts",
    "",
    `1. Deterministic candidate recall ceiling: ${(allRetainedRate * 100).toFixed(1)}%.`,
    `2. Jev local accuracy conditional on candidate availability: ${jeopardy}.`,
    `3. Jev-selected composition complete parses: ${composition.jev_complete ?? 0}/${dataset.records.length}.`,
    `4. Adjudicated-atom composition ceiling: ${composition.correct_atom_complete ?? 0}/${dataset.records.length}.`,
    `5. Direct constrained-generation control: ${directSummary}.`,
    `6. Largest upstream failure: ${largestFailureFamily}.`,
    "7. Production architecture recommendation: none; this frozen experiment reports ceilings only.",
    "",
    "## B. Frozen dataset and strata",
    "",
    `Run \`${dataset.run_id}\`; 32 records. Cohort hash \`${dataset.cohort_hash}\`. Manifest hash \`${manifestHash}\`. Evaluation hash \`${evaluationHash}\`.`,
    "",
    cohortRows,
    "",
    "## C. Candidate ceiling",
    "",
    `Recall @1/@3/@5/all: ${candidate.recall.at_1.count}/${candidate.recall.at_1.denominator}, ${candidate.recall.at_3.count}/${candidate.recall.at_3.denominator}, ${candidate.recall.at_5.count}/${candidate.recall.at_5.denominator}, ${candidate.recall.all_retained.count}/${candidate.recall.all_retained.denominator}. Domain sizes: ${JSON.stringify(candidate.domain_sizes)}.`,
    "",
    familyRows,
    "",
    "## D. Dice-heavy analysis",
    "",
    familySlice(["dice-operation", "magnitude-expression"]),
    "",
    "## E. Attack and combat-modifier analysis",
    "",
    familySlice(["property", "operation", "rule-reference"]),
    "",
    "## F. Conditions and guards",
    "",
    familySlice(["predicate", "event"]),
    "",
    "## G. Menus and choices",
    "",
    familySlice(["choice", "sequence"]),
    "",
    "## H. Other semantic families",
    "",
    familySlice(["iteration", "duration", "participant-reference", "spatial-relation", "resource-action", "usage-frequency"]),
    "",
    "## I. Jev local judgment and batching",
    "",
    jev.status === "complete"
      ? `Stable types: ${stableTypes.join(", ") || "none"}. Unstable types: ${unstableTypes.join(", ") || "none"}. ${jeopardy}.`
      : "Not run.",
    "",
    "## J. Deterministic composition",
    "",
    `Jev arm: ${composition.jev_complete ?? 0}/${dataset.records.length}; correct-atom arm: ${composition.correct_atom_complete ?? 0}/${dataset.records.length}. Distinct required relation types: ${composition.relation_question_types_required?.length ?? 0}.`,
    "",
    "## K. Direct-generation control",
    "",
    direct.status === "complete"
      ? `${directSummary}. Omissions and hallucinations are retained as findings; no repair pass ran.`
      : `${directSummary}. No direct-control quality or cost metric is claimed.`,
    "",
    "## L. Economics",
    "",
    `Jev: ${JSON.stringify(jev.requests ?? { status: "not_run" })}. Direct: ${JSON.stringify(direct.cost_usd ?? { status: "not_run" })}.`,
    "",
    "## M. Stop-condition outcome",
    "",
    stop
      ? "Triggered. Downstream work after the triggering stage is invalid or not run."
      : "Not triggered. Domains stayed within the declared ceiling and conditional local judgment remained measurable.",
    "",
    "## N. Smallest justified next experiment",
    "",
    stop
      ? "Freeze a new run that targets only the measured upstream failure family; do not widen every domain."
      : `Repeat only the ${largestFailureFamily} slice on a fresh source-only cohort with the same frozen contracts.`,
    "",
    `Machine-readable artifacts cite run \`${candidate.run_id}\`, parser output \`${hashFile(CANDIDATE_RAW)}\`, and evaluation \`${evaluationHash}\`.`,
    "",
  ].join("\n");
}

export async function runEvaluation(): Promise<void> {
  const manifest = readRunManifest(MANIFEST_PATH);
  verifyHash("dataset", manifest.dataset_hash, hashFile(DATASET_PATH));
  verifyHash("annotations", manifest.annotation_hash, hashFile(ANNOTATIONS_PATH));
  if (!manifest.parser_bundle_hash || !manifest.composer_bundle_hash) throw new Error("Frozen bundle hashes are missing");
  verifyHash("parser bundle", manifest.parser_bundle_hash, hashFile(join(PROCESS_APP, "parser.mjs")));
  const candidateStage = readJson<StageManifest>(join(PROCESS_OUTPUT, "round4-candidates.manifest.json"));
  verifyHash("candidate raw output", candidateStage.output_hashes.candidates as string, hashFile(CANDIDATE_RAW));
  const processStagePaths = [
    join(PROCESS_OUTPUT, "round4-candidates.manifest.json"),
    join(PROCESS_OUTPUT, "round4-jev-results.manifest.json"),
    join(PROCESS_OUTPUT, "round4-direct-results.manifest.json"),
  ];
  const processStages = processStagePaths.filter(existsSync).map((path) => readJson<StageManifest>(path));
  const dataset = readJson<FrozenDataset>(DATASET_PATH);
  const candidateRaw = readJson<CandidateRaw>(CANDIDATE_RAW);
  const annotations = readJson<AnnotationArtifact>(ANNOTATIONS_PATH);
  if (dataset.run_id !== candidateRaw.run_id || dataset.run_id !== annotations.run_id) throw new Error("Frozen run ids do not agree");

  const candidate = evaluateCandidates(dataset, candidateRaw, annotations);
  writeJson(join(EVALUATOR_ROOT, "round4-candidates.json"), candidate);
  const jev = evaluateJev(dataset, candidateRaw, annotations);
  writeJson(join(EVALUATOR_ROOT, "round4-jev-results.json"), jev);
  const composition = await evaluateComposition(dataset, manifest.composer_bundle_hash, candidateRaw, annotations, jev);
  writeJson(join(EVALUATOR_ROOT, "round4-composition-results.json"), composition);
  const direct = evaluateDirect(dataset, annotations);
  writeJson(join(EVALUATOR_ROOT, "round4-direct-generation-results.json"), direct);

  const candidateRows = Array.isArray(candidate.atom_results) ? candidate.atom_results as Array<Record<string, unknown>> : [];
  const jevRows = Array.isArray(jev.question_results) ? jev.question_results as Array<Record<string, unknown>> : [];
  const failureCounts: Record<string, number> = {};
  for (const row of candidateRows) if (row.failure) failureCounts[String(row.failure)] = (failureCounts[String(row.failure)] ?? 0) + 1;
  for (const row of jevRows) {
    const failure = upstreamFailure(candidateRows.find((candidateRow) => candidateRow.identity === row.identity && candidateRow.correct_candidate_id === row.expected_answer), row, false);
    if (failure) failureCounts[failure] = (failureCounts[failure] ?? 0) + 1;
  }
  const completeAbilities = new Set(
    (composition.results ?? [])
      .filter((row) => row.jev_arm.fidelity.complete)
      .map((row) => row.identity),
  );
  const curves = dataset.records.map((record) => {
    const identity = keyOf(record);
    const atomRows = candidateRows.filter((row) => row.identity === identity);
    const questionRows = jevRows.filter((row) => row.identity === identity && row.correct_candidate_present);
    return {
      identity,
      candidate_recall: atomRows.filter((row) => row.correct_candidate_id).length / Math.max(1, atomRows.length),
      jev_atom_accuracy: questionRows.filter((row) => row.top_1_correct).length / Math.max(1, questionRows.length),
      complete_parse: completeAbilities.has(identity),
    };
  });
  const evaluatorBundleHash = process.env.ROUND4_EVALUATOR_BUNDLE_HASH ?? null;
  const evaluation = {
    run_id: dataset.run_id,
    hashes: {
      dataset: manifest.dataset_hash,
      annotations: manifest.annotation_hash,
      parser_bundle: manifest.parser_bundle_hash,
      composer_bundle: manifest.composer_bundle_hash,
      evaluator_bundle: evaluatorBundleHash,
      candidate_raw: hashFile(CANDIDATE_RAW),
      jev_raw: existsSync(JEV_RAW) ? hashFile(JEV_RAW) : null,
      direct_raw: existsSync(DIRECT_RAW) ? hashFile(DIRECT_RAW) : null,
    },
    candidate,
    jev,
    composition,
    direct,
    failure_counts_upstream_exclusive: failureCounts,
    ability_compounding_curves: curves,
    denominators: { frozen_abilities: 32, candidate_atoms: candidate.population.required_atoms, jev_conditional: jev.conditional_denominator ?? 0 },
  };
  const evaluationPath = join(EVALUATOR_ROOT, "round4-evaluation.json");
  writeJson(evaluationPath, evaluation);
  const evaluationHash = hashFile(evaluationPath);
  const stageInputHashes: Record<string, string> = {
    dataset: manifest.dataset_hash,
    annotations: manifest.annotation_hash,
    parser_bundle: manifest.parser_bundle_hash,
    composer_bundle: manifest.composer_bundle_hash,
    candidate_raw: evaluation.hashes.candidate_raw,
  };
  if (evaluation.hashes.jev_raw) stageInputHashes.jev_raw = evaluation.hashes.jev_raw;
  if (evaluation.hashes.direct_raw) stageInputHashes.direct_raw = evaluation.hashes.direct_raw;
  const { manifest_hash: _, ...body } = manifest;
  writeRunManifest(MANIFEST_PATH, {
    ...body,
    stages: [
      ...body.stages.filter(
        (stage) => stage.stage !== "evaluate" && !processStages.some((processStage) => processStage.stage === stage.stage),
      ),
      ...processStages,
      {
        run_id: dataset.run_id,
        stage: "evaluate",
        created_at: new Date().toISOString(),
        input_hashes: stageInputHashes,
        bundle_hashes: {
          composer: manifest.composer_bundle_hash,
          ...(evaluatorBundleHash ? { evaluator: evaluatorBundleHash } : {}),
        },
        output_hashes: { evaluation: evaluationHash },
        model: null,
        prompt_hash: null,
        question_catalog_hash: manifest.question_catalog_hash,
        request_hashes: [],
      },
    ],
  });
  const finalManifestHash = hashFile(MANIFEST_PATH);
  writeFileSync(REPORT_PATH, report(dataset, finalManifestHash, candidate, jev, composition, direct, evaluationHash));
  process.stdout.write(`evaluated ${dataset.records.length} frozen abilities\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runEvaluation();
}
