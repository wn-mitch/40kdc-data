import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { hashJson } from "../src/canonical-hash.js";
import { initializeWorkbench, openWorkbench } from "../src/semantic-authoring/db.js";
import { getDashboard, getPrivateExport } from "../src/semantic-authoring/review.js";
import { applyAnnotationBatch } from "./semantic-authoring-human.js";
import { currentFamilyVersion } from "../src/semantic-authoring/contracts.js";

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
    family_id: "reroll", family_version: currentFamilyVersion("reroll"), parameters: { roll: "hit", subset: "all", weapon_type: "all" },
  }] });
  const member = db.prepare("SELECT entity_id FROM batch_members WHERE batch_id = ? AND entity_kind = 'annotation'").get(batch.batch_id) as { entity_id: string };
  return Number(member.entity_id);
}

describe("Semantic authoring dashboard and private export", () => {
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
