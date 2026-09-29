import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import { confirmSurface } from "../src/round5c/leaves.js";
import { refreshSources } from "../src/round5c/source.js";
import { runPipeline8b } from "../src/round5c/pipeline-8b.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
const FACTION = "fixture-faction";
const CLOSABLE = "closable-ability";
const RESIDUE = "residue-ability";

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
    { faction_id: FACTION, ability_id: RESIDUE, raw_text: "Do the improbable platypus dance nobody else can name." },
  ]));

  const dataRoot = mkdtempSync(join(tmpdir(), "round5c-8b-data-"));
  roots.push(dataRoot);
  const factionDir = join(dataRoot, "enrichment", FACTION);
  mkdirSync(factionDir, { recursive: true });
  writeFileSync(join(factionDir, "abilities.json"), JSON.stringify([{
    ability_id: CLOSABLE, name: "Closable Ability", authored_by: "40kdc-community",
    game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, ability_type: "unit", faction_id: FACTION,
  }]));
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
  return db;
}

describe("pipeline-8b", () => {
  it("auto-confirms the deterministic predicate leaf, compiles the now-tiled ability, and gates it", async () => {
    const db = fixture();
    try {
      const report = await runPipeline8b(db, { describerSimilarityFloor: 0 });

      expect(report.auto_confirm.confirmed).toBeGreaterThan(0);
      expect(report.auto_confirm.errors).toEqual([]);

      expect(report.compile.fully_tiled).toBe(1);
      expect(report.compile.compile_attempted).toBe(1);
      expect(report.compile.compile_ok).toBe(1);
      expect(report.compile.gated).toBe(1);
      expect(report.compile.schema_pass).toBe(1);
      expect(report.compile.core_checks_pass).toBe(1);
      expect(report.compile.integrity_pass).toBe(1);
      expect(report.compile.describer_pass).toBe(1); // floor 0 in this test: only checks the render exists
      expect(report.compile.describer_scores).toHaveLength(1);
      expect(report.compile.all_gates_pass).toBe(1);
      expect(report.compile.failures).toEqual([]);

      // The residue ability shares no vocabulary with anything decided, so it stays untiled.
      expect(report.residue.untiled_abilities).toBe(1);
      expect(report.residue.untiled_spans).toBeGreaterThan(0);

      expect(report.cost_estimate.residue_ability_count).toBeGreaterThanOrEqual(1);
      expect(report.cost_estimate.requests).toBeGreaterThanOrEqual(1);
      expect(report.cost_estimate.fixed_bytes_per_request).toBeGreaterThan(0);
      expect(report.cost_estimate.prefix_cache.stable_prefix).toBe(false);
      expect(report.cost_estimate.prefix_cache.finding).toMatch(/abilities.*first|byte 0/iu);

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
});
