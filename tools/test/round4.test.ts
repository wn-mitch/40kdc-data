import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collapseCandidateSeeds, generateCandidates, type CandidateSeed } from "../src/round4/candidates.js";
import { composeAtoms } from "../src/round4/composer.js";
import type { AtomCandidate, FrozenAbility, RelationQuestion } from "../src/round4/contracts.js";
import { conditionalJevMetrics, upstreamFailure } from "../src/round4/evaluate.js";
import { verifyHash } from "../src/round4/hash.js";
import { byteOffsets, isCharBoundary, utf8Span } from "../src/round4/spans.js";

function frozen(source_text: string, faction_id = "example-faction", ability_id = "example-ability"): FrozenAbility {
  const bytes = Buffer.from(source_text, "utf8");
  return {
    faction_id,
    ability_id,
    name: "Example Ability",
    primary_stratum: "test",
    secondary_family_tags: [],
    card: { source_kind: "raw-text", fields: ["RAW_TEXT"] },
    source_locator: "fixture",
    source_text,
    source_bytes_base64: bytes.toString("base64"),
    source_byte_length: bytes.length,
    source_hash: "0".repeat(64),
    source_digest: "1".repeat(64),
    source_provenance: { repository: "40kdc-abilities", file: "fixture.json", record_pointer: "/example-ability" },
    source_fragments: [{ label: "RAW_TEXT", start: 0, end: bytes.length }],
  };
}

function atom(id: string, start: number): AtomCandidate {
  return {
    id,
    family: "participant-reference",
    rank: 1,
    role: "participant",
    meaning: id,
    value: id,
    participant: id,
    arguments: {},
    evidence: [{ span: { start, end: start + 2 }, channel: "local-context" }],
  };
}

describe("Round 4 frozen contracts", () => {
  it("uses UTF-8 byte offsets and never emits a continuation-byte boundary", () => {
    const source = "Aé🙂Z";
    const offsets = byteOffsets(source);
    expect([...offsets]).toEqual([0, 1, 3, 7, 7, 8]);
    expect(utf8Span(source, 1, 4)).toEqual({ start: 1, end: 7 });
    const bytes = Buffer.from(source, "utf8");
    expect(isCharBoundary(bytes, 3)).toBe(true);
    expect(isCharBoundary(bytes, 4)).toBe(false);
  });

  it("collapses equal semantics while retaining distinct evidence spans and channels", () => {
    const seeds: CandidateSeed[] = [
      { family: "operation", role: "verb", meaning: "increase", value: "add", start: 0, end: 3, channel: "regex", rank: 2 },
      { family: "operation", role: "verb", meaning: "increase", value: "add", start: 8, end: 11, channel: "morphological-alias", rank: 1 },
      { family: "operation", role: "verb", meaning: "decrease", value: "subtract", start: 4, end: 7, channel: "closed-lexicon", rank: 1 },
    ];
    const candidates = collapseCandidateSeeds("add sub add", seeds);
    expect(candidates).toHaveLength(2);
    const increase = candidates.find((candidate) => candidate.meaning === "increase");
    expect(increase?.rank).toBe(1);
    expect(increase?.evidence).toHaveLength(2);
  });

  it("ranks numeric semantic alternatives deterministically", () => {
    const first = generateCandidates(frozen("On a 3+, add 1."));
    const second = generateCandidates(frozen("On a 3+, add 1."));
    expect(second.candidates).toEqual(first.candidates);
    const threshold = first.candidates.find(
      (candidate) => candidate.family === "magnitude-expression" && candidate.role === "threshold" && candidate.value === 3,
    );
    expect(threshold?.rank).toBe(1);
  });

  it("does not condition candidates on faction or ability identity", () => {
    const source = "For each model, roll one D6; on a 4+, subtract 1 from the Hit roll.";
    const left = generateCandidates(frozen(source, "alpha-faction", "alpha-rule"));
    const right = generateCandidates(frozen(source, "beta-faction", "beta-rule"));
    expect(right.candidates).toEqual(left.candidates);
    expect(right.lattice).toEqual(left.lattice);
    expect(right.questions.map(({ identity: _identity, ...question }) => question))
      .toEqual(left.questions.map(({ identity: _identity, ...question }) => question));
  });

  it("attributes the most upstream available failure", () => {
    expect(upstreamFailure({ failure: "CANDIDATE_MISS" }, { failure: "JEV_MISSELECTION" }, true)).toBe("CANDIDATE_MISS");
    expect(upstreamFailure(undefined, { failure: "JEV_ABSTENTION" }, true)).toBe("JEV_ABSTENTION");
    expect(upstreamFailure(undefined, undefined, true)).toBe("DIRECT_GENERATION_ERROR");
  });

  it("excludes misses and annotation ambiguity from conditional Jev denominators", () => {
    const metric = conditionalJevMetrics([
      { correct_candidate_present: true, top_1_correct: true, top_2_correct: true, failure: null },
      { correct_candidate_present: false, top_1_correct: false, top_2_correct: false, failure: "CANDIDATE_MISS" },
      { correct_candidate_present: true, top_1_correct: false, top_2_correct: true, failure: "JEV_MISSELECTION" },
      { correct_candidate_present: true, top_1_correct: false, top_2_correct: false, failure: "ANNOTATION_AMBIGUITY" },
    ]);
    expect(metric).toEqual({ denominator: 2, top_1: 1, top_2: 2 });
  });

  it("preserves a wrong binding rather than repairing it", () => {
    const atoms = [atom("wrong", 0), atom("correct", 8)];
    const question: RelationQuestion = {
      id: "binding",
      identity: { faction_id: "example-faction", ability_id: "example-ability" },
      type: "antecedent",
      source_span: { start: 4, end: 6 },
      source_context: "fixture",
      prompt: "Resolve the reference.",
      subject_atom_ids: atoms.map((candidate) => candidate.id),
      options: atoms.map((candidate) => ({ id: candidate.id, label: candidate.id, description: candidate.id, kind: "candidate", atom_id: candidate.id })),
    };
    const wrong = composeAtoms(atoms, [question], [{ question_id: "binding", question_type: "antecedent", selected: "wrong", source_span: question.source_span }]);
    const correct = composeAtoms(atoms, [question], [{ question_id: "binding", question_type: "antecedent", selected: "correct", source_span: question.source_span }]);
    expect(wrong.roots[1]?.children?.[0]?.atom_id).toBe("wrong");
    expect(correct.roots[1]?.children?.[0]?.atom_id).toBe("correct");
    expect(wrong.roots[0]).toEqual(correct.roots[0]);
  });

  it("hard-fails hash drift and keeps forbidden dependencies out of the bundle manifest", () => {
    expect(() => verifyHash("fixture", "expected", "actual")).toThrow(/hash drift/);
    const metaPath = join(process.cwd(), "..", "_private", "round4", "process-a", "app", "parser.meta.json");
    const meta = readFileSync(metaPath, "utf8");
    expect(meta).not.toMatch(/data[\\/]enrichment|semantic-annotations|40kdc-jev-orks|round4[\\/]evaluator/i);
  });
});
