import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { validateFingerprint } from "../src/round5c/contracts.js";
import { insertSpan, initializeWorkbench } from "../src/round5c/db.js";
import { getFrontier, proposeLexical, retrieveFamilyCandidates } from "../src/round5c/retrieval.js";
import { applyAnnotationBatch, undoBatch } from "../src/round5c/review.js";
import { refreshSources } from "../src/round5c/source.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Ability = { id: number; source_text: string; source_hash: string; fragments_json: string };
type RecordFixture = { id: string; raw_text: string };

function fixture(records: RecordFixture[]): { db: DatabaseSync; root: string } {
  const root = mkdtempSync(join(tmpdir(), "round5c-retrieval-"));
  temporaryRoots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return { db, root };
}

function ability(db: DatabaseSync, abilityId: string): Ability {
  const row = db.prepare(`
    SELECT id, source_text, source_hash, fragments_json
    FROM abilities WHERE current = 1 AND ability_id = ?
  `).get(abilityId) as Ability | undefined;
  if (!row) throw new Error(`Fixture ability ${abilityId} is absent.`);
  return row;
}

function spanFor(source: string, exactText: string): { start: number; end: number } {
  const start = source.indexOf(exactText);
  if (start < 0) throw new Error(`Fixture span ${exactText} is absent.`);
  return {
    start: Buffer.byteLength(source.slice(0, start), "utf8"),
    end: Buffer.byteLength(source.slice(0, start + exactText.length), "utf8"),
  };
}

function confirmReroll(db: DatabaseSync, abilityId: string, subset: "ones" | "failed" = "ones"): number {
  const target = ability(db, abilityId);
  const exactText = "Re-roll a Hit roll of 1";
  const span = spanFor(target.source_text, exactText);
  const spanId = insertSpan(db, target.id, "RAW_TEXT", span.start, span.end, exactText);
  const fingerprintId = validateFingerprint(db, "reroll", { roll: "hit", subset, weapon_type: "all" }, 2, exactText);
  const batchId = `seed-${abilityId}`;
  db.prepare(`
    INSERT INTO annotation_batches (id, operation, reviewer, created_at)
    VALUES (?, 'fixture', 'reviewer', '2026-01-01T00:00:00.000Z')
  `).run(batchId);
  const annotation = db.prepare(`
    INSERT INTO annotations (span_id, fingerprint_id, status, origin, confirmed_by, batch_id, supersedes_id, created_at)
    VALUES (?, ?, 'active', 'fixture', 'reviewer', ?, NULL, '2026-01-01T00:00:00.000Z')
  `).run(spanId, fingerprintId, batchId);
  return Number(annotation.lastInsertRowid);
}

function insertUnresolved(db: DatabaseSync, abilityId: string, exactText: string): number {
  const target = ability(db, abilityId);
  const span = spanFor(target.source_text, exactText);
  const spanId = insertSpan(db, target.id, "RAW_TEXT", span.start, span.end, exactText);
  const proposal = db.prepare(`
    INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
    VALUES (?, NULL, 'UNRESOLVED', 'fixture', 'unresolved', '{"kind":"fixture"}', NULL, '2026-01-01T00:00:00.000Z')
  `).run(spanId);
  return Number(proposal.lastInsertRowid);
}

describe("Round 5C lexical Family Mode retrieval", () => {
  it("materializes one pending, source-bound retrieval proposal per occurrence with prototype provenance", () => {
    const value = fixture([
      { id: "prototype", raw_text: "Re-roll a Hit roll of 1." },
      { id: "leading", raw_text: "While leading a unit, Re-roll a Hit roll of 1." },
      { id: "damaged", raw_text: "Below Starting Strength, Re-roll a Hit roll of 1." },
    ]);
    try {
      const prototypeId = confirmReroll(value.db, "prototype");
      expect(proposeLexical(value.db)).toMatchObject({ created: 2 });

      const page = retrieveFamilyCandidates(value.db, "reroll");
      const occurrences = page.groups.flatMap((group) => group.occurrences);
      expect(occurrences).toHaveLength(2);
      expect(new Set(occurrences.map((occurrence) => occurrence.ability_id))).toEqual(new Set(["leading", "damaged"]));
      expect(page.groups).toHaveLength(1);
      expect(page.groups[0]?.context_count).toBe(2);
      expect(new Set(occurrences.map((occurrence) => occurrence.context_signature)).size).toBe(2);
      expect(page.progress).toEqual({ reviewed: 0, total: 2 });
      expect(occurrences.every((occurrence) => occurrence.exact_text === "Re-roll a Hit roll of 1")).toBe(true);
      expect(occurrences.every((occurrence) => occurrence.family_id === "reroll" && occurrence.role === "EFFECT")).toBe(true);
      expect(occurrences.map((occurrence) => occurrence.parameters)).toEqual([
        { roll: "hit", subset: "ones", weapon_type: "all" }, { roll: "hit", subset: "ones", weapon_type: "all" },
      ]);
      expect(occurrences.every((occurrence) => occurrence.fingerprint_id.length > 0)).toBe(true);

      const provenance = value.db.prepare(`
        SELECT proposals.reason_json, proposals.origin, abilities.source_hash
        FROM proposals
        JOIN source_spans ON source_spans.id = proposals.span_id
        JOIN abilities ON abilities.id = source_spans.ability_version_id
        WHERE proposals.origin = 'retrieval'
        ORDER BY proposals.id
        LIMIT 1
      `).get() as { reason_json: string; origin: string; source_hash: string };
      expect(provenance.origin).toBe("retrieval");
      expect(JSON.parse(provenance.reason_json)).toEqual(expect.objectContaining({
        algorithm: "round5c/lexical-fts5/v1",
        prototype_annotation_id: prototypeId,
        source_hash: provenance.source_hash,
        match: "exact-normalized-surface",
      }));
    } finally {
      value.db.close();
    }
  });

  it("tracks accepted and rejected current candidates and reverses review progress on undo", () => {
    const value = fixture([
      { id: "prototype", raw_text: "Re-roll a Hit roll of 1." },
      { id: "leading", raw_text: "While leading a unit, Re-roll a Hit roll of 1." },
      { id: "damaged", raw_text: "Below Starting Strength, Re-roll a Hit roll of 1." },
    ]);
    try {
      confirmReroll(value.db, "prototype");
      proposeLexical(value.db);
      const [first, second] = retrieveFamilyCandidates(value.db, "reroll").groups[0]!.occurrences;
      const sourceDecision = (item: typeof first) => ({
        proposal_id: item.proposal_id, ability_version_id: item.ability_version_id,
        source_hash: item.source_hash, fragment: item.fragment, start_byte: item.start_byte,
        end_byte: item.end_byte, exact_text: item.exact_text, role: item.role,
      });
      const accepted = applyAnnotationBatch(value.db, { reviewer: "fixture-reviewer", decisions: [{
        ...sourceDecision(first), action: "confirm", family_id: first.family_id,
        family_version: first.family_version, parameters: first.parameters,
      }] });
      expect(retrieveFamilyCandidates(value.db, "reroll").progress).toEqual({ reviewed: 1, total: 2 });
      const rejected = applyAnnotationBatch(value.db, { reviewer: "fixture-reviewer", decisions: [{
        ...sourceDecision(second), action: "reject",
      }] });
      const done = retrieveFamilyCandidates(value.db, "reroll");
      expect(done.progress).toEqual({ reviewed: 2, total: 2 });
      expect(done.groups).toEqual([]);
      undoBatch(value.db, rejected.batch_id, { reviewer: "fixture-reviewer" });
      expect(retrieveFamilyCandidates(value.db, "reroll").progress).toEqual({ reviewed: 1, total: 2 });
      undoBatch(value.db, accepted.batch_id, { reviewer: "fixture-reviewer" });
      expect(retrieveFamilyCandidates(value.db, "reroll").progress).toEqual({ reviewed: 0, total: 2 });
    } finally {
      value.db.close();
    }
  });

  it("returns the exact source slice for highlighting the selected occurrence, not an earlier identical phrase", () => {
    const phrase = "Re-roll a Hit roll of 1";
    const source = `Ω ${phrase}.\nLater ${phrase}.`;
    const value = fixture([
      { id: "prototype", raw_text: `${phrase}.` },
      { id: "candidate", raw_text: source },
    ]);
    try {
      confirmReroll(value.db, "prototype");
      const candidate = ability(value.db, "candidate");
      const start = Buffer.byteLength(source.slice(0, source.lastIndexOf(phrase)), "utf8");
      const spanId = insertSpan(value.db, candidate.id, "RAW_TEXT", start, start + Buffer.byteLength(phrase), phrase);
      const fingerprintId = validateFingerprint(value.db, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }, 2, phrase);
      value.db.prepare(`INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
        VALUES (?, ?, 'EFFECT', 'retrieval', 'pending', '{}', 1, '2026-01-01T00:00:00.000Z')`).run(spanId, fingerprintId);

      const [occurrence] = retrieveFamilyCandidates(value.db, "reroll").groups.flatMap((group) => group.occurrences);
      expect(occurrence.context).toBe(source);
      expect(occurrence.context.slice(occurrence.context_start, occurrence.context_end)).toBe(phrase);
      expect(occurrence.context.slice(0, occurrence.context_start)).toBe(`Ω ${phrase}.\nLater `);
    } finally {
      value.db.close();
    }
  });

  it("never groups different reviewed parameter sets under one approval control", () => {
    const value = fixture([
      { id: "prototype", raw_text: "Re-roll a Hit roll of 1." },
      { id: "candidate", raw_text: "Re-roll a Hit roll of 1." },
    ]);
    try {
      confirmReroll(value.db, "prototype", "ones");
      expect(proposeLexical(value.db).created).toBe(1);
      const candidate = ability(value.db, "candidate");
      const exactText = "Re-roll a Hit roll of 1";
      const span = spanFor(candidate.source_text, exactText);
      const spanId = insertSpan(value.db, candidate.id, "RAW_TEXT", span.start, span.end, exactText);
      const otherFingerprint = validateFingerprint(value.db, "reroll", { roll: "hit", subset: "failed", weapon_type: "all" }, 2, exactText);
      value.db.prepare(`INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
        VALUES (?, ?, 'EFFECT', 'retrieval', 'pending', '{}', 1, '2026-01-01T00:00:00.000Z')`).run(spanId, otherFingerprint);
      const page = retrieveFamilyCandidates(value.db, "reroll");
      const candidateGroups = page.groups.filter((group) => group.occurrences.some((entry) => entry.ability_id === "candidate"));
      expect(candidateGroups).toHaveLength(2);
      expect(new Set(candidateGroups.map((group) => group.occurrences[0]!.fingerprint_id)).size).toBe(2);
      expect(new Set(candidateGroups.map((group) => group.occurrences[0]!.parameters.subset))).toEqual(new Set(["ones", "failed"]));
    } finally {
      value.db.close();
    }
  });

  it("does not recreate a reviewer-rejected lexical occurrence", () => {
    const value = fixture([
      { id: "prototype", raw_text: "Re-roll a Hit roll of 1." },
      { id: "candidate", raw_text: "Re-roll a Hit roll of 1 while this unit is leading." },
    ]);
    try {
      confirmReroll(value.db, "prototype");
      expect(proposeLexical(value.db).created).toBe(1);
      value.db.prepare("UPDATE proposals SET status = 'rejected' WHERE origin = 'retrieval'").run();
      expect(proposeLexical(value.db).created).toBe(0);
      expect(value.db.prepare("SELECT count(*) AS count FROM proposals WHERE origin = 'retrieval'").get()).toEqual({ count: 1 });
    } finally {
      value.db.close();
    }
  });

  it("keeps visually different contexts separate when source chunks have the same signature", () => {
    const value = fixture([
      { id: "prototype", raw_text: "Re-roll a Hit roll of 1." },
      { id: "leading", raw_text: "While leading a unit, Re-roll a Hit roll of 1." },
      { id: "damaged", raw_text: "Below Starting Strength, Re-roll a Hit roll of 1." },
    ]);
    try {
      confirmReroll(value.db, "prototype");
      expect(proposeLexical(value.db).created).toBe(2);
      value.db.prepare(`
        UPDATE source_chunks SET normalized_text = 'same extracted clause'
        WHERE ability_version_id IN (SELECT id FROM abilities WHERE ability_id IN ('leading', 'damaged'))
      `).run();
      const page = retrieveFamilyCandidates(value.db, "reroll");
      const occurrences = page.groups.flatMap((group) => group.occurrences);
      expect(new Set(occurrences.map((occurrence) => occurrence.context_signature)).size).toBe(1);
      expect(page.groups[0]?.context_count).toBe(2);
    } finally {
      value.db.close();
    }
  });

  it("keeps distinct contexts visible under one fingerprint group across bounded pages", () => {
    const candidates = Array.from({ length: 32 }, (_, index) => ({
      id: `candidate-${index}`,
      raw_text: `Context qualifier ${index} while active Re-roll a Hit roll of 1.`,
    }));
    const value = fixture([{ id: "prototype", raw_text: "Re-roll a Hit roll of 1." }, ...candidates]);
    try {
      confirmReroll(value.db, "prototype");
      expect(proposeLexical(value.db).created).toBe(32);
      const first = retrieveFamilyCandidates(value.db, "reroll", { limit: 10 });
      const firstOccurrences = first.groups.flatMap((group) => group.occurrences);
      expect(firstOccurrences).toHaveLength(10);
      expect(first.groups).toHaveLength(1);
      expect(first.groups[0]?.context_count).toBe(32);
      expect(first.groups[0]?.count).toBe(32);
      expect(first.progress).toEqual({ reviewed: 0, total: 32 });
      expect(first.next_cursor).not.toBeNull();
      expect(first.groups.every((group) => group.signature.includes("\u0000"))).toBe(true);

      const second = retrieveFamilyCandidates(value.db, "reroll", { limit: 10, cursor: first.next_cursor! });
      const secondOccurrences = second.groups.flatMap((group) => group.occurrences);
      expect(secondOccurrences).toHaveLength(10);
      expect(new Set([...firstOccurrences, ...secondOccurrences].map((occurrence) => occurrence.proposal_id)).size).toBe(20);
      expect(second.groups).toHaveLength(1);
      expect(second.groups[0]?.context_count).toBe(32);
    } finally {
      value.db.close();
    }
  });

  it("never returns proposals attached to a retired source version", () => {
    const value = fixture([
      { id: "prototype", raw_text: "Re-roll a Hit roll of 1." },
      { id: "changed", raw_text: "Re-roll a Hit roll of 1 while leading a unit." },
      { id: "current", raw_text: "Re-roll a Hit roll of 1 while below Starting Strength." },
    ]);
    try {
      confirmReroll(value.db, "prototype");
      expect(proposeLexical(value.db).created).toBe(2);
      expect(retrieveFamilyCandidates(value.db, "reroll").progress).toEqual({ reviewed: 0, total: 2 });
      writeFileSync(join(value.root, "fixture.json"), JSON.stringify([
        { id: "prototype", raw_text: "Re-roll a Hit roll of 1." },
        { id: "changed", raw_text: "This source version no longer contains the mechanic." },
        { id: "current", raw_text: "Re-roll a Hit roll of 1 while below Starting Strength." },
      ]));
      refreshSources(value.db, value.root);

      const page = retrieveFamilyCandidates(value.db, "reroll");
      const occurrences = page.groups.flatMap((group) => group.occurrences);
      expect(occurrences.map((occurrence) => occurrence.ability_id)).toEqual(["current"]);
      expect(page.progress).toEqual({ reviewed: 0, total: 1 });
      expect(occurrences[0]!.source_hash).toBe(ability(value.db, "current").source_hash);
    } finally {
      value.db.close();
    }
  });

  it("clusters only repeated unannotated unknowns and surfaces corrected conflicts before low coverage", () => {
    const value = fixture([
      { id: "known", raw_text: "Re-roll a Hit roll of 1." },
      { id: "unknown-one", raw_text: "Mystery wording." },
      { id: "unknown-two", raw_text: "Mystery wording." },
    ]);
    try {
      confirmReroll(value.db, "known");
      insertUnresolved(value.db, "known", "Re-roll a Hit roll of 1");
      insertUnresolved(value.db, "unknown-one", "Mystery wording");
      insertUnresolved(value.db, "unknown-two", "Mystery wording");
      const known = ability(value.db, "known");
      const knownSpan = spanFor(known.source_text, "Re-roll a Hit roll of 1");
      const fingerprintId = validateFingerprint(value.db, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }, 2, "Re-roll a Hit roll of 1");
      const spanId = insertSpan(value.db, known.id, "RAW_TEXT", knownSpan.start, knownSpan.end, "Re-roll a Hit roll of 1");
      const corrected = value.db.prepare(`
        INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
        VALUES (?, ?, 'EFFECT', 'fixture', 'corrected', '{"kind":"corrected"}', NULL, '2026-01-01T00:00:00.000Z')
      `).run(spanId, fingerprintId);

      const frontier = getFrontier(value.db);
      expect(frontier.clusters).toEqual([expect.objectContaining({ signature: "mystery wording", count: 2 })]);
      expect(frontier.conflicts).toContainEqual(expect.objectContaining({ proposal_id: Number(corrected.lastInsertRowid), ability_version_id: known.id }));
      expect(frontier.abilities).toHaveLength(3);
    } finally {
      value.db.close();
    }
  });
});
