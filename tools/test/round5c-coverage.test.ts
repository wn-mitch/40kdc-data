import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { validateFingerprint } from "../src/round5c/contracts.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { applyAnnotationBatch, undoBatch } from "../src/round5c/review.js";
type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

function insertAbility(db: DatabaseSync, source: string): { abilityId: number; sourceHash: string } {
  const sourceHash = hashJson({ text: source });
  const result = db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', 'connective-coverage', ?, ?, 'unit', 'fixture', 'Fixture', '{}', ?, 1)
  `).run(
    sourceHash,
    source,
    JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }]),
  );
  return { abilityId: Number(result.lastInsertRowid), sourceHash };
}
describe("Round 5C connective coverage", () => {
  it("excludes only a human-accepted UTF-8 connective and restores it on undo", () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializeWorkbench(db);
      const source = "é and act.";
      const { abilityId, sourceHash } = insertAbility(db, source);
      const connectiveStart = Buffer.byteLength("é ", "utf8");
      const connectiveEnd = connectiveStart + Buffer.byteLength("and", "utf8");
      const effectStart = Buffer.byteLength("é and ", "utf8");
      const effectEnd = effectStart + Buffer.byteLength("act", "utf8");

      expect({ connectiveStart, connectiveEnd, effectStart, effectEnd }).toEqual({
        connectiveStart: 3,
        connectiveEnd: 6,
        effectStart: 7,
        effectEnd: 10,
      });

      const connectiveSpanId = insertSpan(db, abilityId, "RAW_TEXT", connectiveStart, connectiveEnd, "and");
      const connectiveProposalId = Number(db.prepare(`
        INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
        VALUES (?, NULL, 'CONNECTIVE', 'luna', NULL, 'pending', '{"kind":"and"}', 1, '2026-01-01T00:00:00.000Z')
      `).run(connectiveSpanId).lastInsertRowid);

      const effectSpanId = insertSpan(db, abilityId, "RAW_TEXT", effectStart, effectEnd, "act");
      const fingerprintId = validateFingerprint(db, "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }, 2, "act");
      db.prepare(`
        INSERT INTO annotation_batches (id, operation, reviewer, created_at)
        VALUES ('human-review', 'review', 'reviewer', '2026-01-01T00:00:00.000Z')
      `).run();
      db.prepare(`
        INSERT INTO annotations (span_id, fingerprint_id, status, origin, confirmed_by, batch_id, supersedes_id, created_at)
        VALUES (?, ?, 'active', 'manual', 'reviewer', 'human-review', NULL, '2026-01-01T00:00:00.000Z')
      `).run(effectSpanId, fingerprintId);

      const pending = getAbilityCoverage(db, abilityId);
      expect(pending.leaf_fraction).toBeCloseTo(3 / 8);
      expect(pending.human_leaf_fraction).toBeCloseTo(pending.leaf_fraction);
      expect(pending.stamp_leaf_fraction).toBe(0);
      expect(pending.proposal_fraction).toBe(0);
      expect(pending.uncovered.some((interval) => interval.text.includes("and"))).toBe(true);

      const confirmed = applyAnnotationBatch(db, {
        reviewer: "reviewer",
        decisions: [{
          action: "confirm-connective",
          proposal_id: connectiveProposalId,
          ability_version_id: abilityId,
          source_hash: sourceHash,
          fragment: "RAW_TEXT",
          start_byte: connectiveStart,
          end_byte: connectiveEnd,
          exact_text: "and",
          role: "CONNECTIVE",
        }],
      });
      const accepted = getAbilityCoverage(db, abilityId);
      expect(accepted.leaf_fraction).toBeCloseTo(3 / 5);
      expect(accepted.human_leaf_fraction).toBeCloseTo(accepted.leaf_fraction);
      expect(accepted.stamp_leaf_fraction).toBe(0);
      expect(accepted.proposal_fraction).toBe(0);
      expect(accepted.uncovered.some((interval) => interval.text.includes("and"))).toBe(false);

      undoBatch(db, confirmed.batch_id, { reviewer: "reviewer" });
      const undone = getAbilityCoverage(db, abilityId);
      expect(undone.leaf_fraction).toBeCloseTo(pending.leaf_fraction);
      expect(undone.proposal_fraction).toBe(pending.proposal_fraction);
      expect(undone.uncovered.some((interval) => interval.text.includes("and"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
