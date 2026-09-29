import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import { confirmSurface } from "../src/round5c/leaves.js";
import { refreshSources } from "../src/round5c/source.js";
import { runGatesOnly, runPipeline8b } from "../src/round5c/pipeline-8b.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
const FACTION = "fixture-faction";
const CLOSABLE = "closable-ability";
/** Fully tiled and compiles fine, but its effect is a shape the cruncher genuinely doesn't
 * recognize (a count-capped re-roll) — must gate out even though it isn't a "regression" against
 * anything, since there's no old record to compare it to. */
const CLOSABLE_BAD_SHAPE = "closable-bad-shape-ability";
/** 16 abilities, so `prepareLuna`'s 15-per-request cap forces at least two residue requests. */
const RESIDUE_COUNT = 16;
const RESIDUE_WORDS = ["platypus", "kazoo", "marmalade", "trombone", "wobble", "gizmo", "sprocket", "wombat", "custard", "yodel", "gargoyle", "noodle", "trinket", "walrus", "confetti", "biscuit"];

const roots: string[] = [];
let previousDataRoot: string | undefined;
let previousSourceFixture: string | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousDataRoot === undefined) delete process.env.ROUND5C_DATA_ROOT;
  else process.env.ROUND5C_DATA_ROOT = previousDataRoot;
  if (previousSourceFixture === undefined) delete process.env.ROUND5C_SOURCE_FIXTURE;
  else process.env.ROUND5C_SOURCE_FIXTURE = previousSourceFixture;
});

/** A workbench, source fixture and matching data root, wired the way `runPipeline8b` expects. */
function fixture(): DatabaseSync {
  const sourceDir = mkdtempSync(join(tmpdir(), "round5c-8b-source-"));
  roots.push(sourceDir);
  writeFileSync(join(sourceDir, `${FACTION}.json`), JSON.stringify([
    { faction_id: FACTION, ability_id: CLOSABLE, raw_text: "If this model is on the battlefield, re-roll a hit roll of 1." },
    { faction_id: FACTION, ability_id: CLOSABLE_BAD_SHAPE, raw_text: "Whenever this model shoots, you can re-roll one Hit roll." },
    ...RESIDUE_WORDS.slice(0, RESIDUE_COUNT).map((word, index) => ({
      faction_id: FACTION, ability_id: `residue-ability-${index}`, raw_text: `Do the improbable ${word} dance nobody else can name.`,
    })),
  ]));

  const dataRoot = mkdtempSync(join(tmpdir(), "round5c-8b-data-"));
  roots.push(dataRoot);
  const factionDir = join(dataRoot, "enrichment", FACTION);
  mkdirSync(factionDir, { recursive: true });
  writeFileSync(join(factionDir, "abilities.json"), JSON.stringify([
    {
      ability_id: CLOSABLE, name: "Closable Ability", authored_by: "40kdc-community",
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, ability_type: "unit", faction_id: FACTION,
    },
    {
      ability_id: CLOSABLE_BAD_SHAPE, name: "Closable Bad Shape Ability", authored_by: "40kdc-community",
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, ability_type: "unit", faction_id: FACTION,
    },
  ]));
  previousDataRoot = process.env.ROUND5C_DATA_ROOT;
  process.env.ROUND5C_DATA_ROOT = dataRoot;
  // `runPipeline8b` starts with its own `refreshSources(db)` call using the default origin; point
  // that at this fixture directory too, so it never touches the real MFM dump.
  previousSourceFixture = process.env.ROUND5C_SOURCE_FIXTURE;
  process.env.ROUND5C_SOURCE_FIXTURE = sourceDir;

  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  refreshSources(db, sourceDir);
  // Decide the EFFECT leaf in advance (a reviewer's earlier decision); the CONDITION leaf is left
  // for the pipeline's deterministic predicateProposal pass to find and confirm on its own.
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
  // Both leaves of the bad-shape ability decided up front — nothing for auto-confirm to do here.
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "Whenever this model shoots", family_id: "attack", parameters: { direction: "makes", unit: "this-model", attack_type: "ranged" } });
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "you can re-roll one Hit roll", family_id: "reroll", family_version: 2, parameters: { roll: "hit", subset: "ones", weapon_type: "all", count: 1 } });
  return db;
}

describe("pipeline-8b", () => {
  it("auto-confirms the deterministic predicate leaf, compiles the now-tiled ability, and gates it", async () => {
    const db = fixture();
    try {
      const report = await runPipeline8b(db, { describerSimilarityFloor: 0 });

      expect(report.auto_confirm.confirmed).toBeGreaterThan(0);
      expect(report.auto_confirm.errors).toEqual([]);

      expect(report.compile.fully_tiled).toBe(2);
      expect(report.compile.compile_attempted).toBe(2);
      expect(report.compile.compile_ok).toBe(2);
      expect(report.compile.gated).toBe(2);
      expect(report.compile.schema_pass).toBe(2);
      expect(report.compile.core_checks_pass).toBe(2);
      expect(report.compile.integrity_pass).toBe(2);
      expect(report.compile.describer_pass).toBe(2); // floor 0 in this test: only checks the render exists
      expect(report.compile.describer_scores).toHaveLength(2);
      // CLOSABLE's compiled effect gates a "reroll" behind a `unit-state` condition
      // ("on-battlefield") that `evaluateCondition` has no case for: an honest runtime unknown,
      // not a shape gap — the gate judges the new compile on its own merits (no old-record
      // comparison) and passes. CLOSABLE_BAD_SHAPE's count-capped re-roll is a real shape gap
      // (`effectToBuffs` explicitly refuses to model it) and must fail the gate on its own merits
      // too, even though there is no old record for it to "regress" against.
      expect(report.compile.cruncher_honest_unknown).toBeGreaterThan(0);
      expect(report.compile.cruncher_unrecognized_shape).toBeGreaterThan(0);
      expect(report.compile.cruncher_shape_pass).toBe(1);
      expect(report.compile.all_gates_pass).toBe(1);
      expect(report.compile.failures).toEqual([
        expect.objectContaining({ ability_id: CLOSABLE_BAD_SHAPE, reason: "cruncher-unrecognized-shape" }),
      ]);
      // Both data-root entries are mirror stubs with no `effect` field: no "before" to diff
      // against, so the informational lever-diff column has nothing to report here.
      expect(report.compile.lever_diffs).toEqual([]);

      // The residue abilities share no vocabulary with anything decided, so they stay untiled.
      expect(report.residue.untiled_abilities).toBe(RESIDUE_COUNT);
      expect(report.residue.untiled_spans).toBeGreaterThan(0);

      // 16 residue abilities need at least two 15-per-request `prepareLuna` batches, so the
      // fixed-prefix fix (serializeLunaRequest + lunaStdinEnvelope) is actually exercised here.
      expect(report.cost_estimate.residue_ability_count).toBe(RESIDUE_COUNT);
      expect(report.cost_estimate.requests).toBeGreaterThanOrEqual(2);
      expect(report.cost_estimate.fixed_bytes_per_request).toBeGreaterThan(0);
      expect(report.cost_estimate.prefix_cache.stable_prefix).toBe(true);
      expect(report.cost_estimate.prefix_cache.finding).toMatch(/leading prefix/iu);

      // Idempotence: nothing left to confirm, and the compile/residue picture is unchanged.
      const second = await runPipeline8b(db, { describerSimilarityFloor: 0 });
      expect(second.auto_confirm.confirmed).toBe(0);
      expect(second.reapply.applied).toBe(0);
      expect(second.compile.fully_tiled).toBe(report.compile.fully_tiled);
      expect(second.compile.all_gates_pass).toBe(report.compile.all_gates_pass);
      expect(second.residue.untiled_abilities).toBe(report.residue.untiled_abilities);
      expect(second.residue.untiled_spans).toBe(report.residue.untiled_spans);
    } finally {
      db.close();
    }
  });

  it("gates-only mode reproduces the compile/residue/cost picture without touching sources or re-confirming, reusing cached embeddings", async () => {
    const db = fixture();
    try {
      const full = await runPipeline8b(db, { describerSimilarityFloor: 0 });
      const embeddingRows = () => (db.prepare("SELECT COUNT(*) AS n FROM text_embeddings").get() as { n: number }).n;
      const cachedAfterFull = embeddingRows();
      expect(cachedAfterFull).toBeGreaterThan(0);

      const gatesOnly = await runGatesOnly(db, { describerSimilarityFloor: 0 });
      expect(gatesOnly.compile).toEqual(full.compile);
      expect(gatesOnly.residue).toEqual(full.residue);
      expect(gatesOnly.cost_estimate).toEqual(full.cost_estimate);
      // Every text `runGatesOnly` needed to embed (each gated ability's rendered/source pair) was
      // already cached by the full run above — a re-gate embeds nothing new.
      expect(embeddingRows()).toBe(cachedAfterFull);
    } finally {
      db.close();
    }
  });

  it("gates-only mode never calls refresh: an unrefreshed database has nothing to gate", async () => {
    const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
    initializeWorkbench(db);
    try {
      const result = await runGatesOnly(db);
      expect(result.compile).toMatchObject({ abilities_total: 0, fully_tiled: 0, compile_attempted: 0 });
    } finally {
      db.close();
    }
  });
});
