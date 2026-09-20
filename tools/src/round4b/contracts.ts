export interface AbilityIdentity {
  faction_id: string;
  ability_id: string;
}

export interface ByteSpan {
  start: number;
  end: number;
}

export const REGEX_STRATA = [
  "dice-random",
  "attack-combat-modification",
  "condition-history-anaphora",
  "menu-choice-resource",
  "iteration-duration-spatial",
] as const;

export const SEMANTIC_STRATA = [...REGEX_STRATA, "random-corpus-draw"] as const;

export type SemanticStratum = (typeof SEMANTIC_STRATA)[number];

export type SelectionMethod = "stratum-sha256" | "random-sha256";

export interface CohortSelection {
  assigned_stratum: SemanticStratum;
  method: SelectionMethod;
  seed: string;
  ordering_hash: string;
  rank: number;
}

export interface SourceFragment {
  label: "RAW_TEXT" | "WHEN" | "TARGET" | "EFFECT" | "RESTRICTIONS";
  start: number;
  end: number;
}

export interface FrozenAbility extends AbilityIdentity {
  name: string;
  selection: CohortSelection;
  card: {
    source_kind: "raw-text" | "structured-stratagem";
    fields: SourceFragment["label"][];
  };
  source_locator: string;
  source_text: string;
  source_bytes_base64: string;
  source_byte_length: number;
  source_hash: string;
  source_digest: string;
  source_provenance: {
    repository: "40kdc-abilities";
    file: string;
    record_pointer: string;
  };
  source_fragments: SourceFragment[];
}

export interface FrozenDataset {
  run_id: string;
  contract_version: 1;
  frozen_at: string;
  cohort_hash: string;
  records: FrozenAbility[];
}

export const ATOM_FAMILIES = [
  "participant-reference",
  "property",
  "operation",
  "magnitude-expression",
  "event",
  "predicate",
  "duration",
  "usage-frequency",
  "spatial-relation",
  "resource-action",
  "dice-operation",
  "iteration",
  "choice",
  "sequence",
  "rule-reference",
] as const;

export type AtomFamily = (typeof ATOM_FAMILIES)[number];

export interface DecompositionAtom {
  id: string;
  family: AtomFamily;
  normalized_meaning: string;
  source_span: ByteSpan;
  source_text: string;
  literal?: string | number | boolean | null;
  unit?: string;
  dice?: string;
  registry_key?: string;
  participant?: string;
}

export const RELATION_TYPES = [
  "modifies",
  "targets",
  "binds-to",
  "antecedent-of",
  "governs",
  "attaches-to",
  "iterates-over",
  "choice-option-of",
  "precedes",
  "replaces",
  "condition-of",
  "duration-of",
  "consumes-resource",
  "argument-filling",
  "branch-kind",
  "choice-vs-disjunction",
  "iterator-collection",
  "replacement-vs-coexistence",
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

interface RelationEndpoints {
  id: string;
  from_atom_id: string;
  to_atom_id: string;
  source_span?: ByteSpan;
}

export type DecompositionRelation =
  | (RelationEndpoints & { type: RelationType; novel_relation?: never })
  | (RelationEndpoints & { type: "novel_relation"; novel_relation: string });

export type DiagnosticKind = "unresolved_atom" | "unresolved_relation" | "novel_relation";

export interface DecompositionDiagnostic {
  kind: DiagnosticKind;
  message: string;
  source_span?: ByteSpan;
  atom_ids?: string[];
  relation_id?: string;
  novel_relation?: string;
}

export interface ModelOutputEnvelope extends AbilityIdentity {
  contract_version: 1;
  run_id: string;
  source_hash: string;
  atoms: DecompositionAtom[];
  relations: DecompositionRelation[];
  diagnostics: DecompositionDiagnostic[];
}

export type AnnotationState = "ADJUDICATED" | "DSL_GAP" | "ANNOTATION_AMBIGUITY";

export interface EvaluatorAnnotation extends AbilityIdentity {
  source_hash: string;
  state: AnnotationState;
  atoms: DecompositionAtom[];
  relations: DecompositionRelation[];
  diagnostics: DecompositionDiagnostic[];
  notes?: string;
}

export type Round4BStage = "freeze" | "annotations" | "model" | "evaluate" | "report";

export interface StageManifest {
  stage: Round4BStage;
  created_at: string;
  input_hashes: Record<string, string>;
  output_hashes: Record<string, string>;
  prompt_hash: string | null;
  model: string | null;
}

export interface RunManifest {
  run_id: string;
  contract_version: 1;
  frozen_at: string;
  cohort_hash: string;
  dataset_hash: string;
  model_input_hash: string;
  annotation_hash?: string;
  stages: StageManifest[];
  manifest_hash?: string;
}

export interface SourceOnlyModelRecord extends AbilityIdentity {
  name: string;
  selection: CohortSelection;
  source_text: string;
  source_byte_length: number;
  source_hash: string;
  source_fragments: SourceFragment[];
}

export interface SourceOnlyModelInput {
  contract_version: 1;
  run_id: string;
  cohort_hash: string;
  output_schema: "round4b-decomposition-v1";
  records: SourceOnlyModelRecord[];
}
