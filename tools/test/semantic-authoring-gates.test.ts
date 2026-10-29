import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";

import { refreshSources } from "../src/semantic-authoring/source.js";
import { runGatesOnly } from "../src/semantic-authoring/gates.js";
import { confirmSurface } from "./semantic-authoring-human.js";
import { currentFamilyVersion } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
const FACTION = "fixture-faction";
const CLOSABLE = "closable-ability";
/** Fully tiled and compiles fine, but its effect is a shape the cruncher genuinely doesn't
 * recognize (one re-roll limited to a roll of 1) — must gate out even though it isn't a "regression" against
 * anything, since there's no old record to compare it to. */
const CLOSABLE_BAD_SHAPE = "closable-bad-shape-ability";
/** Abilities sharing no vocabulary with any decided wording: they stay untiled and never gate. */
const RESIDUE_WORDS = ["platypus", "kazoo", "marmalade"];

const roots: string[] = [];
let previousDataRoot: string | undefined;
let previousSourceFixture: string | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousDataRoot === undefined) delete process.env.SEMANTIC_AUTHORING_DATA_ROOT;
  else process.env.SEMANTIC_AUTHORING_DATA_ROOT = previousDataRoot;
  if (previousSourceFixture === undefined) delete process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE;
  else process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = previousSourceFixture;
});

/** A workbench whose two closable abilities are fully tiled by reviewer decisions, with a matching data root. */
function fixture(): DatabaseSync {
  const sourceDir = mkdtempSync(join(tmpdir(), "semantic-authoring-8b-source-"));
  roots.push(sourceDir);
  writeFileSync(join(sourceDir, `${FACTION}.json`), JSON.stringify([
    { faction_id: FACTION, ability_id: CLOSABLE, raw_text: "If this unit is Battle-shocked, re-roll a hit roll of 1." },
    { faction_id: FACTION, ability_id: CLOSABLE_BAD_SHAPE, raw_text: "Whenever this model shoots, you can re-roll one Hit roll." },
    ...RESIDUE_WORDS.map((word, index) => ({
      faction_id: FACTION, ability_id: `residue-ability-${index}`, raw_text: `Do the improbable ${word} dance nobody else can name.`,
    })),
  ]));

  const dataRoot = mkdtempSync(join(tmpdir(), "semantic-authoring-8b-data-"));
  roots.push(dataRoot);
  const factionDir = join(dataRoot, "enrichment", FACTION);
  mkdirSync(factionDir, { recursive: true });
  writeFileSync(join(factionDir, "abilities.json"), JSON.stringify([
    {
      ability_id: CLOSABLE, name: "Closable Ability", authored_by: "40kdc-community",
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, ability_type: "unit", faction_id: FACTION,
      stub: true, effect: { type: "no-effect" }, scope: { duration: "permanent" },
    },
    {
      ability_id: CLOSABLE_BAD_SHAPE, name: "Closable Bad Shape Ability", authored_by: "40kdc-community",
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, ability_type: "unit", faction_id: FACTION,
      stub: true, effect: { type: "no-effect" }, scope: { duration: "permanent" },
    },
  ]));
  previousDataRoot = process.env.SEMANTIC_AUTHORING_DATA_ROOT;
  process.env.SEMANTIC_AUTHORING_DATA_ROOT = dataRoot;
  // Keep any default-origin source read on this fixture, never the real MFM dump.
  previousSourceFixture = process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE;
  process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = sourceDir;

  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  refreshSources(db, sourceDir);
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "If this unit is Battle-shocked", family_id: "unit-state", family_version: currentFamilyVersion("unit-state"), parameters: { states: ["battle-shocked"], subject: "this-unit", negated: false } });
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "Whenever this model shoots", family_id: "attack", parameters: { direction: "makes", unit: "this-model", attack_type: "ranged" } });
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "you can re-roll one Hit roll", family_id: "reroll", family_version: currentFamilyVersion("reroll"), parameters: { roll: "hit", subset: "ones", weapon_type: "all", count: 1 } });
  return db;
}

describe("compile gates", () => {
  it("gates each fully tiled compile on its own merits, failing a shape the cruncher cannot price", async () => {
    const db = fixture();
    try {
      const { compile } = await runGatesOnly(db, { describerSimilarityFloor: 0 });
      expect(compile.fully_tiled).toBe(2);
      expect(compile.compile_attempted).toBe(2);
      expect(compile.compile_ok).toBe(2);
      expect(compile.gated).toBe(2);
      expect(compile.schema_pass).toBe(2);
      expect(compile.core_checks_pass).toBe(2);
      expect(compile.integrity_pass).toBe(2);
      expect(compile.describer_pass).toBe(2); // floor 0: only checks the render exists
      expect(compile.describer_scores).toHaveLength(2);
      // CLOSABLE gates its re-roll behind a Battle-shocked state the gate's context does not
      // declare: an honest runtime unknown. CLOSABLE_BAD_SHAPE's one re-roll of a 1 is a shape the
      // cruncher refuses, so it fails even with no old record to regress against.
      expect(compile.cruncher_honest_unknown).toBeGreaterThan(0);
      expect(compile.cruncher_unrecognized_shape).toBeGreaterThan(0);
      expect(compile.cruncher_shape_pass).toBe(1);
      expect(compile.all_gates_pass).toBe(1);
      expect(compile.failures).toEqual([
        expect.objectContaining({ ability_id: CLOSABLE_BAD_SHAPE, reason: "cruncher-unrecognized-shape" }),
      ]);
      // Both data-root entries are seeded stubs whose `no-effect` placeholder yields no levers.
      expect(compile.lever_diffs.map((diff) => diff.old_applied)).toEqual([0, 0]);
    } finally {
      db.close();
    }
  });

  it("re-gates the same picture, embedding nothing new", async () => {
    const db = fixture();
    try {
      const first = await runGatesOnly(db, { describerSimilarityFloor: 0 });
      const embeddingRows = () => (db.prepare("SELECT COUNT(*) AS n FROM text_embeddings").get() as { n: number }).n;
      const cached = embeddingRows();
      expect(cached).toBeGreaterThan(0);
      expect((await runGatesOnly(db, { describerSimilarityFloor: 0 })).compile).toEqual(first.compile);
      expect(embeddingRows()).toBe(cached);
    } finally {
      db.close();
    }
  });

  it("never refreshes sources: an unrefreshed database has nothing to gate", async () => {
    const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
    initializeWorkbench(db);
    try {
      const result = await runGatesOnly(db);
      expect(result.compile).toMatchObject({ abilities_total: 0, fully_tiled: 0, compile_attempted: 0 });
    } finally {
      db.close();
    }
  });

  it("scoped to an ability-id set ignores everything else that's tiled", async () => {
    const db = fixture();
    try {
      const closableOnlyId = db.prepare("SELECT id FROM abilities WHERE ability_id = ? AND current = 1").get(CLOSABLE) as { id: number };
      const scoped = await runGatesOnly(db, { describerSimilarityFloor: 0, abilityVersionIds: new Set([closableOnlyId.id]) });
      expect(scoped.compile.abilities_total).toBe(1);
      expect(scoped.compile.fully_tiled).toBe(1);
      expect(scoped.compile.compile_attempted).toBe(1);
      expect(scoped.compile.all_gates_pass).toBe(1);
    } finally {
      db.close();
    }
  });
});
