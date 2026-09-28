/** Stamp, source-graph and model work-request shapes shared by the review tooling. */

export type JsonScalar = string | number | boolean | null;

export type StampSourceReference = {
  ability_version_id: number;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  synthetic?: false;
};

export type SyntheticStampReference = {
  synthetic: true;
  source_text: string;
  fragment: string;
  expected_match: boolean;
};

export type StampEvidenceReference = StampSourceReference | SyntheticStampReference;

export type StampSlotDefinition =
  | { kind: "enum"; values: Array<{ text: string; value: JsonScalar }> }
  | { kind: "integer"; min: number; max: number };

export type StampLiteralSegment = { id: string; literal: string };
export type StampSlotSegment = { id: string; slot: string };
export type StampLeafSegment = {
  id: string;
  leaf: {
    family_id: string;
    family_version: number;
    parameters?: Record<string, unknown>;
  };
};
export type StampSegment = StampLiteralSegment | StampSlotSegment | StampLeafSegment;
export type StampFragmentPattern = { fragment: string; segments: StampSegment[] };
export type StampGuard = { boundary: "fragment" | "word" } | { literal: string };
export type StampContainment = {
  other_family_id: string;
  other_family_version: number;
  direction: "contains" | "contained-by";
};
export type StampTemplate =
  | JsonScalar
  | { $bind: string }
  | { $case: string; cases: Array<{ value: JsonScalar; then: StampTemplate }> }
  | StampTemplate[]
  | { [key: string]: StampTemplate };

export type LeafStampVariant = {
  id: string;
  source_types: "any" | Array<string | null>;
  fragments: [StampFragmentPattern];
  slots: Record<string, StampSlotDefinition>;
  before: StampGuard[];
  after: StampGuard[];
  output: {
    family_id: string;
    family_version: number;
    parameters: StampTemplate;
  };
  allow_containment: StampContainment[];
};

export type CompositionStampVariant = {
  id: string;
  source_types: "any" | Array<string | null>;
  fragments: StampFragmentPattern[];
  slots: Record<string, StampSlotDefinition>;
  graph_template: StampTemplate;
  mechanics_template: StampTemplate | null;
};

export type StampDefinition =
  | {
      schema_version: 1;
      kind: "leaf";
      label: string;
      variants: LeafStampVariant[];
    }
  | {
      schema_version: 1;
      kind: "composition";
      label: string;
      variants: CompositionStampVariant[];
    };

export type SourceGraphNode = {
  id: string;
  kind: "leaf" | "participant" | "selector" | "usage" | "binding";
  parameters: Record<string, unknown>;
  evidence: {
    fragment: string;
    first_segment_id: string;
    last_segment_id: string;
    start_byte?: number;
    end_byte?: number;
    exact_text?: string;
  };
  family_id?: string;
  family_version?: number;
};

export type SourceGraphRelation = {
  id: string;
  type: string;
  from_node_id: string;
  to_node_id: string;
  evidence: {
    fragment: string;
    first_segment_id: string;
    last_segment_id: string;
    start_byte?: number;
    end_byte?: number;
    exact_text?: string;
  };
};

export type SourceGraph = {
  schema_version: 1;
  nodes: SourceGraphNode[];
  relations: SourceGraphRelation[];
  roots: string[];
};

export type StampPreviewOccurrence = StampSourceReference & {
  occurrence_id: string;
  variant_id: string;
  bindings: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: "eligible" | "already-satisfied" | "blocked";
  reason_code: string | null;
};

export type StampPreview = {
  stamp_id: string;
  revision: number;
  definition_hash: string;
  preview_hash: string;
  totals: { eligible: number; already_satisfied: number; blocked: number };
  parameter_combinations: Array<Record<string, unknown>>;
  examples: StampPreviewOccurrence[];
  counterexamples: StampEvidenceReference[];
  dependent_drafts: string[];
  next_cursor: string | null;
};

export type StampChallengeState =
  | "not-required"
  | "missing"
  | "self-challenge"
  | "incomplete"
  | "not-pinned"
  | "clear"
  | "objection"
  | "unresolved";

export type StampChallengeReview = {
  required: boolean;
  state: StampChallengeState;
  verdict: "clear" | "objection" | "unresolved" | null;
  run_id: number | null;
};

export type StampApprovalBlocker = {
  code:
    | "STATE"
    | "CHALLENGE_MISSING"
    | "CHALLENGE_SELF"
    | "CHALLENGE_INCOMPLETE"
    | "CHALLENGE_NOT_PINNED"
    | "CHALLENGE_OBJECTION"
    | "CHALLENGE_UNRESOLVED"
    | "HUMAN_SEED";
  message: string;
  status: number;
  next_action: "prepare-challenge" | "resolve-objection" | "seed-occurrence" | "none";
};

export type StampApprovalEligibility = {
  approvable: boolean;
  blocker: StampApprovalBlocker | null;
  challenge: StampChallengeReview;
};

export type WorkPurpose = "propose-rule" | "challenge-rule" | "verify-draft";

export type WorkRequest = {
  schema_version: 1;
  purpose: WorkPurpose;
  run_id: string;
  input_hash: string;
  instructions: string;
  response_schema: Record<string, unknown>;
  items: Array<Record<string, unknown> & { item_id: string; evidence_hash: string }>;
};

export type WorkFinding = {
  message: string;
  evidence: StampEvidenceReference;
};

export type ProposeRuleWorkResult = {
  stamp_id?: string;
  base_revision?: number;
  definition: StampDefinition;
  positives: StampEvidenceReference[];
  counterexamples: StampEvidenceReference[];
  closest_stamp_ids: string[];
  exact_mismatch: string;
  question: string;
  affected_member_ids: string[];
};

export type ChallengeRuleWorkResult = {
  verdict: "clear" | "objection" | "unresolved";
  findings: WorkFinding[];
};

export type VerifyDraftWorkResult = {
  faithful: boolean;
  severity: "ok" | "minor" | "wrong";
  findings: WorkFinding[];
};

export type WorkResult = ProposeRuleWorkResult | ChallengeRuleWorkResult | VerifyDraftWorkResult;

export type WorkResponse = {
  schema_version: 1;
  run_id: string;
  input_hash: string;
  model: string;
  model_version: string;
  prompt_version: string;
  items: Array<{ item_id: string; evidence_hash: string; result: WorkResult }>;
  latency_ms?: number;
  cost_usd?: number;
};
