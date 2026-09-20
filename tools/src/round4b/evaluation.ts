import { validateGroundedModelOutput } from "./prompt.js";
import {
  ATOM_FAMILIES,
  RELATION_TYPES,
  type DecompositionAtom,
  type EvaluatorAnnotation,
  type FrozenDataset,
  type ModelOutputEnvelope,
} from "./contracts.js";
import {
  OPTIONAL_MODEL_IDS,
  atomSemanticMatch,
  countMetric,
  identityKey,
  parseModelArtifact,
  recordMap,
  relationSemanticMatch,
  relationFamily,
  spansOverlap,
  type CountMetric,
  type ModelOutputArtifact,
  type ModelId,
} from "./shared.js";

export interface AnnotationArtifact {
  run_id: string;
  annotations: EvaluatorAnnotation[];
  review?: { status?: string; reviewed_count?: number };
}

export interface AtomEvaluationRow {
  identity: string;
  model_id: string;
  predicted_atom_id: string;
  family: string;
  normalized_meaning: string;
  source_span: { start: number; end: number };
  grounded: boolean;
  matched_annotation_atom_id: string | null;
  failure: "UNGROUNDED_GUESS" | "FALSE_POSITIVE" | null;
}

export interface RelationEvaluationRow {
  identity: string;
  model_id: string;
  predicted_relation_id: string;
  type: string;
  from_atom_id: string;
  to_atom_id: string;
  source_span: { start: number; end: number } | null;
  grounded: boolean;
  matched_annotation_relation_id: string | null;
  failure: "UNGROUNDED_GUESS" | "NOVEL_RELATION" | "FALSE_POSITIVE" | null;
}

export interface ModelAbilityEvaluation {
  identity: string;
  model_id: string;
  output_status: "complete" | "missing" | "invalid";
  validation_errors: string[];
  atoms: {
    metric: CountMetric;
    by_family: Record<string, CountMetric>;
    rows: AtomEvaluationRow[];
    matched_annotation_atom_ids: string[];
    missed_annotation_atom_ids: string[];
  };
  relations: {
    metric: CountMetric;
    by_type: Record<string, CountMetric>;
    single_choice_accuracy: Record<string, { correct: number; required: number; accuracy: number | null }>;
    rows: RelationEvaluationRow[];
    matched_annotation_relation_ids: string[];
    missed_annotation_relation_ids: string[];
  };
  novelty: { atoms: string[]; relations: string[]; diagnostics: number };
  dsl_gaps: string[];
  ambiguity: string[];
  annotation_disagreements: string[];
}

export interface ModelEvaluation {
  run_id: string;
  model_id: string;
  actual_agent: string | null;
  status: "complete" | "not_run" | "invalid";
  artifact_errors: string[];
  request_hashes: string[];
  latency_ms: number | null;
  cost_usd: number | null;
  atoms: { overall: CountMetric; by_family: Record<string, CountMetric> };
  relations: {
    overall: CountMetric;
    by_type: Record<string, CountMetric>;
    single_choice_accuracy: Record<string, { correct: number; required: number; accuracy: number | null }>;
  };
  novelty: { atoms: number; relations: number; diagnostics: number };
  dsl_gaps: number;
  ambiguity: number;
  annotation_disagreements: number;
  records: ModelAbilityEvaluation[];
}

export interface ModelEvaluationArtifact {
  run_id: string;
  prompt_hash: string;
  models: Record<string, ModelEvaluation>;
  annotation_validation: { status: "complete"; errors: string[] };
}

interface GroundedOutput {
  output: ModelOutputEnvelope;
  errors: string[];
  atomGrounded: Set<string>;
  relationGrounded: Set<string>;
}

const CHOICE_KEYS = [
  "antecedent",
  "argument-filling",
  "attachment",
  "branch-kind",
  "choice-vs-disjunction",
  "duration-scope",
  "iterator-collection",
  "replacement-vs-coexistence",
  "other",
] as const;

function structuralOutputErrors(output: unknown): string[] {
  const errors: string[] = [];
  if (output === null || typeof output !== "object" || Array.isArray(output)) return ["model record is not an object"];
  const record = output as Record<string, unknown>;
  for (const field of ["run_id", "faction_id", "ability_id", "source_hash"]) {
    if (typeof record[field] !== "string" || record[field].length === 0) errors.push(`model record has invalid ${field}`);
  }
  if (record.contract_version !== 1) errors.push("model record has unsupported contract_version");
  for (const field of ["atoms", "relations", "diagnostics"]) if (!Array.isArray(record[field])) errors.push(`model record has no ${field} array`);
  return errors;
}

function safeGrounding(record: FrozenDataset["records"][number], output: ModelOutputEnvelope): GroundedOutput {
  const errors = validateGroundedModelOutput(record, output);
  const atomGrounded = new Set<string>();
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const atom of output.atoms) {
    if (seenIds.has(atom.id)) duplicateIds.add(atom.id);
    seenIds.add(atom.id);
  }
  for (const atom of output.atoms) {
    const singleton: ModelOutputEnvelope = { ...output, atoms: [atom], relations: [], diagnostics: [] };
    if (!duplicateIds.has(atom.id) && validateGroundedModelOutput(record, singleton).length === 0) atomGrounded.add(atom.id);
  }
  const relationGrounded = new Set<string>();
  for (const relation of output.relations) {
    if (!atomGrounded.has(relation.from_atom_id) || !atomGrounded.has(relation.to_atom_id)) continue;
    const relationOnly: ModelOutputEnvelope = { ...output, relations: [relation] };
    const relationErrors = validateGroundedModelOutput(record, relationOnly);
    if (!relationErrors.some((error) => error.includes(`relation ${relation.id}`))) relationGrounded.add(relation.id);
  }
  return { output, errors, atomGrounded, relationGrounded };
}

function countBy<T>(items: readonly T[], selector: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function atomFailure(grounded: boolean, matched: boolean): AtomEvaluationRow["failure"] {
  if (!grounded) return "UNGROUNDED_GUESS";
  return matched ? null : "FALSE_POSITIVE";
}

function relationFailure(grounded: boolean, type: string, matched: boolean): RelationEvaluationRow["failure"] {
  if (!grounded) return "UNGROUNDED_GUESS";
  if (type === "novel_relation") return "NOVEL_RELATION";
  return matched ? null : "FALSE_POSITIVE";
}

function metricTable(keys: readonly string[], predicted: readonly string[], required: readonly string[], correct: readonly string[]): Record<string, CountMetric> {
  const predictedCounts = countBy(predicted, (value) => value);
  const requiredCounts = countBy(required, (value) => value);
  const correctCounts = countBy(correct, (value) => value);
  return Object.fromEntries(keys.map((key) => [key, countMetric(correctCounts[key] ?? 0, predictedCounts[key] ?? 0, requiredCounts[key] ?? 0)]));
}

function annotationAsOutput(annotation: EvaluatorAnnotation, runId: string): ModelOutputEnvelope {
  return {
    contract_version: 1,
    run_id: runId,
    faction_id: annotation.faction_id,
    ability_id: annotation.ability_id,
    source_hash: annotation.source_hash,
    atoms: annotation.atoms,
    relations: annotation.relations,
    diagnostics: annotation.diagnostics,
  };
}

export function validateAnnotations(dataset: FrozenDataset, artifact: AnnotationArtifact): void {
  if (artifact.run_id !== dataset.run_id) throw new Error("Evaluator annotation run_id does not match frozen dataset");
  const records = recordMap(dataset.records);
  const seen = new Set<string>();
  for (const annotation of artifact.annotations) {
    const identity = identityKey(annotation);
    if (seen.has(identity)) throw new Error(`Evaluator annotations duplicate ${identity}`);
    seen.add(identity);
    const record = records.get(identity);
    if (!record) throw new Error(`Evaluator annotations contain unfrozen identity ${identity}`);
    const errors = validateGroundedModelOutput(record, annotationAsOutput(annotation, artifact.run_id));
    if (errors.length) throw new Error(`Evaluator annotation ${identity} is invalid: ${errors.join("; ")}`);
  }
  for (const record of dataset.records) {
    if (!seen.has(identityKey(record))) throw new Error(`Evaluator annotations omit frozen identity ${identityKey(record)}`);
  }
}

function evaluateAbility(
  modelId: string,
  record: FrozenDataset["records"][number],
  annotation: EvaluatorAnnotation,
  grounded: GroundedOutput | undefined,
  modelErrors: string[],
): ModelAbilityEvaluation {
  const identity = identityKey(record);
  const annotationAtoms = annotation.atoms;
  const annotationRelations = annotation.relations.filter((relation) => relation.type !== "novel_relation");
  const output = grounded?.output;
  const validAtoms = output?.atoms.filter((atom) => grounded?.atomGrounded.has(atom.id)) ?? [];
  const matchedOutputAtoms = new Set<string>();
  const matchedAnnotationAtoms = new Set<string>();
  const atomMatches = new Map<string, string>();
  for (const annotationAtom of annotationAtoms) {
    const candidate = validAtoms
      .filter((atom) => !matchedOutputAtoms.has(atom.id) && atomSemanticMatch(atom, annotationAtom))
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (!candidate) continue;
    matchedOutputAtoms.add(candidate.id);
    matchedAnnotationAtoms.add(annotationAtom.id);
    atomMatches.set(candidate.id, annotationAtom.id);
  }
  const atomRows: AtomEvaluationRow[] = (output?.atoms ?? []).map((atom) => {
    const isGrounded = grounded?.atomGrounded.has(atom.id) ?? false;
    const matched = atomMatches.has(atom.id);
    return {
      identity,
      model_id: modelId,
      predicted_atom_id: atom.id,
      family: atom.family,
      normalized_meaning: atom.normalized_meaning,
      source_span: atom.source_span,
      grounded: isGrounded,
      matched_annotation_atom_id: atomMatches.get(atom.id) ?? null,
      failure: atomFailure(isGrounded, matched),
    };
  });
  const atomMetric = countMetric(matchedOutputAtoms.size, output?.atoms.length ?? 0, annotationAtoms.length);
  const atomFamily = metricTable(
    ATOM_FAMILIES,
    (output?.atoms ?? []).map((atom) => atom.family),
    annotationAtoms.map((atom) => atom.family),
    (output?.atoms ?? []).filter((atom) => atomMatches.has(atom.id)).map((atom) => atom.family),
  );

  const annotationAtomMap = new Map(annotationAtoms.map((atom) => [atom.id, atom]));
  const outputAtomMap = new Map((output?.atoms ?? []).map((atom) => [atom.id, atom]));
  const validRelations = (output?.relations ?? []).filter((relation) => grounded?.relationGrounded.has(relation.id) && relation.type !== "novel_relation");
  const matchedOutputRelations = new Set<string>();
  const matchedAnnotationRelations = new Set<string>();
  const relationMatches = new Map<string, string>();
  for (const annotationRelation of annotationRelations) {
    const candidate = validRelations
      .filter((relation) => !matchedOutputRelations.has(relation.id) && relationSemanticMatch(relation, annotationRelation, outputAtomMap, annotationAtomMap))
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (!candidate) continue;
    matchedOutputRelations.add(candidate.id);
    matchedAnnotationRelations.add(annotationRelation.id);
    relationMatches.set(candidate.id, annotationRelation.id);
  }
  const relationRows: RelationEvaluationRow[] = (output?.relations ?? []).map((relation) => {
    const isGrounded = grounded?.relationGrounded.has(relation.id) ?? false;
    return {
      identity,
      model_id: modelId,
      predicted_relation_id: relation.id,
      type: relation.type,
      from_atom_id: relation.from_atom_id,
      to_atom_id: relation.to_atom_id,
      source_span: relation.source_span ?? null,
      grounded: isGrounded,
      matched_annotation_relation_id: relationMatches.get(relation.id) ?? null,
      failure: relationFailure(isGrounded, relation.type, relationMatches.has(relation.id)),
    };
  });
  const relationMetric = countMetric(matchedOutputRelations.size, output?.relations.filter((relation) => relation.type !== "novel_relation").length ?? 0, annotationRelations.length);
  const relationType = metricTable(
    RELATION_TYPES,
    (output?.relations ?? []).filter((relation) => relation.type !== "novel_relation").map((relation) => relation.type),
    annotationRelations.map((relation) => relation.type),
    (output?.relations ?? []).filter((relation) => relationMatches.has(relation.id)).map((relation) => relation.type),
  );
  const requiredChoices = annotationRelations.map(relationFamily);
  const correctChoices = annotationRelations
    .filter((relation) => matchedAnnotationRelations.has(relation.id))
    .map(relationFamily);
  const choiceRequired = countBy(requiredChoices, (value) => value);
  const choiceCorrect = countBy(correctChoices, (value) => value);
  const singleChoiceAccuracy = Object.fromEntries(CHOICE_KEYS.map((key) => {
    const correct = choiceCorrect[key] ?? 0;
    const required = choiceRequired[key] ?? 0;
    return [key, { correct, required, accuracy: required === 0 ? null : correct / required }];
  }));

  const diagnostics = output?.diagnostics ?? [];
  const annotationDisagreements = annotation.state === "ANNOTATION_AMBIGUITY" ? ["annotation-state"] : [];
  let outputStatus: ModelAbilityEvaluation["output_status"];
  if (!output) outputStatus = "missing";
  else if (modelErrors.length > 0 || (grounded?.errors.length ?? 0) > 0) outputStatus = "invalid";
  else outputStatus = "complete";
  return {
    identity,
    model_id: modelId,
    output_status: outputStatus,
    validation_errors: [...modelErrors, ...(grounded?.errors ?? [])],
    atoms: {
      metric: atomMetric,
      by_family: atomFamily,
      rows: atomRows,
      matched_annotation_atom_ids: [...matchedAnnotationAtoms].sort(),
      missed_annotation_atom_ids: annotationAtoms.filter((atom) => !matchedAnnotationAtoms.has(atom.id)).map((atom) => atom.id),
    },
    relations: {
      metric: relationMetric,
      by_type: relationType,
      single_choice_accuracy: singleChoiceAccuracy,
      rows: relationRows,
      matched_annotation_relation_ids: [...matchedAnnotationRelations].sort(),
      missed_annotation_relation_ids: annotationRelations.filter((relation) => !matchedAnnotationRelations.has(relation.id)).map((relation) => relation.id),
    },
    novelty: {
      atoms: (output?.atoms ?? []).filter((atom) => !annotationAtoms.some((reference) => atom.family === reference.family && spansOverlap(atom.source_span, reference.source_span))).map((atom) => atom.id),
      relations: (output?.relations ?? []).filter((relation) => relation.type === "novel_relation").map((relation) => relation.id),
      diagnostics: diagnostics.filter((diagnostic) => diagnostic.kind === "novel_relation").length,
    },
    dsl_gaps: annotation.state === "DSL_GAP" ? annotationAtoms.map((atom) => atom.id) : [],
    ambiguity: annotation.state === "ANNOTATION_AMBIGUITY" ? annotationAtoms.map((atom) => atom.id) : [],
    annotation_disagreements: annotationDisagreements,
  };
}

function aggregateModel(
  runId: string,
  modelId: string,
  artifact: ModelOutputArtifact | undefined,
  artifactErrors: string[],
  rows: ModelAbilityEvaluation[],
): ModelEvaluation {
  const atomRows = rows.flatMap((row) => row.atoms.rows);
  const relationRows = rows.flatMap((row) => row.relations.rows);
  const atomRequired = rows.reduce((total, row) => total + row.atoms.metric.required, 0);
  const relationRequired = rows.reduce((total, row) => total + row.relations.metric.required, 0);
  const atomCorrect = atomRows.filter((row) => row.matched_annotation_atom_id !== null).length;
  const relationCorrect = relationRows.filter((row) => row.matched_annotation_relation_id !== null).length;
  const atomByFamily = Object.fromEntries(ATOM_FAMILIES.map((family) => {
    const predicted = atomRows.filter((row) => row.family === family);
    const required = rows.reduce((total, row) => total + row.atoms.by_family[family]!.required, 0);
    return [family, countMetric(predicted.filter((row) => row.matched_annotation_atom_id !== null).length, predicted.length, required)];
  }));
  const relationByType = Object.fromEntries(RELATION_TYPES.map((type) => {
    const predicted = relationRows.filter((row) => row.type === type);
    const required = rows.reduce((total, row) => total + row.relations.by_type[type]!.required, 0);
    return [type, countMetric(predicted.filter((row) => row.matched_annotation_relation_id !== null).length, predicted.length, required)];
  }));
  const singleChoiceAccuracy = Object.fromEntries(CHOICE_KEYS.map((key) => {
    const correct = rows.reduce((total, row) => total + row.relations.single_choice_accuracy[key]!.correct, 0);
    const required = rows.reduce((total, row) => total + row.relations.single_choice_accuracy[key]!.required, 0);
    return [key, { correct, required, accuracy: required ? correct / required : null }];
  }));
  const allErrors = rows.flatMap((row) => row.validation_errors);
  let status: ModelEvaluation["status"];
  if (!artifact) status = "not_run";
  else if (artifactErrors.length > 0 || allErrors.length > 0) status = "invalid";
  else status = "complete";
  return {
    run_id: runId,
    model_id: modelId,
    actual_agent: artifact?.actual_agent ?? null,
    status,
    artifact_errors: artifactErrors,
    request_hashes: artifact?.request_hashes ?? [],
    latency_ms: artifact?.latency_ms ?? artifact?.execution?.latency_ms ?? null,
    cost_usd: artifact?.cost_usd ?? artifact?.execution?.cost_usd ?? null,
    atoms: { overall: countMetric(atomCorrect, atomRows.length, atomRequired), by_family: atomByFamily },
    relations: { overall: countMetric(relationCorrect, relationRows.filter((row) => row.type !== "novel_relation").length, relationRequired), by_type: relationByType, single_choice_accuracy: singleChoiceAccuracy },
    novelty: {
      atoms: rows.reduce((total, row) => total + row.novelty.atoms.length, 0),
      relations: rows.reduce((total, row) => total + row.novelty.relations.length, 0),
      diagnostics: rows.reduce((total, row) => total + row.novelty.diagnostics, 0),
    },
    dsl_gaps: rows.reduce((total, row) => total + row.dsl_gaps.length, 0),
    ambiguity: rows.reduce((total, row) => total + row.ambiguity.length, 0),
    annotation_disagreements: rows.reduce((total, row) => total + row.annotation_disagreements.length, 0),
    records: rows,
  };
}

export function evaluateModelArtifacts(
  dataset: FrozenDataset,
  annotations: AnnotationArtifact,
  promptHash: string,
  artifacts: Record<string, unknown>,
  modelIds: readonly ModelId[],
): ModelEvaluationArtifact {
  validateAnnotations(dataset, annotations);
  const records = recordMap(dataset.records);
  const annotationByIdentity = recordMap(annotations.annotations);
  const models: Record<string, ModelEvaluation> = {};
  for (const modelId of modelIds) {
    const parsed = artifacts[modelId] === undefined ? undefined : parseModelArtifact(artifacts[modelId]);
    const artifact = parsed?.value;
    const artifactErrors = [...(parsed?.errors ?? [])];
    if (!artifact && !parsed && !OPTIONAL_MODEL_IDS.includes(modelId as "sol-ceiling")) artifactErrors.push(`required model artifact ${modelId} is absent`);
    if (artifact) {
      if (artifact.run_id !== dataset.run_id) artifactErrors.push("model artifact run_id does not match frozen dataset");
      if (artifact.model_id !== modelId) artifactErrors.push(`model artifact model_id is ${artifact.model_id}, expected ${modelId}`);
      if (artifact.prompt_hash !== promptHash) artifactErrors.push("model artifact prompt_hash does not match frozen prompt");
    }
    const byIdentity = new Map<string, GroundedOutput>();
    if (artifact) {
      for (const candidate of artifact.records) {
        const structural = structuralOutputErrors(candidate);
        if (structural.length) {
          artifactErrors.push(...structural);
          continue;
        }
        const identity = identityKey(candidate);
        if (byIdentity.has(identity)) {
          artifactErrors.push(`model artifact duplicates identity ${identity}`);
          continue;
        }
        const record = records.get(identity);
        if (!record) {
          artifactErrors.push(`model artifact contains unfrozen identity ${identity}`);
          continue;
        }
        byIdentity.set(identity, safeGrounding(record, candidate));
      }
    }
    const rows = dataset.records.map((record) => {
      const identity = identityKey(record);
      const annotation = annotationByIdentity.get(identity);
      if (!annotation) throw new Error(`Evaluator annotations omit ${identity}`);
      const output = byIdentity.get(identity);
      let rowErrors: string[];
      if (output) rowErrors = [];
      else if (artifact) rowErrors = [`model artifact omitted frozen identity ${identity}`];
      else rowErrors = artifactErrors;
      return evaluateAbility(modelId, record, annotation, output, rowErrors);
    });
    models[modelId] = aggregateModel(dataset.run_id, modelId, artifact, artifactErrors, rows);
  }
  return { run_id: dataset.run_id, prompt_hash: promptHash, models, annotation_validation: { status: "complete", errors: [] } };
}
