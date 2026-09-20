import { composeAtoms, type CompositionResult, type RelationJudgment } from "../round4/composer.js";
import type { AtomCandidate, RelationQuestion, RelationQuestionType } from "../round4/contracts.js";
import type { DecompositionAtom, DecompositionRelation, EvaluatorAnnotation, FrozenDataset, ModelOutputEnvelope } from "./contracts.js";
import { identityKey } from "./shared.js";
import type { AnnotationArtifact, ModelAbilityEvaluation, ModelEvaluationArtifact } from "./evaluation.js";

export interface NeutralGraph {
  schema: "round4b-neutral-graph-v1";
  identity: { faction_id: string; ability_id: string };
  atoms: DecompositionAtom[];
  relations: DecompositionRelation[];
  roots: string[];
}

export interface AdapterResult {
  atoms: AtomCandidate[];
  questions: RelationQuestion[];
  judgments: RelationJudgment[];
  skipped_relations: Array<{ id: string; reason: "NOVEL_RELATION" }>;
}

export interface AssemblyAbilityResult {
  identity: string;
  neutral_graph: NeutralGraph;
  schema_valid: boolean;
  schema_errors: string[];
  structurally_composed: boolean;
  complete: boolean;
  fidelity: { atoms: ModelAbilityEvaluation["atoms"]["metric"]; relations: ModelAbilityEvaluation["relations"]["metric"] };
  composition: CompositionResult;
  typed_failures: string[];
  composer_failures: CompositionResult["failures"];
}

export interface AssemblyModelResults {
  status: ModelEvaluationArtifact["models"][string]["status"];
  results: AssemblyAbilityResult[];
}

export interface AssemblyResults {
  run_id: string;
  adapter: "round4a-composeAtoms-unchanged";
  models: Record<string, AssemblyModelResults>;
  adjudicated_control: { status: "complete"; results: AssemblyAbilityResult[] };
}

function toRound4Atom(atom: DecompositionAtom): AtomCandidate {
  const atomArguments: Record<string, string | number | boolean | null> = {};
  if (atom.unit !== undefined) atomArguments.unit = atom.unit;
  if (atom.dice !== undefined) atomArguments.dice = atom.dice;
  if (atom.registry_key !== undefined) atomArguments.registry_key = atom.registry_key;
  return {
    id: atom.id,
    family: atom.family,
    rank: 1,
    role: atom.family,
    meaning: atom.normalized_meaning,
    value: atom.literal ?? null,
    participant: atom.participant ?? null,
    arguments: atomArguments,
    evidence: [{ span: atom.source_span, channel: "local-context" }],
  };
}

function relationQuestionType(relation: DecompositionRelation): RelationQuestionType {
  switch (relation.type) {
    case "antecedent-of":
      return "antecedent";
    case "binds-to":
    case "iterates-over":
    case "iterator-collection":
      return "iterator-collection";
    case "attaches-to":
    case "duration-of":
      return "duration-scope";
    case "condition-of":
    case "governs":
    case "modifies":
    case "precedes":
      return "attachment";
    case "branch-kind":
      return "branch-kind";
    case "choice-vs-disjunction":
    case "choice-option-of":
      return "choice-vs-disjunction";
    case "replacement-vs-coexistence":
    case "replaces":
      return "replacement-vs-coexistence";
    case "argument-filling":
    case "targets":
    case "consumes-resource":
      return "argument-filling";
    default:
      return "argument-filling";
  }
}

export function adaptRound4BForComposer(
  identity: { faction_id: string; ability_id: string },
  atoms: readonly DecompositionAtom[],
  relations: readonly DecompositionRelation[],
): AdapterResult {
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const questions: RelationQuestion[] = [];
  const judgments: RelationJudgment[] = [];
  const skipped_relations: AdapterResult["skipped_relations"] = [];
  for (const [index, relation] of relations.entries()) {
    if (relation.type === "novel_relation") {
      skipped_relations.push({ id: relation.id, reason: "NOVEL_RELATION" });
      continue;
    }
    const target = atomById.get(relation.to_atom_id);
    const source = atomById.get(relation.from_atom_id);
    const sourceSpan = relation.source_span ?? target?.source_span ?? source?.source_span ?? { start: 0, end: 0 };
    const id = `round4b-local-${String(index + 1).padStart(3, "0")}-${relation.id}`;
    const type = relationQuestionType(relation);
    questions.push({
      id,
      identity,
      type,
      source_span: sourceSpan,
      source_context: "",
      prompt: relation.type,
      subject_atom_ids: [relation.to_atom_id],
      options: [{ id: relation.to_atom_id, label: target?.normalized_meaning ?? relation.to_atom_id, description: relation.type, kind: "candidate", atom_id: relation.to_atom_id }],
    });
    judgments.push({ question_id: id, question_type: type, selected: relation.to_atom_id, source_span: sourceSpan });
  }
  return { atoms: atoms.map(toRound4Atom), questions, judgments, skipped_relations };
}

/** This is the sole call boundary to the unchanged frozen Round-4A composer. */
export function composeWithFrozenRound4A(
  atoms: AtomCandidate[],
  questions: RelationQuestion[],
  judgments: RelationJudgment[],
): CompositionResult {
  return composeAtoms(atoms, questions, judgments);
}

function neutralGraph(identity: { faction_id: string; ability_id: string }, atoms: readonly DecompositionAtom[], relations: readonly DecompositionRelation[]): NeutralGraph {
  const targets = new Set(relations.map((relation) => relation.to_atom_id));
  return {
    schema: "round4b-neutral-graph-v1",
    identity,
    atoms: [...atoms],
    relations: [...relations],
    roots: atoms.filter((atom) => !targets.has(atom.id)).map((atom) => atom.id),
  };
}

export function validateNeutralGraph(graph: NeutralGraph): string[] {
  const errors: string[] = [];
  if (graph.schema !== "round4b-neutral-graph-v1") errors.push("neutral graph schema is unsupported");
  const identifiers = new Set<string>();
  for (const atom of graph.atoms) {
    if (!atom.id || identifiers.has(atom.id)) errors.push(`neutral graph has duplicate or empty atom id ${atom.id}`);
    identifiers.add(atom.id);
  }
  for (const relation of graph.relations) {
    if (!identifiers.has(relation.from_atom_id) || !identifiers.has(relation.to_atom_id)) errors.push(`neutral graph relation ${relation.id} has an unknown endpoint`);
  }
  for (const root of graph.roots) if (!identifiers.has(root)) errors.push(`neutral graph root ${root} is unknown`);
  return errors;
}

function annotationControlRow(record: FrozenDataset["records"][number], annotation: EvaluatorAnnotation): ModelAbilityEvaluation {
  const atomCount = annotation.atoms.length;
  const relationCount = annotation.relations.filter((relation) => relation.type !== "novel_relation").length;
  const metric = (correct: number, predicted: number, required: number) => ({
    correct,
    predicted,
    required,
    precision: predicted ? correct / predicted : null,
    recall: required ? correct / required : null,
    f1: predicted && required ? 1 : null,
  });
  return {
    identity: identityKey(record),
    model_id: "adjudicated-control",
    output_status: "complete",
    validation_errors: [],
    atoms: { metric: metric(atomCount, atomCount, atomCount), by_family: {}, rows: [], matched_annotation_atom_ids: annotation.atoms.map((atom) => atom.id), missed_annotation_atom_ids: [] },
    relations: { metric: metric(relationCount, relationCount, relationCount), by_type: {}, single_choice_accuracy: {}, rows: [], matched_annotation_relation_ids: annotation.relations.filter((relation) => relation.type !== "novel_relation").map((relation) => relation.id), missed_annotation_relation_ids: [] },
    novelty: { atoms: [], relations: [], diagnostics: 0 },
    dsl_gaps: annotation.state === "DSL_GAP" ? annotation.atoms.map((atom) => atom.id) : [],
    ambiguity: annotation.state === "ANNOTATION_AMBIGUITY" ? annotation.atoms.map((atom) => atom.id) : [],
    annotation_disagreements: annotation.state === "ANNOTATION_AMBIGUITY" ? ["annotation-state"] : [],
  };
}

function assembleOne(
  record: FrozenDataset["records"][number],
  output: ModelOutputEnvelope,
  evaluation: ModelAbilityEvaluation,
): AssemblyAbilityResult {
  const graph = neutralGraph(record, output.atoms, output.relations);
  const schemaErrors = validateNeutralGraph(graph);
  const adapted = adaptRound4BForComposer(record, output.atoms, output.relations);
  const composition = composeWithFrozenRound4A(adapted.atoms, adapted.questions, adapted.judgments);
  const typedFailures = [
    ...(evaluation.validation_errors.length ? ["MODEL_OUTPUT_INVALID"] : []),
    ...(evaluation.atoms.metric.recall !== 1 || evaluation.relations.metric.recall !== 1 ? ["SOURCE_SEMANTIC_MISS"] : []),
    ...(evaluation.atoms.rows.some((row) => row.failure === "UNGROUNDED_GUESS") || evaluation.relations.rows.some((row) => row.failure === "UNGROUNDED_GUESS") ? ["UNGROUNDED_GUESS"] : []),
    ...adapted.skipped_relations.map((relation) => relation.reason),
    ...(evaluation.dsl_gaps.length ? ["DSL_GAP"] : []),
    ...(evaluation.ambiguity.length ? ["ANNOTATION_AMBIGUITY"] : []),
    ...composition.failures,
    ...(composition.status === "incomplete" && composition.failures.length === 0 ? ["COMPOSER_INCOMPLETE"] : []),
    ...(schemaErrors.length ? ["NEUTRAL_GRAPH_INVALID"] : []),
  ];
  const structurallyComposed = schemaErrors.length === 0 && evaluation.validation_errors.length === 0 && composition.status === "composed";
  const sourceFaithful = evaluation.atoms.metric.recall === 1 && evaluation.relations.metric.recall === 1;
  return {
    identity: identityKey(record),
    neutral_graph: graph,
    schema_valid: schemaErrors.length === 0,
    schema_errors: schemaErrors,
    structurally_composed: structurallyComposed,
    complete: structurallyComposed && sourceFaithful,
    fidelity: { atoms: evaluation.atoms.metric, relations: evaluation.relations.metric },
    composition,
    typed_failures: [...new Set(typedFailures)],
    composer_failures: composition.failures,
  };
}

export function assembleGraphs(
  dataset: FrozenDataset,
  annotations: AnnotationArtifact,
  modelOutputs: Record<string, ModelOutputEnvelope[]>,
  evaluations: ModelEvaluationArtifact,
): AssemblyResults {
  const annotationByIdentity = new Map(annotations.annotations.map((annotation) => [identityKey(annotation), annotation]));
  const models: AssemblyResults["models"] = {};
  for (const [modelId, modelEvaluation] of Object.entries(evaluations.models)) {
    const outputs = new Map((modelOutputs[modelId] ?? []).map((output) => [identityKey(output), output]));
    const results: AssemblyAbilityResult[] = [];
    for (const record of dataset.records) {
      const output = outputs.get(identityKey(record));
      const evaluation = modelEvaluation.records.find((candidate) => candidate.identity === identityKey(record));
      if (output && evaluation) results.push(assembleOne(record, output, evaluation));
    }
    models[modelId] = { status: modelEvaluation.status, results };
  }
  const controlResults = dataset.records.map((record) => {
    const annotation = annotationByIdentity.get(identityKey(record));
    if (!annotation) throw new Error(`Assembly cannot find annotation ${identityKey(record)}`);
    const output: ModelOutputEnvelope = {
      contract_version: 1,
      run_id: dataset.run_id,
      faction_id: annotation.faction_id,
      ability_id: annotation.ability_id,
      source_hash: annotation.source_hash,
      atoms: annotation.atoms,
      relations: annotation.relations,
      diagnostics: annotation.diagnostics,
    };
    return assembleOne(record, output, annotationControlRow(record, annotation));
  });
  return { run_id: dataset.run_id, adapter: "round4a-composeAtoms-unchanged", models, adjudicated_control: { status: "complete", results: controlResults } };
}
