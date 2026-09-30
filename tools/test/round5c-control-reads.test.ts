import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { validateFingerprint } from "../src/round5c/contracts.js";
import { frontier } from "../src/round5c/control-reads.js";
import { unsegmentedAbilities } from "../src/round5c/control-machine.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { refreshSources } from "../src/round5c/source.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
// Fabricated fixture prose only.
const CP = "gain 1CP";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(texts: string[]): DatabaseType {
  const root = mkdtempSync(join(tmpdir(), "round5c-reads-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(texts.map((raw_text, index) => ({ faction_id: "alpha", ability_id: `a${index}`, raw_text }))));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

function propose(db: DatabaseType, abilityId: string, amount: number): void {
  const ability = db.prepare("SELECT id, source_text FROM abilities WHERE ability_id = ?").get(abilityId) as { id: number; source_text: string };
  const start = Buffer.byteLength(ability.source_text.slice(0, ability.source_text.indexOf(CP)), "utf8");
  const span = insertSpan(db, ability.id, "RAW_TEXT", start, start + Buffer.byteLength(CP, "utf8"), CP);
  const fingerprint = validateFingerprint(db, "resource-action", { resource: "command-point", operation: "gain", amount }, 1, CP);
  db.prepare("INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at) VALUES (?, ?, 'EFFECT', 'luna', NULL, 'pending', '{}', NULL, 'x')").run(span, fingerprint);
}

describe("Round 5C control-plane reads", () => {
  it("weights a pending wording by the distinct texts it reaches times the share agreeing on one meaning", () => {
    // Three distinct texts; two proposals agree, one reads the amount differently; a fourth record
    // repeats the first text, so it adds an occurrence but no new text.
    const db = fixture([`First ${CP}.`, `Second ${CP}.`, `Third ${CP}.`, `First ${CP}.`]);
    try {
      propose(db, "a0", 1);
      propose(db, "a1", 1);
      propose(db, "a2", 2);
      propose(db, "a3", 1);
      const [item] = frontier(db, "wording", 5);
      expect(item).toMatchObject({ surface: CP.toLowerCase(), texts: 3, occurrences: 4, purity: 0.75, weight: 2.25, parameters: { amount: 1 } });
    } finally {
      db.close();
    }
  });

  it("picks unsegmented distinct texts shared by the most records first, skipping texts with a trusted leaf", () => {
    const db = fixture([`Lone ${CP}.`, `Shared ${CP}.`, `Shared ${CP}.`, `Decided ${CP}.`]);
    try {
      const id = (abilityId: string) => (db.prepare("SELECT id FROM abilities WHERE ability_id = ?").get(abilityId) as { id: number }).id;
      const decided = db.prepare("SELECT source_text FROM abilities WHERE ability_id = 'a3'").get() as { source_text: string };
      const start = Buffer.byteLength(decided.source_text.slice(0, decided.source_text.indexOf(CP)), "utf8");
      const span = insertSpan(db, id("a3"), "RAW_TEXT", start, start + Buffer.byteLength(CP, "utf8"), CP);
      const fingerprint = validateFingerprint(db, "resource-action", { resource: "command-point", operation: "gain", amount: 1 }, 1, CP);
      db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('b', 'review', 'will', 'x')").run();
      db.prepare("INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, created_at) VALUES (?, ?, 'active', 'manual', 'human', 'will', 'b', 'x')").run(span, fingerprint);
      expect(unsegmentedAbilities(db, 10)).toEqual([id("a1"), id("a0")]);
    } finally {
      db.close();
    }
  });
});
