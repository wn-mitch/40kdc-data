import type { DecompositionRelation, EvaluatorAnnotation, FrozenDataset } from "./contracts.js";
import { identityKey, relationTypeFamily, spansOverlap, type AgreementModelId } from "./shared.js";
import type { AnnotationArtifact, AtomEvaluationRow, ModelAbilityEvaluation, ModelEvaluationArtifact, RelationEvaluationRow } from "./evaluation.js";

export type AgreementBucket = "unanimous" | "majority" | "divided" | "single-model-only" | "all-missed";

export interface AgreementRow {
  kind: "atom" | "relation";
  identity: string;
  reference_id: string;
  source_span: { start: number; end: number } | null;
  error_family: string;
  bucket: AgreementBucket;
  supporters: AgreementModelId[];
  competing_models: AgreementModelId[];
  correct: boolean;
}

export interface AgreementAnalysis {
  run_id: string;
  included_models: AgreementModelId[];
  atoms: { buckets: Record<AgreementBucket, { correct: number; total: number; rate: number | null }>; rows: AgreementRow[] };
  relations: { buckets: Record<AgreementBucket, { correct: number; total: number; rate: number | null }>; rows: AgreementRow[] };
  disagreement_associations: {
    atom_family: Record<string, Record<AgreementBucket, number>>;
    relation_type: Record<string, Record<AgreementBucket, number>>;
    required_error_families: Record<string, number>;
  };
}

const BUCKETS: readonly AgreementBucket[] = ["unanimous", "majority", "divided", "single-model-only", "all-missed"];
const MODELS: readonly AgreementModelId[] = ["luna", "silver-a", "silver-b", "silver-c"];

function emptyBucketCounts(): Record<AgreementBucket, { correct: number; total: number; rate: number | null }> {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, { correct: 0, total: 0, rate: null }])) as Record<AgreementBucket, { correct: number; total: number; rate: number | null }>;
}

function emptyAssociations(): Record<AgreementBucket, number> {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<AgreementBucket, number>;
}

function rowFor(model: ModelEvaluationArtifact, modelId: AgreementModelId, identity: string): ModelAbilityEvaluation | undefined {
  return model.models[modelId]?.records.find((candidate) => candidate.identity === identity);
}

function agreementBucket(supporterCount: number): AgreementBucket {
  if (supporterCount === 4) return "unanimous";
  if (supporterCount === 3) return "majority";
  if (supporterCount === 2) return "divided";
  if (supporterCount === 1) return "single-model-only";
  return "all-missed";
}

interface AtomProposal {
  model: AgreementModelId;
  row: AtomEvaluationRow;
}

interface RelationProposal {
  model: AgreementModelId;
  row: RelationEvaluationRow;
}

function atomClusters(modelEvaluation: ModelEvaluationArtifact, identity: string): AtomProposal[][] {
  const clusters: AtomProposal[][] = [];
  for (const model of MODELS) {
    for (const row of rowFor(modelEvaluation, model, identity)?.atoms.rows ?? []) {
      if (!row.grounded) continue;
      const cluster = clusters.find((candidate) => candidate.some((member) => member.row.family === row.family && spansOverlap(member.row.source_span, row.source_span)));
      if (cluster) cluster.push({ model, row });
      else clusters.push([{ model, row }]);
    }
  }
  return clusters;
}

function relationFamily(type: string): string {
  return relationTypeFamily(type as DecompositionRelation["type"]);
}

function relationClusters(modelEvaluation: ModelEvaluationArtifact, identity: string): RelationProposal[][] {
  const clusters: RelationProposal[][] = [];
  for (const model of MODELS) {
    for (const row of rowFor(modelEvaluation, model, identity)?.relations.rows ?? []) {
      if (!row.grounded) continue;
      const family = relationFamily(row.type);
      const cluster = clusters.find((candidate) => candidate.some((member) => {
        if (relationFamily(member.row.type) !== family) return false;
        if (member.row.source_span && row.source_span) return spansOverlap(member.row.source_span, row.source_span);
        return member.row.from_atom_id === row.from_atom_id && member.row.to_atom_id === row.to_atom_id;
      }));
      if (cluster) cluster.push({ model, row });
      else clusters.push([{ model, row }]);
    }
  }
  return clusters;
}

function atomAgreementRows(modelEvaluation: ModelEvaluationArtifact, identity: string, annotation: EvaluatorAnnotation): AgreementRow[] {
  const rows: AgreementRow[] = [];
  const matchedReferences = new Set<string>();
  for (const [index, cluster] of atomClusters(modelEvaluation, identity).entries()) {
    const supporters = [...new Set(cluster.map((member) => member.model))];
    const matched = cluster.map((member) => member.row.matched_annotation_atom_id).find((value): value is string => value !== null);
    if (matched) matchedReferences.add(matched);
    rows.push({
      kind: "atom",
      identity,
      reference_id: matched ?? `prediction:${identity}:atom:${index + 1}`,
      source_span: cluster[0]!.row.source_span,
      error_family: cluster[0]!.row.family,
      bucket: agreementBucket(supporters.length),
      supporters,
      competing_models: [],
      correct: matched !== undefined,
    });
  }
  for (const atom of annotation.atoms) {
    if (matchedReferences.has(atom.id)) continue;
    rows.push({ kind: "atom", identity, reference_id: atom.id, source_span: atom.source_span, error_family: atom.family, bucket: "all-missed", supporters: [], competing_models: [], correct: false });
  }
  return rows;
}

function relationAgreementRows(modelEvaluation: ModelEvaluationArtifact, identity: string, annotation: EvaluatorAnnotation): AgreementRow[] {
  const rows: AgreementRow[] = [];
  const matchedReferences = new Set<string>();
  for (const [index, cluster] of relationClusters(modelEvaluation, identity).entries()) {
    const supporters = [...new Set(cluster.map((member) => member.model))];
    const matched = cluster.map((member) => member.row.matched_annotation_relation_id).find((value): value is string => value !== null);
    if (matched) matchedReferences.add(matched);
    rows.push({
      kind: "relation",
      identity,
      reference_id: matched ?? `prediction:${identity}:relation:${index + 1}`,
      source_span: cluster[0]!.row.source_span,
      error_family: relationFamily(cluster[0]!.row.type),
      bucket: agreementBucket(supporters.length),
      supporters,
      competing_models: [],
      correct: matched !== undefined,
    });
  }
  for (const relation of annotation.relations.filter((candidate) => candidate.type !== "novel_relation")) {
    if (matchedReferences.has(relation.id)) continue;
    rows.push({ kind: "relation", identity, reference_id: relation.id, source_span: relation.source_span ?? null, error_family: relationFamily(relation.type), bucket: "all-missed", supporters: [], competing_models: [], correct: false });
  }
  return rows;
}

function finaliseBuckets(rows: readonly AgreementRow[]): Record<AgreementBucket, { correct: number; total: number; rate: number | null }> {
  const buckets = emptyBucketCounts();
  for (const row of rows) {
    const target = buckets[row.bucket];
    target.total += 1;
    if (row.correct) target.correct += 1;
  }
  for (const bucket of BUCKETS) {
    const target = buckets[bucket];
    target.rate = target.total === 0 ? null : target.correct / target.total;
  }
  return buckets;
}

export function analyseAgreement(dataset: FrozenDataset, annotations: AnnotationArtifact, modelEvaluation: ModelEvaluationArtifact): AgreementAnalysis {
  const annotationsByIdentity = new Map(annotations.annotations.map((annotation) => [identityKey(annotation), annotation]));
  const atomRows: AgreementRow[] = [];
  const relationRows: AgreementRow[] = [];
  for (const record of dataset.records) {
    const identity = identityKey(record);
    const annotation = annotationsByIdentity.get(identity);
    if (!annotation) throw new Error(`Agreement analysis cannot find annotation ${identity}`);
    atomRows.push(...atomAgreementRows(modelEvaluation, identity, annotation));
    relationRows.push(...relationAgreementRows(modelEvaluation, identity, annotation));
  }
  const atomFamily: Record<string, Record<AgreementBucket, number>> = {};
  const relationType: Record<string, Record<AgreementBucket, number>> = {};
  for (const row of atomRows) {
    const association = atomFamily[row.error_family] ?? emptyAssociations();
    association[row.bucket] += 1;
    atomFamily[row.error_family] = association;
  }
  for (const row of relationRows) {
    const association = relationType[row.error_family] ?? emptyAssociations();
    association[row.bucket] += 1;
    relationType[row.error_family] = association;
  }
  const requiredErrorFamilies: Record<string, number> = { ungrounded_guess: 0, novel_relation: 0, dsl_gap: 0, annotation_ambiguity: 0, model_output_invalid: 0 };
  for (const modelId of MODELS) {
    const model = modelEvaluation.models[modelId];
    if (!model || model.status === "invalid") requiredErrorFamilies.model_output_invalid += 1;
    for (const ability of model?.records ?? []) {
      requiredErrorFamilies.ungrounded_guess += ability.atoms.rows.filter((row) => row.failure === "UNGROUNDED_GUESS").length;
      requiredErrorFamilies.ungrounded_guess += ability.relations.rows.filter((row) => row.failure === "UNGROUNDED_GUESS").length;
      requiredErrorFamilies.novel_relation += ability.relations.rows.filter((row) => row.failure === "NOVEL_RELATION").length;
      requiredErrorFamilies.dsl_gap += ability.dsl_gaps.length;
      requiredErrorFamilies.annotation_ambiguity += ability.ambiguity.length;
    }
  }
  return {
    run_id: dataset.run_id,
    included_models: [...MODELS],
    atoms: { buckets: finaliseBuckets(atomRows), rows: atomRows },
    relations: { buckets: finaliseBuckets(relationRows), rows: relationRows },
    disagreement_associations: { atom_family: atomFamily, relation_type: relationType, required_error_families: requiredErrorFamilies },
  };
}
