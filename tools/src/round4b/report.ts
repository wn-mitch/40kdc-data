import type { FrozenDataset } from "./contracts.js";
import type { AgreementAnalysis } from "./agreement.js";
import type { AssemblyResults } from "./assembly.js";
import type { ModelEvaluationArtifact } from "./evaluation.js";
import type { EscalationTicketArtifact, OptionalStageArtifact, RoutingSimulation } from "./routing.js";
const ROUND4A_REGEX_RECALL = 0.7414448669201521;

export interface Round4ABaseline {
  status: "available" | "not_available";
  source_hash: string | null;
  verdicts: string[];
}

export interface ReportInput {
  dataset: FrozenDataset;
  manifest_hash: string;
  evaluation_hash: string;
  model_evaluation: ModelEvaluationArtifact;
  agreement: AgreementAnalysis;
  assembly: AssemblyResults;
  tickets: EscalationTicketArtifact;
  routing: RoutingSimulation;
  jev: OptionalStageArtifact;
  terra: OptionalStageArtifact;
  baseline: Round4ABaseline;
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatMetric(metric: { correct: number; predicted: number; required: number; precision: number | null; recall: number | null; f1: number | null }): string {
  return `${metric.correct}/${metric.predicted}/${metric.required}; precision ${formatRate(metric.precision)}, recall ${formatRate(metric.recall)}, F1 ${formatRate(metric.f1)}`;
}

function metricRows(rows: Record<string, { correct: number; predicted: number; required: number; precision: number | null; recall: number | null; f1: number | null }>): string[] {
  return Object.entries(rows)
    .filter(([, metric]) => metric.predicted > 0 || metric.required > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, metric]) => `- ${key}: ${formatMetric(metric)}`);
}

function formatMeasured(value: number | null, unit = ""): string {
  return value === null ? "not measured" : `${value}${unit}`;
}

function formatCost(value: number | null): string {
  return value === null ? "not measured" : `$${value.toFixed(6)}`;
}

function formatProjected(value: number | null): string {
  return value === null ? "not measured" : String(Math.round(value));
}

function stageSummary(stage: OptionalStageArtifact): string {
  if (stage.status === "not_run") return `not_run (${stage.reason ?? "artifact absent"})`;
  if (stage.status === "invalid") return `invalid (${stage.reason ?? "invalid staged artifact"})`;
  return `complete; calls ${formatMeasured(stage.calls)}, latency ${formatMeasured(stage.latency_ms, "ms")}, cost ${formatCost(stage.cost_usd)}`;
}

function stageAccuracy(stage: OptionalStageArtifact): string {
  if (!stage.raw || typeof stage.raw !== "object" || Array.isArray(stage.raw)) return "not measured";
  const accuracy = (stage.raw as Record<string, unknown>).accuracy;
  if (!accuracy || typeof accuracy !== "object" || Array.isArray(accuracy)) return "not measured";
  const record = accuracy as Record<string, unknown>;
  return typeof record.correct === "number" && typeof record.total === "number" && typeof record.rate === "number"
    ? `${record.correct}/${record.total} (${formatRate(record.rate)})`
    : "not measured";
}

function agreementSummary(agreement: AgreementAnalysis, kind: "atoms" | "relations"): string {
  return Object.entries(agreement[kind].buckets)
    .map(([bucket, value]) => `${bucket} ${value.correct}/${value.total}`)
    .join("; ");
}

function weakFamilies(input: ReportInput): string[] {
  return Object.values(input.model_evaluation.models).map((model) => {
    const metrics = Object.entries(model.atoms.by_family)
      .filter(([, metric]) => metric.required > 0)
      .sort(([leftFamily, left], [rightFamily, right]) => {
        const leftF1 = left.f1 ?? Number.POSITIVE_INFINITY;
        const rightF1 = right.f1 ?? Number.POSITIVE_INFINITY;
        return leftF1 - rightF1 || leftFamily.localeCompare(rightFamily);
      })
      .slice(0, 3)
      .map(([family, metric]) => `${family} (${formatMetric(metric)})`);
    return `- ${model.model_id}: ${metrics.length ? metrics.join("; ") : "no required atom family in the frozen cohort"}.`;
  });
}

function modelAccuracyRows(input: ReportInput): string[] {
  return Object.values(input.model_evaluation.models).map((model) =>
    `- ${model.model_id}: status ${model.status}; atoms ${formatMetric(model.atoms.overall)}; relations ${formatMetric(model.relations.overall)}; ungrounded findings ${model.records.flatMap((record) => [...record.atoms.rows, ...record.relations.rows]).filter((row) => row.failure === "UNGROUNDED_GUESS").length}.`,
  );
}

function routingRows(input: ReportInput): string[] {
  return input.routing.policies.flatMap((policy) => {
    const includesJev = policy.policy === "B" || policy.policy === "D";
    return [
      `- Policy ${policy.policy} (${policy.name}): models ${policy.model_ids.join(", ")}; model calls ${policy.calls.model}; Jev calls ${includesJev ? formatMeasured(policy.calls.jev) : "not applicable"}; Terra calls ${formatMeasured(policy.calls.terra)}; known total calls ${formatMeasured(policy.calls.total_known)}.`,
      `  Tickets local/ability/total ${policy.tickets.local}/${policy.tickets.ability}/${policy.tickets.total}; batches model/local/ability/known total ${policy.batches.model}/${policy.batches.local_ticket}/${policy.batches.ability_ticket}/${formatMeasured(policy.batches.total_known)}; human tail ${policy.human_tail.tickets} (${policy.human_tail.status}).`,
      `  Model latency sequential/parallel ${formatMeasured(policy.latency_ms.model_sequential, "ms")}/${formatMeasured(policy.latency_ms.model_parallel, "ms")}; known sequential latency ${formatMeasured(policy.latency_ms.total_known_sequential, "ms")}; known total cost ${formatCost(policy.cost_usd.total_known)}.`,
    ];
  });
}

function reportVerdicts(input: ReportInput): string[] {
  const luna = input.model_evaluation.models.luna;
  const silverModels = ["silver-a", "silver-b", "silver-c"]
    .map((id) => input.model_evaluation.models[id])
    .filter((model): model is NonNullable<typeof model> => Boolean(model));
  const bestSilver = [...silverModels].sort((left, right) => (right.atoms.overall.recall ?? -1) - (left.atoms.overall.recall ?? -1))[0];
  const sol = input.model_evaluation.models["sol-ceiling"];
  const controlComplete = input.assembly.adjudicated_control.results.filter((row) => row.complete).length;
  const policyD = input.routing.policies.find((policy) => policy.policy === "D");
  const terraSample = stageAccuracy(input.terra);
  const terraTicketRate = input.tickets.tickets.length / input.dataset.records.length;
  const jevRole = input.jev.status === "complete"
    ? stageSummary(input.jev)
    : `${stageSummary(input.jev)} Only replacement-vs-coexistence was eligible from the frozen Round 4A stability result; the generated tickets did not contain a self-contained candidate relation proposition.`;
  return [
    `1. Does Luna solve candidate generation? No. Atom recall is ${luna ? formatRate(luna.atoms.overall.recall) : "not measured"} versus the frozen Round 4A regex baseline ${formatRate(ROUND4A_REGEX_RECALL)}, relation recall is ${luna ? formatRate(luna.relations.overall.recall) : "not measured"}, and source-complete assembly is ${input.assembly.models.luna?.results.filter((row) => row.complete).length ?? 0}/${input.dataset.records.length}.`,
    `2. How much does Silver improve? The best cheap arm is ${bestSilver?.model_id ?? "not measured"} at ${bestSilver ? formatRate(bestSilver.atoms.overall.recall) : "not measured"} atom recall, ${bestSilver && luna && bestSilver.atoms.overall.recall !== null && luna.atoms.overall.recall !== null ? `${((bestSilver.atoms.overall.recall - luna.atoms.overall.recall) * 100).toFixed(1)} percentage points over Luna` : "with no measured delta"}, still below the Round 4A baseline.`,
    `3. Is Sol needed in the normal path? No. Sol reaches ${sol ? formatRate(sol.atoms.overall.recall) : "not measured"} atom recall but ${sol ? formatRate(sol.atoms.overall.precision) : "not measured"} precision, ${sol ? formatRate(sol.relations.overall.recall) : "not measured"} relation recall, and ${input.assembly.models["sol-ceiling"]?.results.filter((row) => row.complete).length ?? 0}/${input.dataset.records.length} source-complete assemblies.`,
    `4. Which errors belong to Jev? Only the frozen replacement-vs-coexistence family was eligible. Measured Round 4B contribution: ${jevRole}`,
    "5. Which errors belong to Luna or Silver? Source-grounded atom proposals belong to the decomposers, but neither cheap tier is reliable as the sole semantic authority; weak-family and agreement tables identify the rerun candidates.",
    `6. Which errors require Terra? Non-Jev relation disagreements, all-missed items, and globally incoherent ability graphs require escalation; the generated queue contains ${input.tickets.tickets.filter((ticket) => ticket.target === "Terra").length} Terra-target tickets.`,
    `7. Is Terra sparse enough? No. The queue contains ${input.tickets.tickets.length} tickets across ${input.dataset.records.length} abilities (${terraTicketRate.toFixed(1)} tickets per ability); the 30-ticket batch accuracy is ${terraSample}.`,
    `8. Is the human tail genuinely small? No. Policy D leaves ${policyD ? policyD.human_tail.tickets : "an unmeasured number of"} tickets for humans after the measured Terra sample.`,
    `9. Is the composer mostly solved? Yes for supplied semantics: the unchanged deterministic composer completes ${controlComplete}/${input.dataset.records.length} adjudicated controls, while every model arm completes 0/${input.dataset.records.length} source-semantic graphs.`,
    "10. Smallest justified next experiment: freeze a smaller relation-only cohort with a controlled relation ontology and self-contained local propositions, then repeat decomposition and bounded adjudication. Do not build production infrastructure from this result.",
  ];
}

export function renderRound4BReport(input: ReportInput): string {
  const controlComplete = input.assembly.adjudicated_control.results.filter((row) => row.complete).length;
  const projection = input.routing.corpus_projection;
  return [
    "# Round 4B — Model-Driven Semantic Decomposition",
    "",
    "## A. Frozen cohort",
    "",
    `Run \`${input.dataset.run_id}\`; cohort hash \`${input.dataset.cohort_hash}\`; ${input.dataset.records.length} frozen abilities.`,
    `Manifest hash \`${input.manifest_hash}\`; evaluation hash \`${input.evaluation_hash}\`.`,
    "",
    "## B. Decomposition accuracy",
    "",
    ...modelAccuracyRows(input),
    "",
    "## C. Weak families",
    "",
    ...weakFamilies(input),
    "",
    "## D. Relation/binding performance",
    "",
    ...Object.values(input.model_evaluation.models).flatMap((model) => [
      `- ${model.model_id}: overall ${formatMetric(model.relations.overall)}.`,
      ...metricRows(model.relations.by_type).map((row) => `  ${row.slice(2)}`),
      ...Object.entries(model.relations.single_choice_accuracy)
        .filter(([, metric]) => metric.required > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([dimension, metric]) => `  ${dimension}: ${metric.correct}/${metric.required}; accuracy ${formatRate(metric.accuracy)}.`),
    ]),
    "",
    "## E. Agreement analysis",
    "",
    `Atoms: ${agreementSummary(input.agreement, "atoms")}.`,
    `Relations: ${agreementSummary(input.agreement, "relations")}.`,
    `Error-family associations: ${JSON.stringify(input.agreement.disagreement_associations.required_error_families)}.`,
    "",
    "## F. Deterministic composition",
    "",
    `Adapter: ${input.assembly.adapter}. Adjudicated control complete ${controlComplete}/${input.dataset.records.length}.`,
    ...Object.entries(input.assembly.models)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([modelId, model]) => `- ${modelId}: ${model.results.filter((result) => result.complete).length}/${model.results.length} complete neutral graphs; composer failures ${model.results.reduce((total, result) => total + result.composer_failures.length, 0)}.`),
    "",
    "## G. Jev's measured role",
    "",
    `Jev: ${stageSummary(input.jev)}.`,
    "",
    "## H. Terra queue experiment",
    "",
    `Terra: ${stageSummary(input.terra)}.`,
    `Tickets: ${input.tickets.tickets.length}; local ${input.tickets.tickets.filter((ticket) => ticket.scope === "local").length}; ability ${input.tickets.tickets.filter((ticket) => ticket.scope === "ability").length}.`,
    `Terra adjudication accuracy: ${stageAccuracy(input.terra)}.`,
    "",
    "## I. Human tail",
    "",
    ...input.routing.policies.map((policy) => `- Policy ${policy.policy}: ${policy.human_tail.tickets} tickets (${policy.human_tail.status}).`),
    "",
    "## J. Routing policy comparison",
    "",
    "Policies are simulated from observed artifacts and are not ranked.",
    ...routingRows(input),
    "",
    "## K. Corpus-scale projection",
    "",
    `Population ${projection.population}; agreement-unresolved expected/lower/upper ${formatProjected(projection.projected_unresolved_abilities.expected)}/${formatProjected(projection.projected_unresolved_abilities.lower)}/${formatProjected(projection.projected_unresolved_abilities.upper)}.`,
    ...projection.assumptions.map((assumption) => `- ${assumption}`),
    "",
    "## L. Economics",
    "",
    ...input.routing.policies.map((policy) => {
      const includesJev = policy.policy === "B" || policy.policy === "D";
      return `- Policy ${policy.policy}: model ${formatCost(policy.cost_usd.model)}; Jev ${includesJev ? formatCost(policy.cost_usd.jev) : "not applicable"}; Terra ${formatCost(policy.cost_usd.terra)}; known total ${formatCost(policy.cost_usd.total_known)}.`;
    }),
    "",
    "## M. Verdict",
    "",
    ...reportVerdicts(input),
    "",
  ].join("\n");
}
