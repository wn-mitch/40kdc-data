import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";

import { runGatesOnly } from "../src/semantic-authoring/pipeline-8b.js";
import { applyChatReview } from "../src/semantic-authoring/review-apply.js";
import { factionReviewSheet } from "../src/semantic-authoring/review-sheet.js";
import { reviewMembers } from "../src/semantic-authoring/shapes.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { confirmSurface } from "./semantic-authoring-human.js";

// Fabricated faction, units, stratagem and wording only.

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
const CORE_CATALOG = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/core/unit-keywords.json");
const GAME_VERSION = { edition: "10th", dataslate: "fixture" };
const STUB = { authored_by: "fixture", game_version: GAME_VERSION, stub: true, effect: { type: "no-effect" }, scope: { duration: "permanent" } };

const roots: string[] = [];
const saved = { data: process.env.SEMANTIC_AUTHORING_DATA_ROOT, store: process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE };
let db: DatabaseSync;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-gate-integrity-"));
  roots.push(root);
  const store = join(root, "store");
  mkdirSync(store);
  writeFileSync(join(store, "fixture.json"), JSON.stringify([
    { faction_id: "fixture", ability_id: "resolved-grant", name: "Resolved Grant", ability_type: "unit", raw_text: "This unit has the Fights First ability." },
    { faction_id: "fixture", ability_id: "dangling-grant", name: "Dangling Grant", ability_type: "unit", raw_text: "This unit has the Gloaming Step ability." },
    { faction_id: "fixture", ability_id: "dangling-faction-rule", name: "Dangling Faction Rule", ability_type: "unit", raw_text: "This unit has the Ember Oath rule." },
    { faction_id: "fixture", ability_id: "hold-fast", name: "Hold Fast", ability_type: "stratagem", when: "Your Shooting phase.", target: "One STELLAR WARDENS DREADNOUGHT unit from your army.", effect: "Until the end of the phase, models in your unit have the Fights First ability." },
  ]));
  const data = join(root, "data");
  mkdirSync(join(data, "core", "fixture"), { recursive: true });
  mkdirSync(join(data, "enrichment", "fixture"), { recursive: true });
  // The core-ability catalog a rule-state or ability-grant naming a core ability resolves against.
  copyFileSync(CORE_CATALOG, join(data, "core", "unit-keywords.json"));
  writeFileSync(join(data, "core", "fixture", "units.json"), `${JSON.stringify([{
    id: "warden-squad", name: "Warden Squad", faction_id: "fixture", role: "battleline",
    profiles: [{ name: "Warden", M: 6, T: 4, W: 2, Sv: 3, Ld: 6, OC: 2 }], points: [{ models: 5, cost: 90 }],
    keywords: ["Infantry", "Battleline", "Stellar Wardens"], faction_keywords: ["Stellar Wardens"],
    base_size_mm: { shape: "round", diameter: 32 }, model_count: { min: 5, max: 10 }, weapon_ids: [], game_version: GAME_VERSION, is_legend: false,
  }], null, 2)}\n`);
  writeFileSync(join(data, "core", "fixture", "stratagems.json"), `${JSON.stringify([{
    id: "hold-fast", name: "HOLD FAST", category: "core", cp_cost: 1, phases: ["shooting"], player_turn: "your-turn",
    timing: "once-per-phase", target_restrictions: null, ability_id: "hold-fast", game_version: GAME_VERSION,
  }], null, 2)}\n`);
  writeFileSync(join(data, "enrichment", "fixture", "abilities.json"), `${JSON.stringify([
    { ability_id: "resolved-grant", name: "Resolved Grant", ability_type: "unit", ...STUB },
    { ability_id: "dangling-grant", name: "Dangling Grant", ability_type: "unit", ...STUB },
    { ability_id: "dangling-faction-rule", name: "Dangling Faction Rule", ability_type: "unit", ...STUB },
    { ability_id: "hold-fast", name: "Hold Fast", ability_type: "stratagem", behavior: "activated", ...STUB },
  ], null, 2)}\n`);
  process.env.SEMANTIC_AUTHORING_DATA_ROOT = data;
  process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = store;
  db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, store);

  const decide = (exact_text: string, family_id: string, parameters: Record<string, unknown>) => confirmSurface(db, { reviewer: REVIEWER, exact_text, family_id, parameters });
  decide("This unit has the Fights First ability", "rule-state", { subject: "this-unit", direction: "granted", rule_kind: "ability", rule: "fights-first" });
  decide("This unit has the Gloaming Step ability", "rule-state", { subject: "this-unit", direction: "granted", rule_kind: "ability", rule: "gloaming-step" });
  decide("This unit has the Ember Oath rule", "rule-state", { subject: "this-unit", direction: "granted", rule_kind: "faction-rule", rule: "ember-oath" });
  decide("Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] });
  decide("One STELLAR WARDENS DREADNOUGHT unit from your army", "stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["STELLAR WARDENS DREADNOUGHT"], match: "all", excluded_keywords: [] });
  decide("Until the end of the phase", "duration", { endpoint: "end-of-phase" });
  decide("models in your unit have the Fights First ability", "fights-first", { subject: "this-unit" });
});

afterEach(() => {
  db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (saved.data === undefined) delete process.env.SEMANTIC_AUTHORING_DATA_ROOT; else process.env.SEMANTIC_AUTHORING_DATA_ROOT = saved.data;
  if (saved.store === undefined) delete process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE; else process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = saved.store;
});

describe("compile gates run publication integrity", () => {
  it("fails the integrity gate, with publication's reason, for records schema and core checks accept", async () => {
    const { compile } = await runGatesOnly(db, { describerSimilarityFloor: 0 });
    const gates = Object.fromEntries(compile.abilities.map((row) => [row.ability_id, row.gates]));
    // Every record compiles to a schema-valid entry whose core checks pass ...
    for (const id of ["resolved-grant", "dangling-grant", "dangling-faction-rule", "hold-fast"]) {
      expect(gates[id], id).toMatchObject({ status: "gated", schema: true, core_checks: true });
    }
    // ... but publishing a dangling reference or an unknown target keyword is refused.
    expect(gates["resolved-grant"]).toMatchObject({ integrity: true });
    expect(gates["dangling-grant"]).toMatchObject({ integrity: false, all: false });
    expect(gates["dangling-faction-rule"]).toMatchObject({ integrity: false, all: false });
    expect(gates["hold-fast"]).toMatchObject({ integrity: false, all: false });
    expect(compile.integrity_pass).toBe(1);

    const reasons = Object.fromEntries(compile.failures.filter((failure) => failure.reason === "integrity").map((failure) => [failure.ability_id, failure.detail]));
    expect(Object.keys(reasons).sort()).toEqual(["dangling-faction-rule", "dangling-grant", "hold-fast"]);
    expect(reasons["dangling-grant"]).toMatch(/enrichment\/fixture\/abilities\.json\[1\].*rule_kind:ability "gloaming-step" resolves to no ability entity/u);
    expect(reasons["dangling-faction-rule"]).toMatch(/rule_kind:faction-rule "ember-oath" is not declared in faction_rule_ids/u);
    expect(reasons["hold-fast"]).toMatch(/"DREADNOUGHT" .* is not a unit keyword/u);
  });

  it("keeps integrity failures out of the review sheet's approve-shape draft", async () => {
    const sheet = await factionReviewSheet(db, "fixture");
    const failing = sheet.failing.map((row) => row.ability_id).sort();
    expect(failing).toEqual(["dangling-faction-rule", "dangling-grant", "hold-fast"]);
    const drafted = new Set(sheet.proposed_decisions.decisions.flatMap((decision) => decision.ability_version_ids ?? []));
    const ids = db.prepare("SELECT id, ability_id FROM abilities WHERE current = 1").all() as Array<{ id: number; ability_id: string }>;
    expect(ids.filter((row) => drafted.has(row.id)).map((row) => row.ability_id)).toEqual(["resolved-grant"]);
  });

  it("refuses a hand-written approve-shape decision for a member publication would reject", async () => {
    const member = (id: string) => reviewMembers(db).find((row) => row.ability_id === id)!;
    const dangling = member("dangling-grant");
    const resolved = member("resolved-grant");
    // Both compile to the same shape, so only the integrity check tells them apart.
    expect(dangling.signature).toBe(resolved.signature);
    expect(dangling.errors).toEqual([]);

    const result = await applyChatReview(db, { reviewer: REVIEWER, decisions: [
      { action: "approve-shape", signature: dangling.signature, ability_version_ids: [resolved.ability_version_id, dangling.ability_version_id] },
      { action: "approve-shape", signature: resolved.signature, ability_version_ids: [resolved.ability_version_id] },
    ] });
    expect(result.failed).toEqual([expect.objectContaining({
      error: expect.stringMatching(/^fixture\/dangling-grant cannot be approved: integrity: enrichment\/fixture\/abilities\.json\[1\] .*"gloaming-step" resolves to no ability entity/u),
    })]);
    // The refused decision records nothing, not even its passing member; the second approves.
    const approved = db.prepare(`
      SELECT abilities.ability_id FROM compiled_entries JOIN abilities ON abilities.id = compiled_entries.ability_version_id
      WHERE compiled_entries.status = 'approved'
    `).all() as Array<{ ability_id: string }>;
    expect(approved.map((row) => row.ability_id)).toEqual(["resolved-grant"]);
  });
});
