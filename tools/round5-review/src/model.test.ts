import { describe, expect, it } from "vitest";

import {
  addRecallOccurrence,
  completeRecall,
  completion,
  hitHintSegments,
  hitCueRanges,
  judgeCandidateSideways,
  judgeCandidate,
  nextUnresolved,
  moveVimCursor,
  parseReviewDocument,
  proposeSidewaysMechanic,
  utf8Selection,
} from "./model";
import type { CandidateSheet, RecallSheet } from "./types";

function candidateSheet(): CandidateSheet {
  return {
    schema_version: 2,
    manifest_hash: "manifest",
    split: "train",
    assisted: false,
    fingerprints: [{ id: "sf-one", family: "reroll", parameters: { roll: "hit" } }],
    rows: [
      {
        candidate_id: "cand-one",
        queried_fingerprint_id: "sf-one",
        split: "train",
        source_hash: "source",
        fragment: "RAW_TEXT",
        span: { start: 0, end: 8 },
        target_span: "Hit roll",
        left_context: "Each ",
        right_context: " succeeds.",
        rubric_version: "rubric-v2",
        verdict: null,
        batch_id: null,
        confirmer: null,
        confirmed_at: null,
        retrieval: { retrieval_method: "manual", version: "features-v2" },
      },
    ],
  };
}

function recallSheet(): RecallSheet {
  return {
    schema_version: 2,
    version: "recall-v2",
    manifest_hash: "manifest",
    audit_hash: "audit",
    population_by_stratum: { "unit|pdf": 10 },
    sample_by_stratum: { "unit|pdf": 1 },
    rows: [
      {
        faction_id: "fixture-faction",
        ability_id: "fixture-ability",
        source_hash: "source",
        ability_type: "unit",
        source_kind: "pdf",
        source_text: "Mōdel re-rolls a Hit roll.",
        contains_hit_semantics: null,
        missed_occurrences: [],
        reviewer: null,
        reviewed_at: null,
      },
    ],
  };
}

describe("review document model", () => {
  it("parses both frozen review sheet variants", () => {
    expect(parseReviewDocument(candidateSheet()).kind).toBe("candidate");
    expect(parseReviewDocument(recallSheet()).kind).toBe("recall");
    expect(() => parseReviewDocument({ rows: [] })).toThrow(/not a valid Round 5/);
  });

  it("records a complete candidate judgment without changing source evidence", () => {
    const source = candidateSheet();
    const judged = judgeCandidate(
      source,
      0,
      "exact-match",
      "reviewer-1",
      "batch-1",
      "2026-09-22T12:00:00Z",
    );

    expect(judged.rows[0]).toMatchObject({
      verdict: "exact-match",
      confirmer: "reviewer-1",
      batch_id: "batch-1",
      confirmed_at: "2026-09-22T12:00:00Z",
      target_span: source.rows[0].target_span,
      source_hash: source.rows[0].source_hash,
    });
    expect(completion({ kind: "candidate", sheet: judged })).toEqual({ completed: 1, total: 1 });
    expect(source.rows[0].verdict).toBeNull();
  });

  it("refuses candidate judgment without an opaque reviewer handle", () => {
    expect(() => judgeCandidate(candidateSheet(), 0, "irrelevant", "", "batch", "time")).toThrow(
      /reviewer handle/,
    );
  });

  it("converts browser text selections into UTF-8 byte spans", () => {
    const selection = utf8Selection("Mōdel re-rolls", 0, 5);
    expect(selection).toEqual({ start: 0, end: 6, text: "Mōdel" });
  });

  it("soft-highlights broad Hit terms without pretending they are judgments", () => {
    const segments = hitHintSegments(
      "Lethal Hits applies when an attack hits; white armour does not.",
    );

    expect(segments.filter((segment) => segment.hit).map((segment) => segment.text)).toEqual([
      "Hits",
      "hits",
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Lethal Hits applies when an attack hits; white armour does not.",
    );
  });

  it("highlights Weapon Skill and Ballistic Skill as Hit-roll cues", () => {
    const segments = hitHintSegments(
      "Improve the Weapon Skill characteristic by 1. Improve the Ballistic Skill characteristic by 1.",
    );

    expect(segments.filter((segment) => segment.hit).map((segment) => segment.text)).toEqual([
      "Weapon Skill",
      "Ballistic Skill",
    ]);
  });

  it("locates every keyboard-selectable Hit cue", () => {
    const text = "Weapon Skill, hits, then BS.";
    expect(hitCueRanges(text).map(({ start, end }) => text.slice(start, end))).toEqual([
      "Weapon Skill",
      "hits",
      "BS",
    ]);
  });

  it("applies Vim character, word, line, and document motions", () => {
    const text = "one two\nthree";
    expect(moveVimCursor(text, 0, "l")).toBe(1);
    expect(moveVimCursor(text, 1, "h")).toBe(0);
    expect(moveVimCursor(text, 0, "w")).toBe(4);
    expect(moveVimCursor(text, 8, "b")).toBe(4);
    expect(moveVimCursor(text, 0, "e")).toBe(3);
    expect(moveVimCursor(text, 11, "0")).toBe(8);
    expect(moveVimCursor(text, 8, "$")).toBe(text.length);
    expect(moveVimCursor(text, 6, "g")).toBe(0);
    expect(moveVimCursor(text, 6, "G")).toBe(text.length);
  });


  it("proposes source-native sibling mechanics without promoting them", () => {
    expect(proposeSidewaysMechanic("subtract 1 from the Hit roll").choice).toBe(
      "modifier-subtract-one",
    );
    expect(proposeSidewaysMechanic("you can re-roll the Hit roll").choice).toBe(
      "reroll-all",
    );
    expect(proposeSidewaysMechanic("that attack automatically hits the target (no hit roll is made)").choice).toBe(
      "automatic-hit",
    );
    expect(proposeSidewaysMechanic("making a Hit roll").choice).toBe("ambiguous");
  });

  it("confirms one sideways mechanic across every queried fingerprint", () => {
    const source = candidateSheet();
    source.fingerprints = [
      { id: "reroll", family: "reroll", parameters: { roll: "hit", subset: "ones" } },
      { id: "modifier", family: "roll-modifier", parameters: { roll: "hit", operation: "add", value: 1 } },
      { id: "critical", family: "critical-hit-threshold", parameters: { value: "source" } },
    ];
    source.rows = source.fingerprints.map((fingerprint) => ({
      ...source.rows[0],
      queried_fingerprint_id: fingerprint.id,
      target_span: "subtract 1 from the Hit roll",
    }));

    const judged = judgeCandidateSideways(
      source,
      source.rows[0].candidate_id,
      "modifier-subtract-one",
      "reviewer-1",
      "batch-sideways",
      "time",
    );

    expect(judged.assisted).toBe(true);
    expect(judged.rows.map((row) => row.verdict)).toEqual([
      "different-family",
      "related-variant",
      "different-family",
    ]);
    expect(judged.rows.every((row) =>
      row.sideways_review?.proposed_choice === "modifier-subtract-one" &&
      row.sideways_review.confirmed_choice === "modifier-subtract-one"
    )).toBe(true);
    expect(judged.rows.every((row) =>
      row.retrieval.retrieval_method === "sideways-train-proposal" &&
      row.retrieval.version === "round5b/sideways-proposal/v1"
    )).toBe(true);
    expect(parseReviewDocument(judged).kind).toBe("candidate");
  });
  it("requires grounded occurrences for positive recall judgments", () => {
    const source = recallSheet();
    expect(() => completeRecall(source, 0, true, "reviewer-1", "time")).toThrow(
      /must contain at least one grounded occurrence/,
    );

    const withOccurrence = addRecallOccurrence(source, 0, {
      span: { start: 18, end: 26 },
      text: "Hit roll",
      fingerprint: { family: "reroll-hit", parameters: { subset: "all" } },
    });
    const reviewed = completeRecall(withOccurrence, 0, true, "reviewer-1", "time");
    expect(reviewed.rows[0]).toMatchObject({
      contains_hit_semantics: true,
      reviewer: "reviewer-1",
      reviewed_at: "time",
    });
    expect(completion({ kind: "recall", sheet: reviewed })).toEqual({ completed: 1, total: 1 });
  });

  it("finds the next unresolved row without leaving the sheet", () => {
    const source = candidateSheet();
    source.rows.push({ ...source.rows[0], candidate_id: "cand-two" });
    const firstJudged = judgeCandidate(source, 0, "irrelevant", "reviewer", "batch", "time");
    const document = { kind: "candidate", sheet: firstJudged } as const;
    expect(nextUnresolved(document, 0)).toBe(1);
    expect(nextUnresolved(document, 1)).toBe(1);
  });
});
