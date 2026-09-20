import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { getCompositionQueue, reviewAbilities } from "../src/round5c/composition-queue.js";
import { openWorkbench } from "../src/round5c/db.js";
import { applyAnnotationBatch, getAbility } from "../src/round5c/review.js";
import { startWorkJob, workJobView } from "../src/round5c/work-jobs.js";
import type { WorkImportReport } from "../src/round5c/work.js";

// Fabricated fixture prose; every meaningful byte is one reviewed leaf.
const TEXT = "Re-roll a Hit roll of 1";
const REVIEWER = "fixture-reviewer";

let root: string;
let path: string;
let previousKey: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "round5c-compose-"));
  path = join(root, "workbench.sqlite");
  previousKey = process.env.DEEPSEEK_API_KEY;
});
afterEach(() => {
  if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = previousKey;
  rmSync(root, { recursive: true, force: true });
});

function readyAbility(db: DatabaseSync, abilityId: string): number {
  const source = `${TEXT}.`;
  const hash = hashJson({ source, abilityId });
  const id = Number(db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, hash, source, abilityId, JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source), text: source }])).lastInsertRowid);
  applyAnnotationBatch(db, { reviewer: REVIEWER, decisions: [{
    action: "confirm", ability_version_id: id, source_hash: hash, fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(TEXT),
    exact_text: TEXT, role: "EFFECT", family_id: "reroll", family_version: 1, parameters: { roll: "hit", subset: "ones" },
  }] });
  return id;
}

describe("Round 5C composition queue", () => {
  it("opens file databases in WAL mode so reads never wait on a write", () => {
    const db = openWorkbench(path);
    try {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    } finally {
      db.close();
    }
  });

  it("records whole-context checks for a selected block and queues each for composition", () => {
    const db = openWorkbench(path);
    try {
      const ids = ["alpha", "beta", "gamma"].map((abilityId) => readyAbility(db, abilityId));
      const queue = getCompositionQueue(db);
      expect(queue.ready.map((item) => item.ability_version_id)).toEqual(ids);
      expect(queue.queued).toEqual([]);
      const block = queue.ready.slice(0, 2);
      const result = reviewAbilities(db, { reviewer: REVIEWER, items: block.map((item) => ({ ability_version_id: item.ability_version_id, source_hash: item.source_hash, expected_review_hash: item.review_evidence_hash })) });
      expect(result.checked).toBe(2);
      const after = getCompositionQueue(db);
      expect(after.ready.map((item) => item.ability_version_id)).toEqual([ids[2]]);
      expect(after.queued.map((item) => item.escalation_id)).toEqual(result.escalation_ids);
    } finally {
      db.close();
    }
  });

  it("checks nothing when one source in the block changed since it was listed", () => {
    const db = openWorkbench(path);
    try {
      ["alpha", "beta"].forEach((abilityId) => readyAbility(db, abilityId));
      const [first, second] = getCompositionQueue(db).ready;
      expect(() => reviewAbilities(db, { reviewer: REVIEWER, items: [
        { ability_version_id: first!.ability_version_id, source_hash: first!.source_hash, expected_review_hash: first!.review_evidence_hash },
        { ability_version_id: second!.ability_version_id, source_hash: "0".repeat(64), expected_review_hash: second!.review_evidence_hash },
      ] })).toThrow(expect.objectContaining({ status: 409 }));
      expect(getAbility(db, first!.ability_version_id).review.whole_context_checked).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("Round 5C background work jobs", () => {
  function pendingRun(db: DatabaseSync): string {
    return String(db.prepare(`
      INSERT INTO model_runs (model, model_version, prompt_version, input_hash, config_json, status, created_at)
      VALUES ('external', 'unknown', 'round5c-work/v1', ?, '{}', 'pending', '2026-01-01T00:00:00.000Z')
    `).run("a".repeat(64)).lastInsertRowid);
  }

  it("returns immediately, finishes in the background, and refuses a duplicate start", async () => {
    process.env.DEEPSEEK_API_KEY = "fixture-key";
    const db = openWorkbench(path);
    try {
      const runId = pendingRun(db);
      let release!: (report: WorkImportReport) => void;
      const report: WorkImportReport = { run_id: runId, imported: 1, stale: 0, failed: 0, items: [] };
      const job = startWorkJob(db, () => openWorkbench(path), { run_id: runId }, () => new Promise((resolve) => { release = resolve; }));
      expect(job.state).toBe("running");
      expect(() => startWorkJob(db, () => openWorkbench(path), { run_id: runId }, async () => report)).toThrow(/already running/u);
      // A write on another connection is not blocked while the model call is outstanding.
      const other = openWorkbench(path);
      other.prepare("UPDATE workbench_state SET revision = revision + 1").run();
      other.close();
      release(report);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(workJobView(db, runId).job).toMatchObject({ state: "completed", report: { imported: 1 } });
    } finally {
      db.close();
    }
  });

  it("reports a failed attempt and leaves the run pending for another try", async () => {
    process.env.DEEPSEEK_API_KEY = "fixture-key";
    const db = openWorkbench(path);
    try {
      const runId = pendingRun(db);
      startWorkJob(db, () => openWorkbench(path), { run_id: runId }, async () => { throw new Error("DeepSeek request timed out; the prepared run remains pending."); });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(workJobView(db, runId)).toMatchObject({ status: "pending", job: { state: "failed", error: expect.stringMatching(/timed out/u) } });
      delete process.env.DEEPSEEK_API_KEY;
      expect(() => startWorkJob(db, () => openWorkbench(path), { run_id: runId })).toThrow(expect.objectContaining({ status: 503 }));
    } finally {
      db.close();
    }
  });
});
