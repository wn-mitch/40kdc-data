import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { initializeWorkbench, openWorkbench } from "../src/round5c/db.js";
import { applyAnnotationBatch, getDashboard, getPrivateExport } from "../src/round5c/review.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

function addAbility(db: DatabaseSync, abilityId: string, source: string): { id: number; sourceHash: string } {
  const sourceHash = hashJson({ text: source });
  const inserted = db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, sourceHash, source, abilityId,
    JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }]));
  return { id: Number(inserted.lastInsertRowid), sourceHash };
}

/** Confirm the exact phrase as a Hit re-roll and return the new annotation id. */
function confirmReroll(db: DatabaseSync, ability: { id: number; sourceHash: string }, source: string, phrase: string): number {
  const start = Buffer.byteLength(source.slice(0, source.indexOf(phrase)), "utf8");
  const batch = applyAnnotationBatch(db, { reviewer: "fixture-reviewer", decisions: [{
    action: "confirm", ability_version_id: ability.id, source_hash: ability.sourceHash, fragment: "RAW_TEXT",
    start_byte: start, end_byte: start + Buffer.byteLength(phrase, "utf8"), exact_text: phrase, role: "EFFECT",
    family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "all" },
  }] });
  const member = db.prepare("SELECT entity_id FROM batch_members WHERE batch_id = ? AND entity_kind = 'annotation'").get(batch.batch_id) as { entity_id: string };
  return Number(member.entity_id);
}

describe("Round 5C dashboard and private export", () => {
  it("reports unknown ratios as null when there is no current denominator", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      expect(getDashboard(db)).toMatchObject({
        total_source_records: 0,
        coverage: { average_leaf_fraction: null, average_human_leaf_fraction: null },
        human_actions_per_confirmed_occurrence: null,
        confirmations_per_batch: null,
      });
    } finally {
      db.close();
    }
  });

  it("counts review and undo batches as human decisions and exports only current annotations", () => {
    const db = new DatabaseSync(":memory:");
    initializeWorkbench(db);
    try {
      const source = "Fabricated drill. Re-roll Hit rolls.";
      const ability = addAbility(db, "drill", source);
      confirmReroll(db, ability, source, "Re-roll Hit rolls");
      db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('import-fixture', 'import-luna', 'system', ?)").run(new Date().toISOString());
      expect(getDashboard(db)).toMatchObject({ confirmed_occurrences: 1, human_decisions: 1, import_batches: 1 });
      const exported = getPrivateExport(db);
      expect(exported).toMatchObject({ schema_version: 2, kind: "round5c-private-current-state" });
      expect(exported.annotations).toEqual([expect.objectContaining({ authority_kind: "human", confirmed_by: "fixture-reviewer", family_id: "reroll" })]);
      for (const retired of ["stamps", "applications", "drafts", "escalations", "audits"]) expect(exported).not.toHaveProperty(retired);
    } finally {
      db.close();
    }
  });
});

describe("Round 5C stamp retirement", () => {
  /** The retired tables, reduced to the columns the one-time migration reads. */
  const LEGACY = `
    CREATE TABLE stamps (id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, definition_json TEXT NOT NULL, PRIMARY KEY(id, revision)) STRICT;
    CREATE TABLE stamp_applications (id TEXT PRIMARY KEY, stamp_id TEXT NOT NULL, stamp_revision INTEGER NOT NULL, annotation_id INTEGER, status TEXT NOT NULL) STRICT;
    CREATE TABLE stamp_evidence (stamp_id TEXT) STRICT;
    CREATE TABLE stamp_audit_decisions (id TEXT) STRICT;
    CREATE TABLE assembly_drafts (id TEXT) STRICT;
    CREATE TABLE escalations (id TEXT) STRICT;
    CREATE TABLE escalation_members (escalation_id TEXT) STRICT;
  `;

  it("keeps approved stamp leaves as ordinary annotations, retracts the rest, and runs once after a backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "round5c-retire-"));
    const path = join(directory, "workbench.sqlite");
    try {
      const sources = ["Fabricated one. Re-roll Hit rolls.", "Fabricated two. Re-roll Hit rolls.", "Fabricated three. Re-roll Hit rolls."];
      let db = openWorkbench(path);
      const [kept, dropped, human] = sources.map((source, index) => confirmReroll(db, addAbility(db, `fixture-${index}`, source), source, "Re-roll Hit rolls"));
      db.exec(LEGACY);
      const definition = { kind: "leaf", label: "fixture reroll", variants: [] };
      db.prepare("INSERT INTO stamps VALUES ('approved-leaf', 1, 'leaf', 'approved', ?), ('proposed-leaf', 1, 'leaf', 'proposed', '{}')").run(JSON.stringify(definition));
      db.prepare("INSERT INTO stamp_applications VALUES ('a1', 'approved-leaf', 1, ?, 'active'), ('a2', 'proposed-leaf', 1, ?, 'active')").run(kept!, dropped!);
      db.prepare("UPDATE annotations SET authority_kind = 'stamp', origin = 'canonical-stamp' WHERE id IN (?, ?)").run(kept!, dropped!);
      db.close();

      db = openWorkbench(path);
      const annotation = (id: number) => db.prepare("SELECT status, authority_kind, origin FROM annotations WHERE id = ?").get(id);
      expect(annotation(kept!)).toEqual({ status: "active", authority_kind: "human", origin: "migrated-stamp" });
      expect(annotation(dropped!)).toMatchObject({ status: "retracted" });
      expect(annotation(human!)).toEqual({ status: "active", authority_kind: "human", origin: "manual" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'stamp%' OR name LIKE 'escalation%' OR name = 'assembly_drafts')").all()).toEqual([]);
      const batch = db.prepare("SELECT metadata_json FROM annotation_batches WHERE operation = 'migration-retire-stamps'").all() as Array<{ metadata_json: string }>;
      expect(batch).toHaveLength(1);
      expect(JSON.parse(batch[0]!.metadata_json)).toEqual({ approved_leaf_stamps: [{ id: "approved-leaf", revision: 1, definition }] });
      db.close();

      // The pre-migration copy still holds the retired tables; reopening migrates nothing again.
      expect(existsSync(`${path}.pre5e`)).toBe(true);
      const backup = new DatabaseSync(`${path}.pre5e`);
      expect(backup.prepare("SELECT count(*) AS total FROM stamps").get()).toEqual({ total: 2 });
      backup.close();
      db = openWorkbench(path);
      expect(db.prepare("SELECT count(*) AS total FROM annotation_batches WHERE operation = 'migration-retire-stamps'").get()).toEqual({ total: 1 });
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
