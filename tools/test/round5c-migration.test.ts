import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { hashFile, hashJson } from "../src/round4/hash.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { importHitTrain, repairRelatedVariantProposals } from "../src/round5c/migration.js";
type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };

type Fixture = {
  root: string;
  source: string;
  sourceHash: string;
  hashes: Record<string, string>;
};

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function byteSpan(text: string, selection: string): { start: number; end: number; text: string; left: string; right: string } {
  const characterStart = text.indexOf(selection);
  if (characterStart < 0) throw new Error(`Fixture selection is absent: ${selection}`);
  const characterEnd = characterStart + selection.length;
  return {
    start: Buffer.byteLength(text.slice(0, characterStart), "utf8"),
    end: Buffer.byteLength(text.slice(0, characterEnd), "utf8"),
    text: selection,
    left: text.slice(0, characterStart),
    right: text.slice(characterEnd),
  };
}

function buildFixture({ recognizedRecall = false, sidewaysReviewed = true }: { recognizedRecall?: boolean; sidewaysReviewed?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "round5c-migration-"));
  temporaryRoots.push(root);
  const review = join(root, "review");
  mkdirSync(review);
  const source = "Préface. re-roll a Hit roll of 1. subtract 1 from the Hit roll. ordinary wording.";
  const sourceHash = hashJson({ text: source });
  const reroll = byteSpan(source, "re-roll a Hit roll of 1");
  const subtract = byteSpan(source, "subtract 1 from the Hit roll");
  const ordinary = byteSpan(source, "ordinary wording");
  const manifestHash = hashJson({ artifact: "fixture-manifest" });
  const rubric = "fixture-rubric/v1";
  const fingerprints = [
    { id: "legacy-reroll", canonical_hash: hashJson({ legacy: "reroll" }), family: "reroll", version: 2, parameters: { roll: "hit", subset: "ones", weapon_type: "all" } },
    { id: "legacy-add", canonical_hash: hashJson({ legacy: "add" }), family: "roll-modifier", version: 1, parameters: { roll: "hit", operation: "add", value: 1 } },
    { id: "legacy-threshold", canonical_hash: hashJson({ legacy: "threshold" }), family: "critical-hit-threshold", version: 1, parameters: { value: "source" } },
  ];
  const candidates = {
    hash: manifestHash,
    rubric_version: rubric,
    fingerprints,
    candidates: [
      {
        id: "candidate-exact",
        split: "train",
        source: {
          faction_id: "fixture-faction",
          ability_id: "fixture-ability",
          source_hash: sourceHash,
          fragment: "RAW_TEXT",
          span: { start: reroll.start, end: reroll.end },
        },
      },
      {
        id: "candidate-related",
        split: "train",
        source: {
          faction_id: "fixture-faction",
          ability_id: "fixture-ability",
          source_hash: sourceHash,
          fragment: "RAW_TEXT",
          span: { start: subtract.start, end: subtract.end },
        },
      },
      {
        id: "candidate-negative",
        split: "train",
        source: {
          faction_id: "fixture-faction",
          ability_id: "fixture-ability",
          source_hash: sourceHash,
          fragment: "RAW_TEXT",
          span: { start: ordinary.start, end: ordinary.end },
        },
      },
    ],
  };
  const labels = {
    manifest_hash: manifestHash,
    split: "train",
    fingerprints,
    rows: [
      {
        candidate_id: "candidate-exact",
        queried_fingerprint_id: "legacy-reroll",
        split: "train",
        source_hash: sourceHash,
        fragment: "RAW_TEXT",
        span: { start: reroll.start, end: reroll.end },
        target_span: reroll.text,
        left_context: reroll.left,
        right_context: reroll.right,
        rubric_version: rubric,
        verdict: "exact-match",
        batch_id: "batch-exact",
        confirmer: "reviewer",
        confirmed_at: "2026-09-22T00:00:00.000Z",
      },
      {
        candidate_id: "candidate-related",
        queried_fingerprint_id: "legacy-add",
        split: "train",
        source_hash: sourceHash,
        fragment: "RAW_TEXT",
        span: { start: subtract.start, end: subtract.end },
        target_span: subtract.text,
        left_context: subtract.left,
        right_context: subtract.right,
        rubric_version: rubric,
        verdict: "related-variant",
        batch_id: "batch-related",
        confirmer: "reviewer",
        confirmed_at: "2026-09-22T00:01:00.000Z",
        ...(sidewaysReviewed ? {
          retrieval: { retrieval_method: "sideways-train-proposal", version: "fixture-sideways/v1" },
          sideways_review: {
            proposal_version: "fixture-sideways/v1",
            proposed_choice: "modifier-subtract-one",
            confirmed_choice: "modifier-subtract-one",
          },
        } : {}),
      },
      {
        candidate_id: "candidate-negative",
        queried_fingerprint_id: "legacy-threshold",
        split: "train",
        source_hash: sourceHash,
        fragment: "RAW_TEXT",
        span: { start: ordinary.start, end: ordinary.end },
        target_span: ordinary.text,
        left_context: ordinary.left,
        right_context: ordinary.right,
        rubric_version: rubric,
        verdict: "different-family",
        batch_id: "batch-negative",
        confirmer: "reviewer",
        confirmed_at: "2026-09-22T00:02:00.000Z",
      },
    ],
  };
  const audit = {
    manifest_hash: manifestHash,
    audit_hash: hashJson({ artifact: "fixture-audit" }),
    rows: [
      {
        faction_id: "fixture-faction",
        ability_id: "fixture-ability",
        source_hash: sourceHash,
        source_text: source,
        contains_hit_semantics: true,
        missed_occurrences: [
          recognizedRecall
            ? {
              span: { start: reroll.start, end: reroll.end },
              text: reroll.text,
              // The recall path always validates at family version 1, so this uses a family whose
              // version 1 is still current rather than reroll (now deprecated at version 1).
              fingerprint: { family: "critical-hit-threshold", parameters: { value: 5 } },
            }
            : {
              span: { start: ordinary.start, end: ordinary.end },
              text: ordinary.text,
              fingerprint: { family: "unregistered-family", parameters: {} },
            },
        ],
        reviewer: "reviewer",
        reviewed_at: "2026-09-22T00:03:00.000Z",
      },
    ],
  };
  writeFileSync(join(root, "candidates.json"), JSON.stringify(candidates));
  writeFileSync(join(root, "review", "train-labels.json"), JSON.stringify(labels));
  writeFileSync(join(root, "review", "recall-audit.json"), JSON.stringify(audit));
  return {
    root,
    source,
    sourceHash,
    hashes: {
      candidates: hashFile(join(root, "candidates.json")),
      labels: hashFile(join(root, "review", "train-labels.json")),
      recall: hashFile(join(root, "review", "recall-audit.json")),
    },
  };
}

function workbenchWithAbility(source: string, sourceHash: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  const byteLength = Buffer.byteLength(source, "utf8");
  db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    "fixture-faction",
    "fixture-ability",
    sourceHash,
    source,
    "unit",
    "json",
    "Fixture ability",
    "{}",
    JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: byteLength, text: source }]),
  );
  return db;
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT count(*) AS value FROM ${table}`).get() as { value: number };
  return row.value;
}

describe("Round 5C historical Hit train migration", () => {
  it("preserves immutable review evidence, promotes exact only, and remains idempotent", () => {
    const fixture = buildFixture();
    const db = workbenchWithAbility(fixture.source, fixture.sourceHash);
    try {
      const first = importHitTrain(db, fixture.root);
      expect(first.pairwise).toMatchObject({
        reviewed: 3,
        imported: 3,
        exactPromoted: 1,
        parameterReviewProposals: 1,
        stale: 0,
      });
      expect(first.recall).toMatchObject({ reviewed: 1, imported: 1, promoted: 0, queuedForReview: 1, stale: 0 });
      expect(count(db, "candidate_judgments")).toBe(4);
      expect(count(db, "annotations")).toBe(1);
      expect(count(db, "proposals")).toBe(2);
      expect(db.prepare("SELECT count(*) AS value FROM annotations WHERE status = 'active'").get()).toEqual({ value: 1 });
      expect(db.prepare("SELECT role FROM proposals WHERE origin = 'hit-train'").get()).toEqual({ role: "EFFECT" });
      expect(db.prepare("SELECT role FROM proposals WHERE origin = 'recall-audit'").get()).toEqual({ role: "UNRESOLVED" });
      const relatedEvidence = db.prepare(
        "SELECT source_row_json FROM candidate_judgments WHERE candidate_id = 'candidate-related'",
      ).get() as { source_row_json: string };
      expect(relatedEvidence.source_row_json).toMatch(/"legacy_fingerprint":\{"id":"legacy-add","canonical_hash":"[0-9a-f]{64}"/u);
      expect(db.prepare("SELECT legacy_fingerprint_id FROM fingerprints WHERE legacy_fingerprint_id = 'legacy-reroll'").get()).toEqual({
        legacy_fingerprint_id: "legacy-reroll",
      });
      expect(relatedEvidence.source_row_json).toContain('"confirmed_choice":"modifier-subtract-one"');
      expect(db.prepare("SELECT fingerprint_id FROM annotations").get()).toEqual(expect.objectContaining({ fingerprint_id: expect.stringMatching(/^fp_/) }));

      const second = importHitTrain(db, fixture.root);
      expect(second.pairwise).toMatchObject({ imported: 0, existing: 3, exactPromoted: 0, parameterReviewProposals: 0 });
      expect(second.recall).toMatchObject({ imported: 0, existing: 1, promoted: 0, queuedForReview: 0 });
      expect(count(db, "candidate_judgments")).toBe(4);
      expect(count(db, "annotations")).toBe(1);
      expect(count(db, "proposals")).toBe(2);
      expect(hashFile(join(fixture.root, "candidates.json"))).toBe(fixture.hashes.candidates);
      expect(hashFile(join(fixture.root, "review", "train-labels.json"))).toBe(fixture.hashes.labels);
      expect(hashFile(join(fixture.root, "review", "recall-audit.json"))).toBe(fixture.hashes.recall);
    } finally {
      db.close();
    }
  });

  it("never offers a related-variant query as an exact fingerprint", () => {
    const fixture = buildFixture({ sidewaysReviewed: false });
    const db = workbenchWithAbility(fixture.source, fixture.sourceHash);
    try {
      importHitTrain(db, fixture.root);
      const proposal = db.prepare(`
        SELECT proposals.id, proposals.fingerprint_id, fingerprints.parameters_json
        FROM proposals JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
        WHERE proposals.origin = 'hit-train'
      `).get() as { id: number; fingerprint_id: string; parameters_json: string };
      expect(JSON.parse(proposal.parameters_json)).toEqual({ roll: "hit", operation: "subtract", value: 1 });

      const queried = db.prepare("SELECT id FROM fingerprints WHERE legacy_fingerprint_id = 'legacy-add'").get() as { id: string };
      db.prepare("UPDATE proposals SET fingerprint_id = ? WHERE id = ?").run(queried.id, proposal.id);
      expect(repairRelatedVariantProposals(db)).toEqual({ rebound: 1, unclassified: 0 });
      expect(db.prepare("SELECT fingerprint_id FROM proposals WHERE id = ?").get(proposal.id)).toEqual({ fingerprint_id: proposal.fingerprint_id });
      expect(repairRelatedVariantProposals(db)).toEqual({ rebound: 0, unclassified: 0 });
      expect(importHitTrain(db, fixture.root).pairwise).toMatchObject({ existing: 3, parameterReviewProposals: 0 });
      expect(count(db, "proposals")).toBe(2);
    } finally {
      db.close();
    }
  });

  it("does not replay an immutable exact judgment after its Golden is superseded or retracted", () => {
    const fixture = buildFixture();
    const db = workbenchWithAbility(fixture.source, fixture.sourceHash);
    try {
      importHitTrain(db, fixture.root);
      const original = db.prepare(`
        SELECT id, span_id, fingerprint_id
        FROM annotations
        WHERE origin = 'hit-train' AND status = 'active'
      `).get() as { id: number; span_id: number; fingerprint_id: string };
      const correction = db.prepare(`
        SELECT id FROM fingerprints WHERE legacy_fingerprint_id = 'legacy-add'
      `).get() as { id: string };
      db.prepare(`
        INSERT INTO annotation_batches (id, operation, reviewer, created_at)
        VALUES ('batch-correction', 'review', 'reviewer', '2026-09-23T00:00:00.000Z')
      `).run();
      db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ?").run(original.id);
      const corrected = db.prepare(`
        INSERT INTO annotations (
          span_id, fingerprint_id, status, origin, confirmed_by, batch_id, supersedes_id, created_at
        ) VALUES (?, ?, 'active', 'review', 'reviewer', 'batch-correction', ?, '2026-09-23T00:00:00.000Z')
      `).run(original.span_id, correction.id, original.id);

      const afterSupersede = importHitTrain(db, fixture.root);
      expect(afterSupersede.pairwise).toMatchObject({ imported: 0, existing: 3, exactPromoted: 0 });
      expect(db.prepare(`
        SELECT count(*) AS value FROM annotations
        WHERE fingerprint_id = ? AND status = 'active'
      `).get(original.fingerprint_id)).toEqual({ value: 0 });
      expect(db.prepare("SELECT fingerprint_id FROM annotations WHERE id = ?").get(corrected.lastInsertRowid)).toEqual({
        fingerprint_id: correction.id,
      });

      db.prepare("UPDATE annotations SET status = 'retracted' WHERE id = ?").run(corrected.lastInsertRowid);
      const afterRetraction = importHitTrain(db, fixture.root);
      expect(afterRetraction.pairwise).toMatchObject({ imported: 0, existing: 3, exactPromoted: 0 });
      expect(db.prepare(`
        SELECT count(*) AS value FROM annotations
        WHERE fingerprint_id = ? AND status = 'active'
      `).get(original.fingerprint_id)).toEqual({ value: 0 });
      expect(count(db, "candidate_judgments")).toBe(4);
    } finally {
      db.close();
    }
  });

  it("does not replay an immutable recall judgment after its promoted occurrence is retracted", () => {
    const fixture = buildFixture({ recognizedRecall: true });
    const db = workbenchWithAbility(fixture.source, fixture.sourceHash);
    try {
      const first = importHitTrain(db, fixture.root);
      expect(first.recall).toMatchObject({ imported: 1, promoted: 1 });
      const original = db.prepare(`
        SELECT id, fingerprint_id FROM annotations
        WHERE origin = 'recall-audit' AND status = 'active'
      `).get() as { id: number; fingerprint_id: string };
      db.prepare("UPDATE annotations SET status = 'retracted' WHERE id = ?").run(original.id);

      const reimport = importHitTrain(db, fixture.root);
      expect(reimport.recall).toMatchObject({ imported: 0, existing: 1, promoted: 0 });
      expect(db.prepare(`
        SELECT count(*) AS value FROM annotations
        WHERE origin = 'recall-audit' AND fingerprint_id = ? AND status = 'active'
      `).get(original.fingerprint_id)).toEqual({ value: 0 });
      expect(count(db, "candidate_judgments")).toBe(4);
    } finally {
      db.close();
    }
  });

  it("quarantines current source drift while retaining the frozen judgment evidence", () => {
    const fixture = buildFixture();
    const db = workbenchWithAbility("Changed source that cannot carry frozen byte offsets.", hashJson({ text: "Changed source that cannot carry frozen byte offsets." }));
    try {
      const report = importHitTrain(db, fixture.root);
      expect(report.pairwise).toMatchObject({ reviewed: 3, imported: 3, exactPromoted: 0, parameterReviewProposals: 0, stale: 3 });
      expect(report.recall).toMatchObject({ reviewed: 1, imported: 1, promoted: 0, queuedForReview: 0, stale: 1 });
      expect(report.stale).toHaveLength(4);
      expect(count(db, "candidate_judgments")).toBe(4);
      expect(count(db, "annotations")).toBe(0);
      expect(count(db, "proposals")).toBe(0);
      expect(hashFile(join(fixture.root, "candidates.json"))).toBe(fixture.hashes.candidates);
      expect(hashFile(join(fixture.root, "review", "train-labels.json"))).toBe(fixture.hashes.labels);
      expect(hashFile(join(fixture.root, "review", "recall-audit.json"))).toBe(fixture.hashes.recall);
    } finally {
      db.close();
    }
  });
});
