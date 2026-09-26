import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { getWorkbenchRevision, initializeWorkbench } from "../src/round5c/db.js";
import { getFamilyCandidate, getOntology, judgeCandidate, mapCandidate, setCandidateState } from "../src/round5c/ontology.js";
import { backfillFamilyCandidates } from "../src/round5c/ontology-store.js";
import { importLuna, prepareLuna } from "../src/round5c/proposal.js";
import { applyAnnotationBatch, undoBatch } from "../src/round5c/review.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;
const REVIEWER = "fixture-reviewer";
// Fabricated fixture prose.
const NOVEL_TEXT = "gain a glimmer token";

let artifacts: string;
let previousArtifacts: string | undefined;
beforeEach(() => {
  previousArtifacts = process.env.ROUND5C_ARTIFACT_DIR;
  artifacts = mkdtempSync(join(tmpdir(), "round5c-ontology-"));
  process.env.ROUND5C_ARTIFACT_DIR = artifacts;
});
afterEach(() => {
  if (previousArtifacts === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
  else process.env.ROUND5C_ARTIFACT_DIR = previousArtifacts;
  rmSync(artifacts, { recursive: true, force: true });
});

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  return db;
}

function addAbility(db: DatabaseSync, abilityId: string, source: string): { id: number; hash: string; source: string } {
  const hash = hashJson({ text: source, abilityId });
  const id = Number(db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, hash, source, abilityId, JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source), text: source }])).lastInsertRowid);
  return { id, hash, source };
}

function bytes(source: string, text: string): { start_byte: number; end_byte: number; exact_text: string } {
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`Missing ${text}`);
  return { start_byte: Buffer.byteLength(source.slice(0, start)), end_byte: Buffer.byteLength(source.slice(0, start + text.length)), exact_text: text };
}

/** Import one offline v2 response that marks the novel clause NOVEL with a hypothesis. */
function importNovel(db: DatabaseSync, ability: { id: number; source: string }): void {
  const run = prepareLuna(db, { ability_version_id: ability.id });
  const request = run.request as { abilities: Array<{ faction_id: string; ability_id: string; source_hash: string }> };
  const clause = bytes(ability.source, NOVEL_TEXT);
  const token = bytes(ability.source, "glimmer token");
  importLuna(db, { run_id: run.run_id, response: {
    schema_version: 2, input_hash: run.input_hash, model: "external", model_version: "unknown", prompt_version: "v2",
    abilities: [{
      faction_id: request.abilities[0]!.faction_id, ability_id: request.abilities[0]!.ability_id, source_hash: request.abilities[0]!.source_hash,
      spans: [{ ...clause, role: "EFFECT", status: "NOVEL", hypothesis: { label: "token gain", distinction: "Adds a named token.", parameters: [{ name: "token", ...token }] } }],
      structural_spans: [], connectives: [], unresolved_regions: [],
    }],
  } });
}

function candidateId(db: DatabaseSync): number {
  return (db.prepare("SELECT id FROM family_candidates").get() as { id: number }).id;
}

describe("Round 5C provisional family ontology", () => {
  it("turns a Luna NOVEL leaf into one open candidate and a linked gap at once", () => {
    const db = database();
    try {
      const first = addAbility(db, "first", `Then ${NOVEL_TEXT}.`);
      const second = addAbility(db, "second", `Once, ${NOVEL_TEXT}.`);
      importNovel(db, first);
      importNovel(db, second);
      const ontology = getOntology(db);
      expect(ontology.candidates).toHaveLength(1);
      expect(ontology.candidates[0]).toMatchObject({ role: "EFFECT", label: "token gain", state: "open", parameter_hints: ["token"], current: { suggested: 2, supports: 0 } });
      expect(db.prepare(`
        SELECT count(*) AS total FROM gaps JOIN proposals ON proposals.id = gaps.proposal_id
        WHERE gaps.status = 'open' AND json_extract(proposals.reason_json, '$.span_status') = 'NOVEL'
      `).get()).toEqual({ total: 2 });
      expect(db.prepare("SELECT count(*) AS total FROM annotations").get()).toEqual({ total: 0 });
      expect(db.prepare("SELECT count(*) AS total FROM semantic_families WHERE status = 'active'").get()).toEqual({ total: 36 });
      // Backfill is idempotent over already-attached occurrences.
      backfillFamilyCandidates(db);
      expect(getOntology(db).candidates[0]!.current.suggested).toBe(2);
    } finally {
      db.close();
    }
  });

  it("records per-occurrence judgments, maps only supported current occurrences, and undoes each step", () => {
    const db = database();
    try {
      const first = addAbility(db, "first", `Then ${NOVEL_TEXT}.`);
      const second = addAbility(db, "second", `Once, ${NOVEL_TEXT}.`);
      importNovel(db, first);
      importNovel(db, second);
      const id = candidateId(db);
      const [a, b] = getFamilyCandidate(db, id).occurrences;
      expect(() => judgeCandidate(db, id, { evidence_id: a!.effective.evidence_id, verdict: "supports", explanation: "x", reviewer: REVIEWER, expected_revision: -1 }))
        .toThrow(expect.objectContaining({ status: 409 }));
      judgeCandidate(db, id, { evidence_id: a!.effective.evidence_id, verdict: "supports", explanation: "Same token mechanic.", reviewer: REVIEWER, expected_revision: getWorkbenchRevision(db) });
      const counter = judgeCandidate(db, id, { evidence_id: b!.effective.evidence_id, verdict: "counterexample", explanation: "Different lifetime.", reviewer: REVIEWER, expected_revision: getWorkbenchRevision(db) });
      expect(getFamilyCandidate(db, id).current).toMatchObject({ supports: 1, counterexample: 1, suggested: 0 });

      const body = (proposalId: number, familyId = "resource-action") => ({
        family_id: familyId, family_version: 1, reviewer: REVIEWER, expected_revision: getWorkbenchRevision(db),
        occurrences: [{ proposal_id: proposalId, parameters: { resource: { source: "glimmer token" }, operation: "gain", amount: 1 } }],
      });
      expect(() => mapCandidate(db, id, body(b!.proposal_id!))).toThrow(/no current human "supports"/u);
      expect(() => mapCandidate(db, id, body(a!.proposal_id!, "duration"))).toThrow(expect.objectContaining({ status: 422 }));
      expect(() => mapCandidate(db, id, body(a!.proposal_id!, "token-gain"))).toThrow(/maintainer code change/u);
      const family = getFamilyCandidate(db, id).promotion;
      expect(family.existing_families.map((item) => item.id)).toContain("resource-action");
      expect(family.new_family_steps[0]).toMatch(/REVIEWED_FAMILY_REGISTRY/u);

      const openGaps = (db.prepare("SELECT count(*) AS total FROM gaps WHERE status = 'open'").get() as { total: number }).total;
      const mapped = mapCandidate(db, id, body(a!.proposal_id!));
      expect(db.prepare("SELECT status, origin FROM proposals WHERE id = ?").get(mapped.proposals[0])).toEqual({ status: "pending", origin: "candidate-map" });
      // The original NOVEL proposal and its gap stay for their own human decision.
      expect(db.prepare("SELECT status FROM proposals WHERE id = ?").get(a!.proposal_id)).toEqual({ status: "pending" });
      expect(db.prepare("SELECT count(*) AS total FROM gaps WHERE status = 'open'").get()).toEqual({ total: openGaps });
      expect(db.prepare("SELECT count(*) AS total FROM annotations").get()).toEqual({ total: 0 });
      expect(getFamilyCandidate(db, id)).toMatchObject({ state: "mapped", mapped_family: { id: "resource-action", version: 1 } });
      expect(() => judgeCandidate(db, id, { evidence_id: a!.effective.evidence_id, verdict: "insufficient", explanation: "x", reviewer: REVIEWER, expected_revision: getWorkbenchRevision(db) })).not.toThrow();
      expect(() => undoBatch(db, mapped.batch_id, { reviewer: REVIEWER })).not.toThrow();
      expect(db.prepare("SELECT status FROM proposals WHERE id = ?").get(mapped.proposals[0])).toEqual({ status: "rejected" });
      expect(getFamilyCandidate(db, id).state).toBe("open");

      undoBatch(db, counter.batch_id, { reviewer: REVIEWER });
      expect(getFamilyCandidate(db, id).current).toMatchObject({ insufficient: 1, counterexample: 0, suggested: 1 });
    } finally {
      db.close();
    }
  });

  it("dismisses and reopens without losing evidence, and stales evidence when the source changes", () => {
    const db = database();
    try {
      const first = addAbility(db, "first", `Then ${NOVEL_TEXT}.`);
      importNovel(db, first);
      const id = candidateId(db);
      const dismissed = setCandidateState(db, id, { state: "dismissed", reviewer: REVIEWER, expected_revision: getWorkbenchRevision(db) });
      expect(getFamilyCandidate(db, id)).toMatchObject({ state: "dismissed", current: { suggested: 1 } });
      undoBatch(db, dismissed.batch_id, { reviewer: REVIEWER });
      expect(getFamilyCandidate(db, id).state).toBe("open");

      db.prepare("UPDATE abilities SET current = 0").run();
      const view = getFamilyCandidate(db, id);
      expect(view).toMatchObject({ current: { suggested: 0 }, stale: 1 });
      expect(() => judgeCandidate(db, id, { evidence_id: view.occurrences[0]!.effective.evidence_id, verdict: "supports", explanation: "x", reviewer: REVIEWER, expected_revision: getWorkbenchRevision(db) }))
        .toThrow(/source changed/u);
    } finally {
      db.close();
    }
  });

  it("records a manual novel decision as a candidate suggestion that undo revokes", () => {
    const db = database();
    try {
      const ability = addAbility(db, "manual", `Then ${NOVEL_TEXT}.`);
      const batch = applyAnnotationBatch(db, { reviewer: REVIEWER, decisions: [{
        action: "novel", ability_version_id: ability.id, source_hash: ability.hash, fragment: "RAW_TEXT", ...bytes(ability.source, NOVEL_TEXT), role: "EFFECT",
      }] });
      expect(getOntology(db).candidates[0]).toMatchObject({ current: { suggested: 1 } });
      undoBatch(db, batch.batch_id, { reviewer: REVIEWER });
      expect(getOntology(db).candidates[0]).toMatchObject({ current: { suggested: 0 } });
    } finally {
      db.close();
    }
  });
});
