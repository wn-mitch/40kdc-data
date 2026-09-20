import type { DecompositionDiagnostic, FrozenDataset, ModelOutputEnvelope } from "./contracts.js";
import { hashJson } from "./hash.js";
import { identityKey, wilsonInterval, type BinomialInterval } from "./shared.js";
import type { AgreementAnalysis, AgreementRow } from "./agreement.js";
import type { AssemblyResults } from "./assembly.js";
import type { ModelEvaluationArtifact } from "./evaluation.js";

export interface OptionalStageArtifact {
  status: "complete" | "not_run" | "invalid";
  source_path: string | null;
  source_hash: string | null;
  calls: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  resolved_ticket_ids: string[];
  raw: unknown | null;
  reason?: string;
}

export interface EscalationTicket {
  id: string;
  scope: "local" | "ability";
  identity: string;
  source_span: { start: number; end: number } | null;
  source_excerpt: string;
  wider_context: string;
  kind: "unresolved_atom" | "unresolved_relation" | "novel_relation" | "model_disagreement" | "global_incoherence";
  question_family: string;
  reference_ids: string[];
  candidate_answers: string[];
  decomposer_outputs: Array<{ model: string; answers: string[] }>;
  evidence: string[];
  target: "Jev" | "Terra";
  jev_answer: unknown | null;
  terra_result: unknown | null;
  adjudicated_correct: boolean;
  reason: string;
}

export interface EscalationTicketArtifact {
  run_id: string;
  status: "complete";
  terra: OptionalStageArtifact;
  tickets: EscalationTicket[];
}

export interface RoutingPolicyResult {
  policy: "A" | "B" | "C" | "D";
  name: string;
  model_ids: string[];
  calls: { model: number; jev: number | null; terra: number | null; total_known: number | null };
  tickets: { local: number; ability: number; total: number };
  batches: { model: number; local_ticket: number; ability_ticket: number; total_known: number | null };
  human_tail: { tickets: number; status: "measured" | "not_run" };
  latency_ms: { model_sequential: number | null; model_parallel: number | null; jev: number | null; terra: number | null; total_known_sequential: number | null };
  cost_usd: { model: number | null; jev: number | null; terra: number | null; total_known: number | null };
}

export interface CorpusProjection {
  population: number;
  assumptions: string[];
  model_atom_recall: Record<string, BinomialInterval>;
  model_relation_recall: Record<string, BinomialInterval>;
  agreement_unresolved: BinomialInterval;
  projected_unresolved_abilities: { expected: number | null; lower: number | null; upper: number | null };
}

export interface RoutingSimulation {
  run_id: string;
  comparison: "not ranked";
  policies: RoutingPolicyResult[];
  corpus_projection: CorpusProjection;
}

type TicketDraft = Omit<EscalationTicket, "id" | "source_excerpt" | "wider_context" | "candidate_answers" | "decomposer_outputs" | "jev_answer" | "terra_result">;

function diagnosticTicket(identity: string, diagnostic: DecompositionDiagnostic, modelId: string): TicketDraft {
  return {
    scope: "local",
    identity,
    source_span: diagnostic.source_span ?? null,
    kind: diagnostic.kind,
    question_family: diagnostic.kind,
    reference_ids: [...(diagnostic.atom_ids ?? []), ...(diagnostic.relation_id ? [diagnostic.relation_id] : [])],
    evidence: [`${modelId}:${diagnostic.message}`],
    target: "Terra",
    adjudicated_correct: false,
    reason: "model diagnostic",
  };
}

function disagreementTicket(row: AgreementRow): TicketDraft {
  return {
    scope: "local",
    identity: row.identity,
    source_span: row.source_span,
    kind: "model_disagreement",
    question_family: row.error_family,
    reference_ids: [row.reference_id],
    evidence: [`${row.kind}:${row.bucket}`, `supporters:${row.supporters.join(",") || "none"}`],
    target: row.error_family === "replacement-vs-coexistence" ? "Jev" : "Terra",
    adjudicated_correct: row.correct,
    reason: row.bucket === "all-missed" ? "all decomposition models missed an adjudicated semantic item" : "decomposition models disagreed",
  };
}

function ticketId(ticket: TicketDraft): string {
  return `round4b-ticket-${hashJson({ identity: ticket.identity, kind: ticket.kind, question_family: ticket.question_family, source_span: ticket.source_span }).slice(0, 16)}`;
}

function collectIncoherentIdentities(assembly: AssemblyResults): Set<string> {
  const identities = new Set<string>();
  for (const model of Object.values(assembly.models)) {
    for (const result of model.results) if (result.composition.status === "incoherent") identities.add(result.identity);
  }
  return identities;
}

function spanText(source: string, span: EscalationTicket["source_span"]): string {
  if (!span) return "";
  return Buffer.from(source, "utf8").subarray(span.start, span.end).toString("utf8");
}

function ticketAnswers(ticket: TicketDraft, outputs: Record<string, ModelOutputEnvelope[]>): Array<{ model: string; answers: string[] }> {
  return Object.entries(outputs).map(([model, records]) => {
    const record = records.find((candidate) => identityKey(candidate) === ticket.identity);
    const answers = (record?.atoms ?? [])
      .filter((atom) => !ticket.source_span || atom.source_span.start < ticket.source_span.end && ticket.source_span.start < atom.source_span.end)
      .map((atom) => `${atom.family}:${atom.normalized_meaning}`);
    return { model, answers: [...new Set(answers)].sort() };
  });
}

function normaliseTicket(ticket: TicketDraft, record: FrozenDataset["records"][number], outputs: Record<string, ModelOutputEnvelope[]>, terra: OptionalStageArtifact): EscalationTicket {
  const decomposerOutputs = ticketAnswers(ticket, outputs);
  const raw = terra.raw as { answers?: Array<{ ticket_id?: string; answer?: unknown }> } | null;
  const terraAnswer = raw?.answers?.find((answer) => answer.ticket_id === ticketId(ticket))?.answer ?? null;
  return {
    ...ticket,
    id: ticketId(ticket),
    source_excerpt: spanText(record.source_text, ticket.source_span),
    wider_context: record.source_text,
    candidate_answers: [...new Set(decomposerOutputs.flatMap((output) => output.answers))],
    decomposer_outputs: decomposerOutputs,
    jev_answer: null,
    terra_result: terraAnswer,
  };
}

export function generateEscalationTickets(
  dataset: FrozenDataset,
  modelOutputs: Record<string, ModelOutputEnvelope[]>,
  agreement: AgreementAnalysis,
  assembly: AssemblyResults,
  terra: OptionalStageArtifact,
): EscalationTicketArtifact {
  const candidateTickets: TicketDraft[] = [];
  const incoherent = collectIncoherentIdentities(assembly);
  const recordsByIdentity = new Map(dataset.records.map((record) => [identityKey(record), record]));
  for (const record of dataset.records) {
    const identity = identityKey(record);
    if (incoherent.has(identity)) {
      candidateTickets.push({
        scope: "ability",
        identity,
        source_span: null,
        kind: "global_incoherence",
        question_family: "global-incoherence",
        reference_ids: [],
        evidence: ["frozen Round-4A composer returned incoherent"],
        target: "Terra",
        reason: "local decomposition is globally incoherent",
        adjudicated_correct: false,
      });
      continue;
    }
    for (const [modelId, outputs] of Object.entries(modelOutputs)) {
      const output = outputs.find((candidate) => identityKey(candidate) === identity);
      for (const diagnostic of output?.diagnostics ?? []) candidateTickets.push(diagnosticTicket(identity, diagnostic, modelId));
    }
    for (const row of [...agreement.atoms.rows, ...agreement.relations.rows]) {
      if (row.identity !== identity || row.bucket === "unanimous" || row.bucket === "majority") continue;
      candidateTickets.push(disagreementTicket(row));
    }
  }
  const draftsById = new Map<string, TicketDraft>();
  for (const candidate of candidateTickets) {
    const id = ticketId(candidate);
    const existing = draftsById.get(id);
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, ...candidate.evidence])].sort();
      existing.reference_ids = [...new Set([...existing.reference_ids, ...candidate.reference_ids])].sort();
      if (candidate.target === "Jev") existing.target = "Jev";
    } else {
      draftsById.set(id, { ...candidate, evidence: [...candidate.evidence], reference_ids: [...candidate.reference_ids] });
    }
  }
  const tickets = [...draftsById.values()].map((draft) => {
    const record = recordsByIdentity.get(draft.identity);
    if (!record) throw new Error(`Escalation ticket has unknown identity ${draft.identity}`);
    return normaliseTicket(draft, record, modelOutputs, terra);
  });
  return { run_id: dataset.run_id, status: "complete", terra, tickets: tickets.sort((left, right) => left.id.localeCompare(right.id)) };
}

function modelCallCount(model: ModelEvaluationArtifact["models"][string]): number {
  return model.request_hashes.length || model.records.length;
}

function selectedModels(
  evaluations: ModelEvaluationArtifact,
  modelIds: readonly string[],
): Array<ModelEvaluationArtifact["models"][string]> {
  return modelIds.map((modelId) => evaluations.models[modelId]).filter((model): model is ModelEvaluationArtifact["models"][string] => Boolean(model));
}

function aggregateRouting(
  policy: RoutingPolicyResult["policy"],
  name: string,
  evaluations: ModelEvaluationArtifact,
  modelIds: readonly string[],
  tickets: readonly EscalationTicket[],
  jev: OptionalStageArtifact,
  terra: OptionalStageArtifact,
  includeJev: boolean,
  includeTerra: boolean,
  modelCallOverride?: number,
): RoutingPolicyResult {
  const models = selectedModels(evaluations, modelIds);
  const modelCalls = modelCallOverride ?? models.reduce((total, model) => total + modelCallCount(model), 0);
  const modelLatencyValues = models.map((model) => model.latency_ms).filter((value): value is number => value !== null);
  const modelCostValues = models.map((model) => model.cost_usd).filter((value): value is number => value !== null);
  const modelLatency = modelLatencyValues.length === models.length
    ? modelLatencyValues.reduce((total, value) => total + value, 0)
    : null;
  const modelCost = modelCostValues.length === models.length
    ? modelCostValues.reduce((total, value) => total + value, 0)
    : null;
  const local = tickets.filter((ticket) => ticket.scope === "local").length;
  const ability = tickets.filter((ticket) => ticket.scope === "ability").length;
  const jevCalls = includeJev ? jev.calls : 0;
  const terraCalls = includeTerra ? Math.ceil(local / 20) + ability : 0;
  const jevLatency = includeJev ? jev.latency_ms : 0;
  const terraLatency = includeTerra ? terra.latency_ms : 0;
  const jevCost = includeJev ? jev.cost_usd : 0;
  const terraCost = includeTerra ? terra.cost_usd : 0;
  const totalKnown = jevCalls === null ? null : modelCalls + jevCalls + terraCalls;
  const totalLatency = modelLatency === null || jevCalls === null || jevLatency === null || terraLatency === null
    ? null
    : modelLatency + jevLatency + terraLatency;
  const totalCost = modelCost === null || jevCost === null || terraCost === null
    ? null
    : modelCost + jevCost + terraCost;
  const humanTail = includeTerra && terra.status === "complete"
    ? tickets.filter((ticket) => !terra.resolved_ticket_ids.includes(ticket.id)).length
    : tickets.length;
  return {
    policy,
    name,
    model_ids: [...modelIds],
    calls: { model: modelCalls, jev: jevCalls, terra: terraCalls, total_known: totalKnown },
    tickets: { local, ability, total: tickets.length },
    batches: {
      model: models.length,
      local_ticket: Math.ceil(local / 20),
      ability_ticket: ability,
      total_known: jevCalls === null ? null : models.length + terraCalls + jevCalls,
    },
    human_tail: {
      tickets: humanTail,
      status: includeTerra && terra.status === "complete" ? "measured" : "not_run",
    },
    latency_ms: {
      model_sequential: modelLatency,
      model_parallel: modelLatency === null ? null : Math.max(0, ...modelLatencyValues),
      jev: jevLatency,
      terra: terraLatency,
      total_known_sequential: totalLatency,
    },
    cost_usd: { model: modelCost, jev: jevCost, terra: terraCost, total_known: totalCost },
  };
}

export function projectToCorpus(
  evaluations: ModelEvaluationArtifact,
  agreement: AgreementAnalysis,
  corpusSize: number,
): CorpusProjection {
  if (!Number.isInteger(corpusSize) || corpusSize <= 0) throw new Error("Corpus projection requires a positive integer corpus size");
  const modelAtomRecall: Record<string, BinomialInterval> = {};
  const modelRelationRecall: Record<string, BinomialInterval> = {};
  for (const [modelId, model] of Object.entries(evaluations.models)) {
    modelAtomRecall[modelId] = wilsonInterval(model.atoms.overall.correct, model.atoms.overall.required);
    modelRelationRecall[modelId] = wilsonInterval(model.relations.overall.correct, model.relations.overall.required);
  }
  const agreementRows = [...agreement.atoms.rows, ...agreement.relations.rows];
  const sampledIdentities = new Set(agreementRows.map((row) => row.identity));
  const unresolvedIdentities = new Set(agreementRows.filter((row) => !row.correct).map((row) => row.identity));
  const unresolved = wilsonInterval(unresolvedIdentities.size, sampledIdentities.size);
  return {
    population: corpusSize,
    assumptions: ["The frozen source-only cohort is treated as a binomial sample of the supplied corpus population.", "An ability is unresolved when any atom or relation agreement row is incorrect.", "Intervals are 95% Wilson score intervals; no model output is repaired before projection."],
    model_atom_recall: modelAtomRecall,
    model_relation_recall: modelRelationRecall,
    agreement_unresolved: unresolved,
    projected_unresolved_abilities: {
      expected: unresolved.rate === null ? null : corpusSize * unresolved.rate,
      lower: unresolved.lower === null ? null : corpusSize * unresolved.lower,
      upper: unresolved.upper === null ? null : corpusSize * unresolved.upper,
    },
  };
}

export function simulateRouting(
  dataset: FrozenDataset,
  evaluations: ModelEvaluationArtifact,
  agreement: AgreementAnalysis,
  tickets: EscalationTicketArtifact,
  jev: OptionalStageArtifact,
  terra: OptionalStageArtifact,
  corpusSize = dataset.records.length,
): RoutingSimulation {
  const supporters = (ticket: EscalationTicket): string[] => {
    const value = ticket.evidence.find((evidence) => evidence.startsWith("supporters:"))?.slice("supporters:".length) ?? "";
    return value === "none" || value === "" ? [] : value.split(",");
  };
  const isCorrect = (ticket: EscalationTicket): boolean => ticket.adjudicated_correct;
  const lunaUnresolved = tickets.tickets.filter((ticket) => !isCorrect(ticket) || !supporters(ticket).includes("luna"));
  const twoCheapUnresolved = tickets.tickets.filter((ticket) => !isCorrect(ticket) || !supporters(ticket).includes("luna") || !supporters(ticket).includes("silver-a"));
  const conditionalSilverIdentities = new Set(lunaUnresolved.map((ticket) => ticket.identity));
  const conditionalUnresolved = lunaUnresolved.filter((ticket) => !isCorrect(ticket) || !supporters(ticket).includes("silver-a"));
  return {
    run_id: dataset.run_id,
    comparison: "not ranked",
    policies: [
      aggregateRouting("A", "Luna → Terra → human", evaluations, ["luna"], lunaUnresolved, jev, terra, false, true),
      aggregateRouting("B", "Luna → validated Jev → Terra → human", evaluations, ["luna"], lunaUnresolved, jev, terra, true, true),
      aggregateRouting("C", "Two cheap decomposers → Terra on disagreement → human", evaluations, ["luna", "silver-a"], twoCheapUnresolved, jev, terra, false, true),
      aggregateRouting("D", "Luna → conditional Silver → validated Jev → Terra → human", evaluations, ["luna", "silver-a"], conditionalUnresolved, jev, terra, true, true, dataset.records.length + conditionalSilverIdentities.size),
    ],
    corpus_projection: projectToCorpus(evaluations, agreement, corpusSize),
  };
}
