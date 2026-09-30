import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { humanActor } from "../src/round5c/authority.js";
import { validateFingerprint } from "../src/round5c/contracts.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { applyAnnotationBatch } from "../src/round5c/review.js";
import { refreshSources } from "../src/round5c/source.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const WILL = humanActor("will", "test");
// Fabricated fixture prose only.
const TEXT = "an unmodified Hit roll of 5+ scores a Critical Hit";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { db: DatabaseType; id: number; hash: string } {
  const root = mkdtempSync(join(tmpdir(), "round5c-placeholder-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify([{ faction_id: "alpha", ability_id: "crit", raw_text: `${TEXT}.` }]));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  const ability = db.prepare("SELECT id, source_hash FROM abilities WHERE ability_id = 'crit'").get() as { id: number; source_hash: string };
  return { db, id: ability.id, hash: ability.source_hash };
}

describe("Round 5C unresolved placeholders", () => {
  it("does not count an imported placeholder leaf as resolved source, and refuses a new decision holding one", () => {
    const { db, id, hash } = fixture();
    try {
      // An imported leaf as the hit-train migration wrote it.
      const span = insertSpan(db, id, "RAW_TEXT", 0, Buffer.byteLength(TEXT), TEXT);
      const placeholder = validateFingerprint(db, "critical-hit-threshold", { value: "source" }, 1, TEXT);
      db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('legacy', 'review', 'will', 'x')").run();
      db.prepare("INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, created_at) VALUES (?, ?, 'active', 'hit-train', 'human', 'will', 'legacy', 'x')").run(span, placeholder);
      expect(getAbilityCoverage(db, id).leaf_bytes.numerator).toBe(0);

      const decision = (parameters: Record<string, unknown>) => ({
        reviewer: "will", decisions: [{ action: "confirm", ability_version_id: id, source_hash: hash, fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(TEXT), exact_text: TEXT, role: "EFFECT", family_id: "critical-hit-threshold", parameters }],
      });
      expect(() => applyAnnotationBatch(db, decision({ value: "source" }), WILL)).toThrow(/placeholder "source"/u);
    } finally {
      db.close();
    }
  });
});
