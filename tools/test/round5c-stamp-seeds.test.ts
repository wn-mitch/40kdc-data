import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StampDefinition } from "../src/round5c/contracts.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { proposeLexical, retrieveFamilyCandidates } from "../src/round5c/retrieval.js";
import { applyAnnotationBatch } from "../src/round5c/review.js";
import { refreshSources } from "../src/round5c/source.js";
import { assertRequiredOutput, confirmAndProposeLiteralStamp, escalateLiteralStamp } from "../src/round5c/stamp-seeds.js";
import { approveStamp, previewStamp, proposeLiteralStamp } from "../src/round5c/stamps.js";
import { importWork, prepareWork } from "../src/round5c/work.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;
const REVIEWER = "fixture-reviewer";
// Fabricated fixture prose.
const TEXT = "Re-roll a Hit roll of 1";

const roots: string[] = [];
let previousArtifacts: string | undefined;
beforeEach(() => {
  previousArtifacts = process.env.ROUND5C_ARTIFACT_DIR;
  const directory = mkdtempSync(join(tmpdir(), "round5c-seeds-artifacts-"));
  roots.push(directory);
  process.env.ROUND5C_ARTIFACT_DIR = directory;
});
afterEach(() => {
  if (previousArtifacts === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
  else process.env.ROUND5C_ARTIFACT_DIR = previousArtifacts;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(records: Array<{ id: string; faction_id: string; raw_text: string }>): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "round5c-seeds-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

function confirmSeed(db: DatabaseSync, abilityId: string): number {
  const row = db.prepare("SELECT id, source_hash FROM abilities WHERE ability_id = ? AND current = 1").get(abilityId) as { id: number; source_hash: string };
  const batch = applyAnnotationBatch(db, { reviewer: REVIEWER, decisions: [{
    action: "confirm", ability_version_id: row.id, source_hash: row.source_hash, fragment: "RAW_TEXT",
    start_byte: 0, end_byte: Buffer.byteLength(TEXT), exact_text: TEXT, role: "EFFECT",
    family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "ones" },
  }] });
  return Number((db.prepare("SELECT entity_id FROM batch_members WHERE batch_id = ? AND entity_kind = 'annotation'").get(batch.batch_id) as { entity_id: string }).entity_id);
}

describe("Round 5C reusable-family stamp seeds", () => {
  it("confirms one of more than 30 pending occurrences as a seed and previews every corpus match beyond the first page", () => {
    const db = fixture([
      { id: "aa-seed", faction_id: "alpha", raw_text: `${TEXT}.` },
      ...Array.from({ length: 34 }, (_, index) => ({ id: `hit-${String(index).padStart(2, "0")}`, faction_id: "alpha", raw_text: `${TEXT}.` })),
    ]);
    try {
      confirmSeed(db, "aa-seed");
      proposeLexical(db);
      const firstPage = retrieveFamilyCandidates(db, "reroll", { limit: 20 });
      const group = firstPage.groups[0]!;
      expect(group.count).toBe(34);
      expect(group.occurrences.length).toBeLessThan(34);
      const seedId = (db.prepare("SELECT id FROM annotations WHERE status = 'active'").get() as { id: number }).id;
      expect(group.stamp_seed_annotation_id).toBe(seedId);

      const occurrence = group.occurrences[0]!;
      const source = db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(occurrence.ability_version_id) as { source_hash: string };
      const created = confirmAndProposeLiteralStamp(db, { reviewer: REVIEWER, decision: {
        action: "confirm", proposal_id: occurrence.proposal_id, ability_version_id: occurrence.ability_version_id,
        source_hash: source.source_hash, fragment: occurrence.fragment, start_byte: occurrence.start_byte, end_byte: occurrence.end_byte,
        exact_text: occurrence.exact_text, role: occurrence.role,
      } });
      expect(created).toMatchObject({ stamp_id: expect.stringMatching(/^stamp_/u), revision: 1 });
      const preview = previewStamp(db, created.stamp_id, created.revision);
      // Totals are corpus-wide: the two human seeds are already satisfied; every other occurrence is eligible.
      expect(preview.totals).toEqual({ eligible: 33, already_satisfied: 2, blocked: 0 });
      expect(preview.examples.length).toBeLessThan(35);
      expect(preview.next_cursor).not.toBeNull();
      const approved = approveStamp(db, created.stamp_id, created.revision, { reviewer: REVIEWER, preview_hash: preview.preview_hash });
      expect(approved.applied).toBe(33);
    } finally {
      db.close();
    }
  });

  it("escalates a literal with no eligible match to a model rule constrained to its exact reviewed output", () => {
    const db = fixture([{ id: "lonely", faction_id: "alpha", raw_text: `${TEXT}.` }]);
    try {
      const seed = confirmSeed(db, "lonely");
      const stamp = proposeLiteralStamp(db, { annotation_id: seed, reviewer: REVIEWER });
      expect(previewStamp(db, stamp.stamp_id, stamp.revision).totals.eligible).toBe(0);
      const { escalation_id } = escalateLiteralStamp(db, stamp.stamp_id, stamp.revision);
      const question = JSON.parse((db.prepare("SELECT reason_code, question_json FROM escalations WHERE id = ?").get(escalation_id) as { question_json: string }).question_json);
      expect(question).toMatchObject({ path: "literal-stamp-generalization", required_output: { family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "ones" } } });

      const leaf = (familyId: string, parameters: Record<string, unknown>): StampDefinition => ({
        schema_version: 1, kind: "leaf", label: "generalized",
        variants: [{ id: "exact", source_types: "any", fragments: [{ fragment: "RAW_TEXT", segments: [{ id: "form", literal: "re-roll a hit roll of 1" }] }], slots: {},
          before: [{ boundary: "fragment" }], after: [{ boundary: "fragment" }], output: { family_id: familyId, family_version: 1, parameters }, allow_containment: [] }],
      }) as StampDefinition;
      expect(() => assertRequiredOutput(leaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }), question.required_output)).toThrow(/not the required reroll@1/u);
      expect(() => assertRequiredOutput(leaf("reroll", { roll: "hit", subset: "all" }), question.required_output)).toThrow(/changes the required reviewed parameters/u);
      expect(() => assertRequiredOutput(leaf("reroll", { roll: "hit", subset: "ones" }), question.required_output)).not.toThrow();

      // The same guard runs when a model's propose-rule result is imported for this escalation.
      const prepared = prepareWork(db, { purpose: "propose-rule", ids: [escalation_id] });
      const item = prepared.request.items[0]! as unknown as { item_id: string; evidence_hash: string; sources: Array<{ ability_version_id: number; source_hash: string }>; escalation: { members: Array<{ member_id: string }> } };
      const source = item.sources[0]!;
      const report = importWork(db, { run_id: prepared.run_id, response: {
        schema_version: 1, run_id: prepared.run_id, input_hash: prepared.input_hash, model: "fixture", model_version: "fixture", prompt_version: "round5c-work/v1",
        items: [{ item_id: item.item_id, evidence_hash: item.evidence_hash, result: {
          definition: leaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }),
          positives: [{ ability_version_id: source.ability_version_id, source_hash: source.source_hash, fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(TEXT), exact_text: TEXT }],
          counterexamples: [], closest_stamp_ids: [], exact_mismatch: "none", question: "?", affected_member_ids: item.escalation.members.map((member) => member.member_id),
        } }],
      } });
      expect(report).toMatchObject({ imported: 0, failed: 1 });
      expect(report.items[0]!.reason).toMatch(/not the required reroll@1/u);
    } finally {
      db.close();
    }
  });
});
