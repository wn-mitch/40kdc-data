export const CANDIDATE_VERDICTS = [
  "exact-match",
  "related-variant",
  "different-family",
  "irrelevant",
  "ambiguous",
] as const;

export type CandidateVerdict = (typeof CANDIDATE_VERDICTS)[number];

export const SIDEWAYS_CHOICES = [
  "reroll-ones",
  "reroll-all",
  "modifier-add-one",
  "modifier-subtract-one",
  "critical-hit-threshold",
  "automatic-hit",
  "hit-threshold",
  "modifier-immunity",
  "roll-substitution",
  "other-hit",
  "irrelevant",
  "ambiguous",
] as const;

export type SidewaysChoice = (typeof SIDEWAYS_CHOICES)[number];

export type SidewaysReview = {
  proposal_version: string;
  proposed_choice: SidewaysChoice;
  proposal_reason: string;
  confirmed_choice: SidewaysChoice;
  confirmer: string;
  confirmed_at: string;
};

export type Fingerprint = {
  id: string;
  family: string;
  parameters: Record<string, string | number | boolean | null>;
};

export type CandidateRow = {
  candidate_id: string;
  queried_fingerprint_id: string;
  split: "train" | "validation" | "held-out";
  source_hash: string;
  fragment: string;
  span: { start: number; end: number };
  target_span: string;
  left_context: string;
  right_context: string;
  rubric_version: string;
  verdict: CandidateVerdict | null;
  batch_id: string | null;
  confirmer: string | null;
  confirmed_at: string | null;
  retrieval: Record<string, unknown>;
  sideways_review?: SidewaysReview;
  [key: string]: unknown;
};

export type CandidateSheet = {
  schema_version: number;
  manifest_hash: string;
  split: CandidateRow["split"];
  assisted: boolean;
  fingerprints: Fingerprint[];
  rows: CandidateRow[];
  [key: string]: unknown;
};

export type RecallOccurrence = {
  span: { start: number; end: number };
  text: string;
  fingerprint: {
    family: string;
    parameters: Record<string, string | number | boolean | null>;
  };
};

export type RecallRow = {
  faction_id: string;
  ability_id: string;
  source_hash: string;
  ability_type: string;
  source_kind: string;
  source_text: string;
  contains_hit_semantics: boolean | null;
  missed_occurrences: RecallOccurrence[];
  reviewer: string | null;
  reviewed_at: string | null;
  [key: string]: unknown;
};

export type RecallSheet = {
  schema_version: number;
  version: string;
  manifest_hash: string;
  audit_hash: string;
  population_by_stratum: Record<string, number>;
  sample_by_stratum: Record<string, number>;
  rows: RecallRow[];
  [key: string]: unknown;
};

export type ReviewDocument =
  | { kind: "candidate"; sheet: CandidateSheet }
  | { kind: "recall"; sheet: RecallSheet };

export type DirectFile = {
  name: string;
  exists: boolean;
  size: number | null;
  modifiedAt: string | null;
};
