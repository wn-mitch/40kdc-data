import { describe, expect, it } from "vitest";
import type { AtomCandidate, RelationJudgment, RelationQuestion } from "../src/round4/contracts.js";
import { assembleGraphs, composeWithFrozenRound4A } from "../src/round4b/assembly.js";
import { analyseAgreement } from "../src/round4b/agreement.js";
import type { DecompositionAtom, EvaluatorAnnotation, FrozenDataset, ModelOutputEnvelope } from "../src/round4b/contracts.js";
import { selectRound4BCohort, type SourceIndex, type SourceRecord } from "../src/round4b/cohort.js";
import { evaluateModelArtifacts, type AnnotationArtifact } from "../src/round4b/evaluation.js";
import { freezeDataset } from "../src/round4b/freeze.js";
import { createSourceOnlyModelInput, validateGroundedModelOutput } from "../src/round4b/prompt.js";
import { generateEscalationTickets, simulateRouting, type OptionalStageArtifact } from "../src/round4b/routing.js";
import { renderRound4BReport } from "../src/round4b/report.js";
import { wilsonInterval, type ModelOutputArtifact } from "../src/round4b/shared.js";

function fixtureIndex(): SourceIndex {
  const records: Record<string, SourceRecord> = {};
  for (let index = 1; index <= 5; index += 1) {
    records[`dice-${index}`] = { raw_text: `Roll a D6 for outcome ${index}${index === 1 ? " with unité" : ""}.` };
    records[`attack-${index}`] = { raw_text: `Add ${index} to this unit's Attack characteristic.` };
    records[`condition-${index}`] = { raw_text: `If it has moved previously, apply rule ${index}.` };
    records[`menu-${index}`] = { raw_text: `Choose one option and spend one Command Point ${index}.` };
    records[`iteration-${index}`] = { raw_text: `Each unit within range does this until the end of the turn ${index}.` };
    records[`random-${index}`] = { raw_text: `Plain source wording number ${index}.` };
  }
  records["helm-of-brazen-ire-berzerker-warband"] = { raw_text: "Roll a D6 for excluded source." };
  return { "world-eaters": records };
}

describe("Round 4B source-only foundation", () => {
  it("selects a deterministic fresh 30-record cohort with five exact assigned records per stratum", () => {
    const first = selectRound4BCohort(fixtureIndex());
    const second = selectRound4BCohort(fixtureIndex());
    expect(first.map(({ faction_id, ability_id, selection, source_hash }) => ({ faction_id, ability_id, selection, source_hash }))).toEqual(
      second.map(({ faction_id, ability_id, selection, source_hash }) => ({ faction_id, ability_id, selection, source_hash })),
    );
    expect(new Set(first.map((record) => `${record.faction_id}/${record.ability_id}`)).size).toBe(30);
    expect(first).not.toContainEqual(expect.objectContaining({ ability_id: "helm-of-brazen-ire-berzerker-warband" }));
    expect(Object.fromEntries(["dice-random", "attack-combat-modification", "condition-history-anaphora", "menu-choice-resource", "iteration-duration-spatial", "random-corpus-draw"].map((stratum) => [stratum, first.filter((record) => record.selection.assigned_stratum === stratum).length]))).toEqual({
      "dice-random": 5,
      "attack-combat-modification": 5,
      "condition-history-anaphora": 5,
      "menu-choice-resource": 5,
      "iteration-duration-spatial": 5,
      "random-corpus-draw": 5,
    });
  });

  it("freezes UTF-8 bytes and stages a model input with no evaluator fields", () => {
    const source = fixtureIndex();
    source["world-eaters"]!["structured"] = { when: "When this occurs.", effect: "Do a thing." };
    const dataset = freezeDataset(source, new Date("2026-01-02T03:04:05.000Z"));
    const modelInput = createSourceOnlyModelInput(dataset);
    expect(dataset.records).toHaveLength(30);
    const utf8Record = dataset.records.find((record) => record.ability_id === "dice-1")!;
    expect(utf8Record.source_byte_length).toBe(Buffer.byteLength(utf8Record.source_text, "utf8"));
    expect(utf8Record.source_fragments).toEqual([{ label: "RAW_TEXT", start: 0, end: utf8Record.source_byte_length }]);
    expect(modelInput.records).toHaveLength(30);
    expect(Object.keys(modelInput)).toEqual(["contract_version", "run_id", "cohort_hash", "output_schema", "records"]);
    expect(Object.keys(modelInput.records[0]!).sort()).toEqual(["ability_id", "faction_id", "name", "selection", "source_byte_length", "source_fragments", "source_hash", "source_text"]);
    expect(JSON.stringify(modelInput)).not.toContain("evaluator");
  });

  it("requires atom text to match UTF-8 source bytes", () => {
    const dataset = freezeDataset(fixtureIndex(), new Date("2026-01-02T03:04:05.000Z"));
    const record = createSourceOnlyModelInput(dataset).records.find((candidate) => candidate.ability_id === "dice-1")!;
    const start = Buffer.byteLength(record.source_text.slice(0, record.source_text.indexOf("D6")), "utf8");
    const output: ModelOutputEnvelope = {
      contract_version: 1 as const,
      run_id: dataset.run_id,
      faction_id: record.faction_id,
      ability_id: record.ability_id,
      source_hash: record.source_hash,
      atoms: [{ id: "a1", family: "magnitude-expression", normalized_meaning: "die", source_span: { start, end: start + 2 }, source_text: "D6", dice: "D6" }],
      relations: [],
      diagnostics: [],
    };
    expect(validateGroundedModelOutput(record, output)).toEqual([]);
    expect(validateGroundedModelOutput(record, { ...output, atoms: [{ ...output.atoms[0]!, source_text: "D3" }] })).toContain("atom a1 source text does not match its byte span");
  });
});

interface FrozenFixture {
  dataset: FrozenDataset;
  target: FrozenDataset["records"][number];
  atom: DecompositionAtom;
  annotations: AnnotationArtifact;
}

function frozenFixture(): FrozenFixture {
  const dataset = freezeDataset(fixtureIndex(), new Date("2026-01-02T03:04:05.000Z"));
  const target = dataset.records.find((record) => record.ability_id === "dice-1")!;
  const start = Buffer.byteLength(target.source_text.slice(0, target.source_text.indexOf("D6")), "utf8");
  const atom = {
    id: "die",
    family: "magnitude-expression" as const,
    normalized_meaning: "die",
    source_span: { start, end: start + 2 },
    source_text: "D6",
    dice: "D6",
  };
  const annotations: AnnotationArtifact = {
    run_id: dataset.run_id,
    annotations: dataset.records.map((record): EvaluatorAnnotation => ({
      faction_id: record.faction_id,
      ability_id: record.ability_id,
      source_hash: record.source_hash,
      state: "ADJUDICATED",
      atoms: record.ability_id === target.ability_id ? [atom] : [],
      relations: [],
      diagnostics: [],
    })),
  };
  return { dataset, target, atom, annotations };
}

function modelArtifact(
  modelId: "luna" | "silver-a" | "silver-b" | "silver-c",
  fixture: FrozenFixture,
  targetAtoms: ModelOutputEnvelope["atoms"],
): ModelOutputArtifact {
  return {
    run_id: fixture.dataset.run_id,
    model_id: modelId,
    actual_agent: modelId,
    prompt_hash: "frozen-prompt",
    request_hashes: fixture.dataset.records.map((record) => `${modelId}/${record.ability_id}`),
    latency_ms: 10,
    cost_usd: 1,
    records: fixture.dataset.records.map((record): ModelOutputEnvelope => ({
      contract_version: 1,
      run_id: fixture.dataset.run_id,
      faction_id: record.faction_id,
      ability_id: record.ability_id,
      source_hash: record.source_hash,
      atoms: record.ability_id === fixture.target.ability_id ? targetAtoms : [],
      relations: [],
      diagnostics: [],
    })),
  };
}

describe("Round 4B evaluation", () => {
  it("matches only grounded same-family, normalized-meaning, overlapping atoms and attributes ungrounded guesses upstream", () => {
    const fixture = frozenFixture();
    const invalid = { ...fixture.atom, source_text: "D3" };
    const evaluation = evaluateModelArtifacts(
      fixture.dataset,
      fixture.annotations,
      "frozen-prompt",
      { luna: modelArtifact("luna", fixture, [invalid]) },
      ["luna"],
    );
    const row = evaluation.models.luna!.records.find((record) => record.identity.endsWith("/dice-1"))!;
    expect(row.atoms.metric).toMatchObject({ correct: 0, predicted: 1, required: 1 });
    expect(row.atoms.rows[0]).toMatchObject({ grounded: false, failure: "UNGROUNDED_GUESS", matched_annotation_atom_id: null });
    expect(row.validation_errors).toContain("atom die source text does not match its byte span");
  });

  it("places unsupported competing models in the divided agreement bucket", () => {
    const fixture = frozenFixture();
    const wrong = { ...fixture.atom, id: "wrong", normalized_meaning: "different die meaning", source_span: { start: 0, end: 4 }, source_text: "Roll", dice: undefined };
    const evaluation = evaluateModelArtifacts(
      fixture.dataset,
      fixture.annotations,
      "frozen-prompt",
      {
        luna: modelArtifact("luna", fixture, []),
        "silver-a": modelArtifact("silver-a", fixture, [wrong]),
        "silver-b": modelArtifact("silver-b", fixture, [{ ...wrong, id: "wrong-b" }]),
        "silver-c": modelArtifact("silver-c", fixture, []),
      },
      ["luna", "silver-a", "silver-b", "silver-c"],
    );
    const agreement = analyseAgreement(fixture.dataset, fixture.annotations, evaluation);
    expect(agreement.atoms.rows.find((row) => row.reference_id.startsWith("prediction:"))).toMatchObject({ bucket: "divided", correct: false });
    expect(agreement.atoms.buckets.divided).toMatchObject({ correct: 0, total: 1 });
  });

  it("preserves the unchanged Round-4A composer failure code through the adapter boundary", () => {
    const atom: AtomCandidate = {
      id: "candidate",
      family: "event",
      rank: 1,
      role: "event",
      meaning: "event",
      value: null,
      participant: null,
      arguments: {},
      evidence: [{ span: { start: 0, end: 1 }, channel: "local-context" }],
    };
    const question: RelationQuestion = {
      id: "q1",
      identity: { faction_id: "test", ability_id: "ability" },
      type: "antecedent",
      source_span: { start: 0, end: 1 },
      source_context: "",
      prompt: "",
      subject_atom_ids: ["candidate"],
      options: [{ id: "candidate", label: "candidate", description: "", kind: "candidate", atom_id: "candidate" }],
    };
    const judgment: RelationJudgment = { question_id: "q1", question_type: "antecedent", selected: "missing", source_span: { start: 0, end: 1 } };
    expect(composeWithFrozenRound4A([atom], [question], [judgment]).failures).toEqual(["LOCAL_CHOICES_INCOHERENT"]);
  });

  it("reports required headings while preserving observed routing totals", () => {
    const fixture = frozenFixture();
    const allModels = {
      luna: modelArtifact("luna", fixture, [fixture.atom]),
      "silver-a": modelArtifact("silver-a", fixture, [fixture.atom]),
      "silver-b": modelArtifact("silver-b", fixture, [fixture.atom]),
      "silver-c": modelArtifact("silver-c", fixture, [fixture.atom]),
    };
    const evaluation = evaluateModelArtifacts(fixture.dataset, fixture.annotations, "frozen-prompt", allModels, ["luna", "silver-a", "silver-b", "silver-c"]);
    const agreement = analyseAgreement(fixture.dataset, fixture.annotations, evaluation);
    const notRun: OptionalStageArtifact = { status: "not_run", source_path: null, source_hash: null, calls: null, latency_ms: null, cost_usd: null, resolved_ticket_ids: [], raw: null, reason: "absent" };
    const outputs: Record<string, ModelOutputEnvelope[]> = {};
    for (const [modelId, artifact] of Object.entries(allModels)) outputs[modelId] = artifact.records;
    const assembly = assembleGraphs(fixture.dataset, fixture.annotations, outputs, evaluation);
    const tickets = generateEscalationTickets(fixture.dataset, outputs, agreement, assembly, notRun);
    const routing = simulateRouting(fixture.dataset, evaluation, agreement, tickets, notRun, notRun, 100);
    const unmeasuredEvaluation = evaluateModelArtifacts(
      fixture.dataset,
      fixture.annotations,
      "frozen-prompt",
      { ...allModels, luna: { ...allModels.luna, latency_ms: undefined, cost_usd: undefined } },
      ["luna", "silver-a", "silver-b", "silver-c"],
    );
    const unmeasuredRouting = simulateRouting(fixture.dataset, unmeasuredEvaluation, agreement, tickets, notRun, notRun, 100);
    const report = renderRound4BReport({
      dataset: fixture.dataset,
      manifest_hash: "manifest",
      evaluation_hash: "evaluation",
      model_evaluation: evaluation,
      agreement,
      assembly,
      tickets,
      routing,
      jev: notRun,
      terra: notRun,
      baseline: { status: "not_available", source_hash: null, verdicts: [] },
    });
    expect(wilsonInterval(5, 10)).toMatchObject({ rate: 0.5, confidence: 0.95 });
    expect(routing.comparison).toBe("not ranked");
    expect(routing.policies[1]).toMatchObject({ calls: { model: 30, total_known: null }, latency_ms: { model_sequential: 10, model_parallel: 10, total_known_sequential: null }, cost_usd: { model: 1, total_known: null } });
    expect(routing.corpus_projection.population).toBe(100);
    expect(unmeasuredRouting.policies[0]).toMatchObject({
      latency_ms: { model_sequential: null, model_parallel: null, total_known_sequential: null },
      cost_usd: { model: null, total_known: null },
    });
    expect(report.match(/^## [A-M]\. .+$/gmu)).toEqual([
      "## A. Frozen cohort",
      "## B. Decomposition accuracy",
      "## C. Weak families",
      "## D. Relation/binding performance",
      "## E. Agreement analysis",
      "## F. Deterministic composition",
      "## G. Jev's measured role",
      "## H. Terra queue experiment",
      "## I. Human tail",
      "## J. Routing policy comparison",
      "## K. Corpus-scale projection",
      "## L. Economics",
      "## M. Verdict",
    ]);
    expect(report.match(/^\d+\. /gmu)).toHaveLength(10);
    expect(report).toContain("Jev: not_run (absent).");
    expect(report).toContain("Terra: not_run (absent).");
  });
});
