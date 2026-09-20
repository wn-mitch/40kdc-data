export const SEMANTIC_FAMILIES = [
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

export type SemanticFamily = (typeof SEMANTIC_FAMILIES)[number];
export type GeneratorChannel =
  | "regex"
  | "closed-lexicon"
  | "morphological-alias"
  | "normalization-alias"
  | "registry-lookup"
  | "local-context"
  | "antecedent-scan";

export interface AbilityIdentity {
  faction_id: string;
  ability_id: string;
}

export interface ByteSpan {
  start: number;
  end: number;
}

export interface AtomEvidence {
  span: ByteSpan;
  channel: GeneratorChannel;
}

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

export interface AtomCandidate {
  id: string;
  family: SemanticFamily;
  rank: number;
  role: string;
  meaning: string;
  value: JsonValue;
  participant: string | null;
  arguments: Record<string, string | number | boolean | null>;
  evidence: AtomEvidence[];
}

export const RELATION_QUESTION_TYPES = [
  "antecedent",
  "attachment",
  "branch-kind",
  "choice-vs-disjunction",
  "replacement-vs-coexistence",
  "iterator-collection",
  "argument-filling",
  "duration-scope",
] as const;

export type RelationQuestionType = (typeof RELATION_QUESTION_TYPES)[number];
export type QuestionOptionKind = "candidate" | "none" | "unknown";

export interface QuestionOption {
  id: string;
  label: string;
  description: string;
  kind: QuestionOptionKind;
  atom_id?: string;
}

export interface RelationQuestion {
  id: string;
  identity: AbilityIdentity;
  type: RelationQuestionType;
  source_span: ByteSpan;
  source_context: string;
  prompt: string;
  subject_atom_ids: string[];
  options: QuestionOption[];
}

export type AnnotationState = "ADJUDICATED" | "DSL_GAP" | "ANNOTATION_AMBIGUITY";

export interface AnnotationAtom {
  id: string;
  family: SemanticFamily;
  role: string;
  meaning: string;
  value: JsonValue;
  participant: string | null;
  arguments: Record<string, string | number | boolean | null>;
  spans: ByteSpan[];
  required: boolean;
  state: AnnotationState;
  relationships: Record<string, string | string[]>;
}

export interface SemanticAnnotation {
  identity: AbilityIdentity;
  source_hash: string;
  atoms: AnnotationAtom[];
  required_atom_ids: string[];
  graph: {
    roots: string[];
    edges: Array<{ from: string; type: string; to: string }>;
  };
  review: {
    disposition: "accepted" | "accepted-with-ambiguity";
    disagreements: Array<{ atom_id: string; issue: string; resolution: AnnotationState }>;
  };
}

export const FAILURE_TAXONOMY = [
  "CANDIDATE_MISS",
  "JEV_MISSELECTION",
  "JEV_ABSTENTION",
  "LOCAL_CHOICES_INCOHERENT",
  "ATTACHMENT_ERROR",
  "BINDING_ERROR",
  "ASSEMBLER_ERROR",
  "DSL_GAP",
  "ANNOTATION_AMBIGUITY",
  "GOLD_DEFECT",
  "DIRECT_GENERATION_ERROR",
] as const;
export type FailureCode = (typeof FAILURE_TAXONOMY)[number];

export interface SourceFragment {
  label: "RAW_TEXT" | "WHEN" | "TARGET" | "EFFECT" | "RESTRICTIONS";
  start: number;
  end: number;
}

export interface FrozenAbility extends AbilityIdentity {
  name: string;
  primary_stratum: string;
  secondary_family_tags: string[];
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

export interface CandidateAbilityResult extends AbilityIdentity {
  source_hash: string;
  lattice: SpanLattice;
  candidates: AtomCandidate[];
  questions: RelationQuestion[];
}

export interface SpanBoundary {
  offset: number;
  reasons: string[];
}

export interface SpanLattice {
  source_byte_length: number;
  boundaries: SpanBoundary[];
  atomic_intervals: ByteSpan[];
  clause_spans: Array<ByteSpan & { label: string }>;
  metrics: {
    atomic_interval_count: number;
    total_span_count: number;
  };
}

export interface StageManifest {
  run_id: string;
  stage: "freeze" | "candidates" | "jev" | "direct" | "evaluate";
  created_at: string;
  input_hashes: Record<string, string>;
  bundle_hashes: Record<string, string>;
  output_hashes: Record<string, string>;
  model: string | null;
  prompt_hash: string | null;
  question_catalog_hash: string | null;
  request_hashes: string[];
}

export interface SemanticGraph {
  identity: AbilityIdentity;
  atoms: Array<Pick<AnnotationAtom, "id" | "family" | "role" | "meaning" | "value" | "participant" | "arguments" | "spans">>;
  edges: Array<{ from: string; type: string; to: string }>;
  roots: string[];
}
