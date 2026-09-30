import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { validateFingerprint } from "../src/round5c/contracts.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { getQueue } from "../src/round5c/queue.js";
import { getAbilities, getAbility, getDashboard, getFactions, WorkbenchError } from "../src/round5c/review.js";
import { refreshSources } from "../src/round5c/source.js";
import { applyAnnotationBatch, reviewAbility, undoBatch } from "./round5c-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Span = {
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
};

type Fixture = {
  db: DatabaseSync;
  abilityId: number;
  source: string;
  sourceHash: string;
};

function sourceSpan(source: string, text: string, occurrence = 0): Span {
  let characterStart = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    characterStart = source.indexOf(text, from);
    if (characterStart < 0) throw new Error(`Fixture text is absent: ${text}`);
    from = characterStart + text.length;
  }
  const characterEnd = characterStart + text.length;
  return {
    fragment: "RAW_TEXT",
    start_byte: Buffer.byteLength(source.slice(0, characterStart), "utf8"),
    end_byte: Buffer.byteLength(source.slice(0, characterEnd), "utf8"),
    exact_text: text,
  };
}

function fixture(source = "é; re-roll a Hit roll of 1; re-roll a Hit roll of 1."): Fixture {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  const sourceHash = hashJson({ text: source });
  const inserted = db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', 'ability', ?, ?, 'unit', 'fixture', 'Fixture', '{}', ?, 1)
  `).run(
    sourceHash,
    source,
    JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }]),
  );
  return { db, abilityId: Number(inserted.lastInsertRowid), source, sourceHash };
}

function rerollDecision(fixtureValue: Fixture, span: Span, action: "confirm" | "correct" = "confirm") {
  return {
    action,
    ability_version_id: fixtureValue.abilityId,
    source_hash: fixtureValue.sourceHash,
    ...span,
    role: "EFFECT",
    family_id: "reroll",
    family_version: 2,
    parameters: { roll: "hit", subset: "ones", weapon_type: "all" },
  };
}

function annotationIdForBatch(fixtureValue: Fixture, batchId: string): number {
  const row = fixtureValue.db.prepare("SELECT id FROM annotations WHERE batch_id = ?").get(batchId) as { id: number };
  return row.id;
}

function insertRetrievalProposal(fixtureValue: Fixture, span: Span): number {
  const spanId = insertSpan(
    fixtureValue.db,
    fixtureValue.abilityId,
    span.fragment,
    span.start_byte,
    span.end_byte,
    span.exact_text,
  );
  const fingerprint = validateFingerprint(
    fixtureValue.db,
    "reroll",
    { roll: "hit", subset: "ones", weapon_type: "all" },
    2,
    span.exact_text,
  );
  const proposal = fixtureValue.db.prepare(`
    INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
    VALUES (?, ?, 'EFFECT', 'retrieval', 'pending', '{"algorithm":"fixture"}', 1, '2026-01-01T00:00:00.000Z')
  `).run(spanId, fingerprint);
  return Number(proposal.lastInsertRowid);
}

function expectWorkbenchError(run: () => unknown, status: number): void {
  try {
    run();
    throw new Error("Expected a workbench error.");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkbenchError);
    expect((error as WorkbenchError).status).toBe(status);
  }
}

describe("Round 5C source-bound review ledger", () => {
  it("searches bounded complete abilities without interpreting literal wildcard input", () => {
    const value = fixture("A complete source.");
    try {
      expect(getAbilities(value.db, { query: "Fixture" }).items.map((item) => item.ability_id)).toEqual(["ability"]);
      expect(getAbilities(value.db, { query: "%" }).items).toEqual([]);
      expectWorkbenchError(() => getAbilities(value.db, { limit: 100 }), 422);
    } finally {
      value.db.close();
    }
  });

  it("filters exact current factions across pages and rejects a cursor from another filter", () => {
    const value = fixture("A fabricated example.");
    try {
      const insert = value.db.prepare(`
        INSERT INTO abilities (
          faction_id, ability_id, source_hash, source_text, source_type, source_kind,
          name, metadata_json, fragments_json, current
        ) VALUES (?, ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
      `);
      const fragments = JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(value.source), text: value.source }]);
      for (let index = 0; index < 10; index += 1) {
        insert.run("fixture", `extra-${index}`, value.sourceHash, value.source, `Extra ${index}`, fragments);
      }
      insert.run("other", "other-ability", value.sourceHash, value.source, "Other", fragments);
      expect(getFactions(value.db)).toEqual(["fixture", "other"]);
      const first = getAbilities(value.db, { factionId: "fixture", limit: 10 });
      expect(first.items).toHaveLength(10);
      expect(first.items.every((item) => item.faction_id === "fixture")).toBe(true);
      expect(getAbilities(value.db, { factionId: "fixture", limit: 10, cursor: first.next_cursor! }).items.map((item) => item.ability_id)).toEqual(["extra-9"]);
      expect(getAbilities(value.db, { factionId: "other", query: "fixture" }).items).toEqual([]);
      expect(getAbilities(value.db, { factionId: "other" }).items.map((item) => item.ability_id)).toEqual(["other-ability"]);
      expectWorkbenchError(() => getAbilities(value.db, { factionId: "other", cursor: first.next_cursor! }), 422);
    } finally {
      value.db.close();
    }
  });

  it("records a source-bound weapon ability effect without mistaking it for a unit keyword or condition", () => {
    const value = fixture("Example models in this unit gain [Lethal Hits] on their weapons.");
    try {
      const span = sourceSpan(value.source, "models in this unit gain [Lethal Hits] on their weapons");
      const decision = {
        action: "confirm" as const, ability_version_id: value.abilityId, source_hash: value.sourceHash, ...span,
        role: "EFFECT", family_id: "weapon-ability-grant", family_version: 4,
        parameters: { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "all" },
      };
      const batch = applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [decision] });
      expect(getAbility(value.db, value.abilityId).annotations).toMatchObject([{
        fragment: span.fragment, start_byte: span.start_byte, end_byte: span.end_byte,
        family_id: "weapon-ability-grant", role: "EFFECT", parameters: decision.parameters,
      }]);
      expectWorkbenchError(() => applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [
        { ...decision, parameters: { subject: "this-unit", keyword: "Devastating Wounds", weapon_type: "all" } },
      ] }), 422);
      expectWorkbenchError(() => applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [
        { ...decision, role: "CONDITION" },
      ] }), 422);
      expect(annotationIdForBatch(value, batch.batch_id)).toBeGreaterThan(0);
    } finally {
      value.db.close();
    }
  });

  it("moves a whole-context-reviewed ability out of the work queue and restores it when the check clears", () => {
    const value = fixture("A complete source.");
    try {
      expect(getAbilities(value.db).items.map((item) => item.id)).toEqual([value.abilityId]);
      reviewAbility(value.db, value.abilityId, {
        source_hash: value.sourceHash, reviewer: "fixture-reviewer", whole_context_checked: true,
      });
      expect(getAbilities(value.db).items).toEqual([]);
      expect(getAbilities(value.db, { reviewState: "reviewed", query: "Fixture" }).items.map((item) => item.id)).toEqual([value.abilityId]);
      reviewAbility(value.db, value.abilityId, {
        source_hash: value.sourceHash, reviewer: "fixture-reviewer", whole_context_checked: false,
      });
      expect(getAbilities(value.db).items.map((item) => item.id)).toEqual([value.abilityId]);
      expect(getAbilities(value.db, { reviewState: "reviewed" }).items).toEqual([]);
    } finally {
      value.db.close();
    }
  });

  it("rejects a stale whole-context census save without overwriting the newer review", () => {
    const value = fixture("A complete source.");
    try {
      const initial = getAbility(value.db, value.abilityId);
      expect(initial.review_evidence_hash).toMatch(/^[0-9a-f]{64}$/u);
      const remote = reviewAbility(value.db, value.abilityId, {
        source_hash: value.sourceHash,
        expected_review_hash: initial.review_evidence_hash,
        reviewer: "remote-reviewer",
        whole_context_checked: false,
        source_shape: "REMOTE-SHAPE",
        cues: { remote: true },
      });
      expect(remote.review_evidence_hash).not.toBe(initial.review_evidence_hash);

      expectWorkbenchError(() => reviewAbility(value.db, value.abilityId, {
        source_hash: value.sourceHash,
        expected_review_hash: initial.review_evidence_hash,
        reviewer: "local-reviewer",
        whole_context_checked: true,
        source_shape: "LOCAL-STALE-SHAPE",
        cues: { local: "stale" },
      }), 409);
      expect(getAbility(value.db, value.abilityId)).toMatchObject({
        review_evidence_hash: remote.review_evidence_hash,
        review: {
          whole_context_checked: false,
          source_shape: "REMOTE-SHAPE",
          cues: { remote: true },
          reviewed_by: "remote-reviewer",
        },
      });

      const current = reviewAbility(value.db, value.abilityId, {
        source_hash: value.sourceHash,
        expected_review_hash: remote.review_evidence_hash,
        reviewer: "local-reviewer",
        whole_context_checked: true,
        source_shape: "LOCAL-CURRENT-SHAPE",
        cues: { local: "current" },
      });
      expect(current.review).toMatchObject({
        whole_context_checked: true,
        source_shape: "LOCAL-CURRENT-SHAPE",
        cues: { local: "current" },
      });
    } finally {
      value.db.close();
    }
  });

  it("uses UTF-8 reviewable bytes, excludes punctuation, and keeps proposals independent", () => {
    const value = fixture();
    try {
      const first = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const second = sourceSpan(value.source, "re-roll a Hit roll of 1", 1);
      applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [rerollDecision(value, first)] });
      insertRetrievalProposal(value, second);

      const coverage = getAbilityCoverage(value.db, value.abilityId);
      expect(coverage.leaf_fraction).toBeGreaterThan(0);
      expect(coverage.leaf_fraction).toBeLessThan(1);
      expect(coverage.proposal_fraction).toBeGreaterThan(0);
      expect(coverage.whole_reviewed).toBe(false);
      expect(coverage.uncovered).toContainEqual(expect.objectContaining({ start_byte: 0, end_byte: 2, text: "é" }));

      reviewAbility(value.db, value.abilityId, {
        source_hash: value.sourceHash,
        reviewer: "reviewer",
        whole_context_checked: true,
        source_shape: "C→AND(E,E,E)",
        cues: { fixture: true },
      });
      expect(getAbility(value.db, value.abilityId).review.whole_context_checked).toBe(true);
      expect(getAbility(value.db, value.abilityId).review.source_shape).toBe("C→AND(E,E,E)");
      applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [rerollDecision(value, second)] });
      expect(getAbility(value.db, value.abilityId).review.whole_context_checked).toBe(false);
    } finally {
      value.db.close();
    }
  });

  it("keeps correction history and restores its superseded annotation on undo", () => {
    const value = fixture("re-roll a Hit roll of 1.");
    try {
      const narrow = sourceSpan(value.source, "re-roll a Hit roll");
      const wide = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const original = applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [rerollDecision(value, narrow)] });
      const originalAnnotationId = annotationIdForBatch(value, original.batch_id);
      const correction = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{ ...rerollDecision(value, wide, "correct"), supersedes_annotation_id: originalAnnotationId }],
      });
      expect(value.db.prepare("SELECT status FROM annotations WHERE batch_id = ?").get(original.batch_id)).toEqual({ status: "superseded" });
      expect(value.db.prepare("SELECT supersedes_id, status FROM annotations WHERE batch_id = ?").get(correction.batch_id))
        .toEqual(expect.objectContaining({ supersedes_id: expect.any(Number), status: "active" }));

      undoBatch(value.db, correction.batch_id, { reviewer: "reviewer" });
      expect(value.db.prepare("SELECT status FROM annotations WHERE batch_id = ?").get(original.batch_id)).toEqual({ status: "active" });
      expect(value.db.prepare("SELECT status FROM annotations WHERE batch_id = ?").get(correction.batch_id)).toEqual({ status: "retracted" });
    } finally {
      value.db.close();
    }
  });

  it("records one retrieval proposal and annotation provenance per group occurrence", () => {
    const value = fixture("re-roll a Hit roll of 1. re-roll a Hit roll of 1.");
    try {
      const first = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const second = sourceSpan(value.source, "re-roll a Hit roll of 1", 1);
      const firstProposal = insertRetrievalProposal(value, first);
      const secondProposal = insertRetrievalProposal(value, second);
      const result = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [
          { ...rerollDecision(value, first), proposal_id: firstProposal },
          { ...rerollDecision(value, second), proposal_id: secondProposal },
        ],
      });

      expect(result.applied).toBe(2);
      expect(value.db.prepare("SELECT count(*) AS total FROM annotations WHERE batch_id = ? AND origin = 'retrieval'").get(result.batch_id))
        .toEqual({ total: 2 });
      expect(value.db.prepare("SELECT count(*) AS total FROM batch_members WHERE batch_id = ? AND entity_kind = 'proposal-accepted'").get(result.batch_id))
        .toEqual({ total: 2 });
      expect(value.db.prepare("SELECT count(*) AS total FROM batch_members WHERE batch_id = ? AND entity_kind = 'annotation'").get(result.batch_id))
        .toEqual({ total: 2 });
    } finally {
      value.db.close();
    }
  });

  it("corrects a proposed boundary and fingerprint without promoting the old meaning", () => {
    const value = fixture("re-roll a Hit roll of 1.");
    try {
      const narrow = sourceSpan(value.source, "re-roll a Hit roll");
      const wide = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const proposalId = insertRetrievalProposal(value, narrow);
      const result = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{
          ...rerollDecision(value, wide, "correct"),
          proposal_id: proposalId,
          parameters: { roll: "hit", subset: "all", weapon_type: "all" },
        }],
      });
      expect(result.applied).toBe(1);
      expect(value.db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposalId)).toEqual({ status: "corrected" });
      expect(getAbility(value.db, value.abilityId).annotations).toEqual([
        expect.objectContaining({ start_byte: wide.start_byte, end_byte: wide.end_byte, parameters: { roll: "hit", subset: "all", weapon_type: "all" } }),
      ]);
      undoBatch(value.db, result.batch_id, { reviewer: "reviewer" });
      expect(value.db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposalId)).toEqual({ status: "pending" });
    } finally {
      value.db.close();
    }
  });

  it("rejects undo after a later correction changes its current annotation", () => {
    const value = fixture("re-roll a Hit roll of 1.");
    try {
      const narrow = sourceSpan(value.source, "re-roll a Hit roll");
      const wide = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const first = applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [rerollDecision(value, narrow)] });
      const firstAnnotationId = annotationIdForBatch(value, first.batch_id);
      applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [{ ...rerollDecision(value, wide, "correct"), supersedes_annotation_id: firstAnnotationId }] });
      expectWorkbenchError(() => undoBatch(value.db, first.batch_id, { reviewer: "reviewer" }), 409);
    } finally {
      value.db.close();
    }
  });

  it("requires the explicit overlapping active annotation rather than inferring correction supersession", () => {
    const value = fixture("re-roll a Hit roll of 1. re-roll a Hit roll of 1.");
    try {
      const firstNarrow = sourceSpan(value.source, "re-roll a Hit roll");
      const firstWide = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const second = sourceSpan(value.source, "re-roll a Hit roll of 1", 1);
      const first = applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [rerollDecision(value, firstNarrow)] });
      const other = applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [rerollDecision(value, second)] });
      const firstAnnotationId = annotationIdForBatch(value, first.batch_id);
      const otherAnnotationId = annotationIdForBatch(value, other.batch_id);
      const proposalId = insertRetrievalProposal(value, firstNarrow);

      expectWorkbenchError(() => applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{ ...rerollDecision(value, firstWide, "correct"), proposal_id: proposalId }],
      }), 409);
      expectWorkbenchError(() => applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{ ...rerollDecision(value, firstWide, "correct"), supersedes_annotation_id: otherAnnotationId }],
      }), 409);
      expect(value.db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposalId)).toEqual({ status: "pending" });
      expect(value.db.prepare("SELECT status FROM annotations WHERE id = ?").get(firstAnnotationId)).toEqual({ status: "active" });
      expect(value.db.prepare("SELECT status FROM annotations WHERE id = ?").get(otherAnnotationId)).toEqual({ status: "active" });
    } finally {
      value.db.close();
    }
  });

  it("allows an exact annotation correction to change semantic role", () => {
    const value = fixture("re-roll a Hit roll of 1.");
    try {
      const span = sourceSpan(value.source, "re-roll a Hit roll");
      const original = applyAnnotationBatch(value.db, { reviewer: "reviewer", decisions: [rerollDecision(value, span)] });
      const correction = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{
          action: "correct",
          supersedes_annotation_id: annotationIdForBatch(value, original.batch_id),
          ability_version_id: value.abilityId,
          source_hash: value.sourceHash,
          ...span,
          role: "CONDITION",
          family_id: "leading-unit",
          family_version: 2,
          parameters: { subject: { source: span.exact_text }, attachment: "leading" },
        }],
      });
      expect(value.db.prepare("SELECT status FROM annotations WHERE batch_id = ?").get(original.batch_id)).toEqual({ status: "superseded" });
      expect(getAbility(value.db, value.abilityId).annotations).toEqual([
        expect.objectContaining({ role: "CONDITION", family_id: "leading-unit" }),
      ]);
      undoBatch(value.db, correction.batch_id, { reviewer: "reviewer" });
      expect(value.db.prepare("SELECT status FROM annotations WHERE batch_id = ?").get(original.batch_id)).toEqual({ status: "active" });
    } finally {
      value.db.close();
    }
  });

  it("refuses historical batches and reviewer-mismatched review batch undo", () => {
    const value = fixture();
    try {
      value.db.prepare(`
        INSERT INTO annotation_batches (id, operation, reviewer, created_at)
        VALUES ('historical', 'import-hit-train', 'reviewer', '2026-01-01T00:00:00.000Z')
      `).run();
      expectWorkbenchError(() => undoBatch(value.db, "historical", { reviewer: "reviewer" }), 409);

      const batch = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [rerollDecision(value, sourceSpan(value.source, "re-roll a Hit roll of 1"))],
      });
      expectWorkbenchError(() => undoBatch(value.db, batch.batch_id, { reviewer: "another-reviewer" }), 409);
    } finally {
      value.db.close();
    }
  });

  it("resolves an unresolved proposal's linked leaf gap and restores both on undo", () => {
    const value = fixture("re-roll a Hit roll of 1.");
    try {
      const span = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const unresolved = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{
          action: "ambiguous",
          ability_version_id: value.abilityId,
          source_hash: value.sourceHash,
          ...span,
          role: "UNRESOLVED",
        }],
      });
      const proposal = value.db.prepare("SELECT id FROM proposals WHERE status = 'unresolved'").get() as { id: number };
      expect(value.db.prepare("SELECT status, proposal_id FROM gaps WHERE batch_id = ?").get(unresolved.batch_id))
        .toEqual({ status: "open", proposal_id: proposal.id });

      const resolved = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{ ...rerollDecision(value, span), proposal_id: proposal.id }],
      });
      expect(value.db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposal.id)).toEqual({ status: "accepted" });
      expect(value.db.prepare("SELECT status FROM gaps WHERE proposal_id = ?").get(proposal.id)).toEqual({ status: "resolved" });
      undoBatch(value.db, resolved.batch_id, { reviewer: "reviewer" });
      expect(value.db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposal.id)).toEqual({ status: "unresolved" });
      expect(value.db.prepare("SELECT status FROM gaps WHERE proposal_id = ?").get(proposal.id)).toEqual({ status: "open" });
    } finally {
      value.db.close();
    }
  });

  it("accepts a pending connective as human review evidence and restores it on undo", () => {
    const value = fixture("Alpha and Beta.");
    try {
      const span = sourceSpan(value.source, "and");
      const spanId = insertSpan(value.db, value.abilityId, span.fragment, span.start_byte, span.end_byte, span.exact_text);
      const proposal = value.db.prepare(`
        INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
        VALUES (?, NULL, 'CONNECTIVE', 'luna', 'pending', '{"kind":"fixture"}', NULL, '2026-01-01T00:00:00.000Z')
      `).run(spanId);
      const proposalId = Number(proposal.lastInsertRowid);
      const batch = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{
          action: "confirm-connective",
          proposal_id: proposalId,
          ability_version_id: value.abilityId,
          source_hash: value.sourceHash,
          ...span,
          role: "CONNECTIVE",
        }],
      });
      expect(value.db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposalId)).toEqual({ status: "accepted" });
      expect(value.db.prepare("SELECT count(*) AS total FROM annotations").get()).toEqual({ total: 0 });
      undoBatch(value.db, batch.batch_id, { reviewer: "reviewer" });
      expect(value.db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposalId)).toEqual({ status: "pending" });
    } finally {
      value.db.close();
    }
  });

  it("opens one leaf gap per novel occurrence and retires or restores each with its decision", () => {
    const value = fixture();
    try {
      const second = value.db.prepare(`
        INSERT INTO abilities (
          faction_id, ability_id, source_hash, source_text, source_type, source_kind,
          name, metadata_json, fragments_json, current
        ) VALUES ('fixture', 'second', ?, ?, 'unit', 'fixture', 'Second', '{}', ?, 1)
      `).run(value.sourceHash, value.source, JSON.stringify([{
        fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(value.source, "utf8"), text: value.source,
      }]));
      const span = sourceSpan(value.source, "re-roll a Hit roll of 1");
      const first = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [value.abilityId, Number(second.lastInsertRowid)].map((abilityId) => ({
          action: "novel", ability_version_id: abilityId, source_hash: value.sourceHash,
          ...span, role: "EFFECT",
        })),
      });
      const openGaps = () => (value.db.prepare("SELECT count(*) AS total FROM gaps WHERE type = 'LEAF_GAP' AND status = 'open'").get() as { total: number }).total;
      expect(openGaps()).toBe(2);
      const proposal = value.db.prepare(`
        SELECT proposals.id FROM proposals
        JOIN source_spans ON source_spans.id = proposals.span_id
        WHERE source_spans.ability_version_id = ? AND proposals.status = 'unresolved'
      `).get(value.abilityId) as { id: number };
      const confirmed = applyAnnotationBatch(value.db, {
        reviewer: "reviewer",
        decisions: [{ ...rerollDecision(value, span), proposal_id: proposal.id }],
      });
      expect(openGaps()).toBe(1);
      undoBatch(value.db, confirmed.batch_id, { reviewer: "reviewer" });
      expect(openGaps()).toBe(2);
      undoBatch(value.db, first.batch_id, { reviewer: "reviewer" });
      expect(openGaps()).toBe(0);
    } finally {
      value.db.close();
    }
  });
  it("quarantines whole review on a refreshed source version and exposes separate gap counts", () => {
    const root = mkdtempSync(join(tmpdir(), "round5c-review-"));
    temporaryRoots.push(root);
    const file = join(root, "fixture.json");
    const initial = "re-roll a Hit roll of 1.";
    writeFileSync(file, JSON.stringify([{ faction_id: "fixture", ability_id: "ability", raw_text: initial }]));
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      refreshSources(db, root);
      const old = db.prepare("SELECT id, source_hash FROM abilities WHERE current = 1").get() as { id: number; source_hash: string };
      reviewAbility(db, old.id, {
        source_hash: old.source_hash,
        reviewer: "reviewer",
        whole_context_checked: true,
      });
      writeFileSync(file, JSON.stringify([{ faction_id: "fixture", ability_id: "ability", raw_text: "re-roll a Hit roll of 1, once." }]));
      refreshSources(db, root);
      const currentRow = db.prepare("SELECT id FROM abilities WHERE current = 1").get() as { id: number };
      const current = getAbility(db, currentRow.id);
      expect(current.current).toBe(true);
      expect(getAbility(db, old.id).current).toBe(false);
      expect(current.review.whole_context_checked).toBe(false);
      expectWorkbenchError(() => reviewAbility(db, old.id, {
        source_hash: old.source_hash,
        reviewer: "reviewer",
        whole_context_checked: true,
      }), 409);

      db.prepare("INSERT INTO gaps (ability_version_id, type, status, description) VALUES (?, 'RELATION_GAP', 'open', 'fixture')")
        .run(current.id);
      db.prepare("INSERT INTO gaps (ability_version_id, type, status, description) VALUES (?, 'COMPOSITION_GAP', 'open', 'fixture')")
        .run(current.id);
      db.prepare("INSERT INTO gaps (ability_version_id, type, status, description) VALUES (?, 'DSL_GAP', 'open', 'fixture')")
        .run(current.id);
      const span = sourceSpan(current.source_text, "re-roll a Hit roll of 1");
      applyAnnotationBatch(db, {
        reviewer: "reviewer",
        decisions: [{
          action: "ambiguous",
          ability_version_id: current.id,
          source_hash: current.source_hash,
          ...span,
          role: "UNRESOLVED",
        }],
      });
      expect(getDashboard(db).gap_counts).toEqual({
        LEAF_GAP: 1,
        RELATION_GAP: 1,
        COMPOSITION_GAP: 1,
        DSL_GAP: 1,
      });
    } finally {
      db.close();
    }
  });
});
