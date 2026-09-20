import Ajv from "ajv";

import type { CandidateSheet, RecallSheet } from "./types";

const candidateSheetSchema = {
  type: "object",
  required: ["schema_version", "manifest_hash", "split", "assisted", "fingerprints", "rows"],
  properties: {
    schema_version: { type: "number" },
    manifest_hash: { type: "string" },
    split: { type: "string", enum: ["train", "validation", "held-out"] },
    assisted: { type: "boolean" },
    fingerprints: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "family", "parameters"],
        properties: {
          id: { type: "string" },
          family: { type: "string" },
          parameters: { type: "object" },
        },
      },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        required: [
          "candidate_id",
          "queried_fingerprint_id",
          "split",
          "source_hash",
          "fragment",
          "span",
          "target_span",
          "left_context",
          "right_context",
          "rubric_version",
          "verdict",
          "batch_id",
          "confirmer",
          "confirmed_at",
          "retrieval",
        ],
        properties: {
          candidate_id: { type: "string" },
          queried_fingerprint_id: { type: "string" },
          split: { type: "string", enum: ["train", "validation", "held-out"] },
          source_hash: { type: "string" },
          fragment: { type: "string" },
          span: {
            type: "object",
            required: ["start", "end"],
            properties: { start: { type: "number" }, end: { type: "number" } },
          },
          target_span: { type: "string" },
          left_context: { type: "string" },
          right_context: { type: "string" },
          rubric_version: { type: "string" },
          verdict: {
            anyOf: [
              { type: "string", enum: ["exact-match", "related-variant", "different-family", "irrelevant", "ambiguous"] },
              { type: "null" },
            ],
          },
          batch_id: { anyOf: [{ type: "string" }, { type: "null" }] },
          confirmer: { anyOf: [{ type: "string" }, { type: "null" }] },
          confirmed_at: { anyOf: [{ type: "string" }, { type: "null" }] },
          retrieval: { type: "object" },
          sideways_review: {
            type: "object",
            required: [
              "proposal_version",
              "proposed_choice",
              "proposal_reason",
              "confirmed_choice",
              "confirmer",
              "confirmed_at",
            ],
            properties: {
              proposal_version: { type: "string" },
              proposed_choice: {
                type: "string",
                enum: [
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
                ],
              },
              proposal_reason: { type: "string" },
              confirmed_choice: {
                type: "string",
                enum: [
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
                ],
              },
              confirmer: { type: "string" },
              confirmed_at: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

const recallSheetSchema = {
  type: "object",
  required: [
    "schema_version",
    "version",
    "manifest_hash",
    "audit_hash",
    "population_by_stratum",
    "sample_by_stratum",
    "rows",
  ],
  properties: {
    schema_version: { type: "number" },
    version: { type: "string" },
    manifest_hash: { type: "string" },
    audit_hash: { type: "string" },
    population_by_stratum: { type: "object", additionalProperties: { type: "number" } },
    sample_by_stratum: { type: "object", additionalProperties: { type: "number" } },
    rows: {
      type: "array",
      items: {
        type: "object",
        required: [
          "faction_id",
          "ability_id",
          "source_hash",
          "ability_type",
          "source_kind",
          "source_text",
          "contains_hit_semantics",
          "missed_occurrences",
          "reviewer",
          "reviewed_at",
        ],
        properties: {
          faction_id: { type: "string" },
          ability_id: { type: "string" },
          source_hash: { type: "string" },
          ability_type: { type: "string" },
          source_kind: { type: "string" },
          source_text: { type: "string" },
          contains_hit_semantics: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          missed_occurrences: {
            type: "array",
            items: {
              type: "object",
              required: ["span", "text", "fingerprint"],
              properties: {
                span: {
                  type: "object",
                  required: ["start", "end"],
                  properties: { start: { type: "number" }, end: { type: "number" } },
                },
                text: { type: "string" },
                fingerprint: {
                  type: "object",
                  required: ["family", "parameters"],
                  properties: {
                    family: { type: "string" },
                    parameters: { type: "object" },
                  },
                },
              },
            },
          },
          reviewer: { anyOf: [{ type: "string" }, { type: "null" }] },
          reviewed_at: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCandidate = ajv.compile(candidateSheetSchema);
const validateRecall = ajv.compile(recallSheetSchema);

export function validateCandidateSheet(value: unknown): value is CandidateSheet {
  return validateCandidate(value);
}

export function validateRecallSheet(value: unknown): value is RecallSheet {
  return validateRecall(value);
}

export function validationMessage(): string {
  return ajv.errorsText(validateCandidate.errors ?? validateRecall.errors, { separator: "; " });
}
