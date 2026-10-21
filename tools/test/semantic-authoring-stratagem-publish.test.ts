import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";

import { preparePublication, publishPublication, reconcilePublicationBatches } from "../src/semantic-authoring/publish.js";
import { canonicalTarget } from "../src/semantic-authoring/publish-core.js";
import { assertKnownKeywords, keywordIndex } from "../src/semantic-authoring/core-keywords.js";
import { listShapes } from "../src/semantic-authoring/shapes.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { approveShape, confirmSurface } from "./semantic-authoring-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
const CORE_CATALOG = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/core/unit-keywords.json");

// Fabricated stratagem, unit and wording only.
const WHEN = "Your Shooting phase.";
const TARGET = "One STELLAR WARDENS INFANTRY unit from your army that has not been selected to shoot this phase.";
const EFFECT = "Until the end of the phase, models in your unit have the Fights First ability.";

const roots: string[] = [];
const saved = { data: process.env.SEMANTIC_AUTHORING_DATA_ROOT, store: process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE };
let db: DatabaseSync;
let stratagemsFile: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-stratagem-"));
  roots.push(root);
  const store = join(root, "store");
  mkdirSync(store);
  writeFileSync(join(store, "fixture.json"), JSON.stringify([
    { faction_id: "fixture", ability_id: "hold-fast", name: "Hold Fast", ability_type: "stratagem", when: WHEN, target: TARGET, effect: EFFECT },
  ]));
  const data = join(root, "data");
  mkdirSync(join(data, "core", "fixture"), { recursive: true });
  mkdirSync(join(data, "enrichment", "fixture"), { recursive: true });
  // The core-ability catalog the published ability-grant (Fights First) must resolve against.
  copyFileSync(CORE_CATALOG, join(data, "core", "unit-keywords.json"));
  const gameVersion = { edition: "10th", dataslate: "fixture" };
  writeFileSync(join(data, "core", "fixture", "units.json"), `${JSON.stringify([{
    id: "warden-squad", name: "Warden Squad", faction_id: "fixture", role: "battleline",
    profiles: [{ name: "Warden", M: 6, T: 4, W: 2, Sv: 3, Ld: 6, OC: 2 }], points: [{ models: 5, cost: 90 }],
    keywords: ["Infantry", "Battleline", "Stellar Wardens"], faction_keywords: ["Stellar Wardens"],
    base_size_mm: { shape: "round", diameter: 32 }, model_count: { min: 5, max: 10 }, weapon_ids: [], game_version: gameVersion, is_legend: false,
  }], null, 2)}\n`);
  stratagemsFile = join(data, "core", "fixture", "stratagems.json");
  writeFileSync(stratagemsFile, `${JSON.stringify([{
    id: "hold-fast", name: "HOLD FAST", category: "core", cp_cost: 1, phases: ["shooting"], player_turn: "your-turn",
    timing: "once-per-phase", target_restrictions: null, ability_id: "hold-fast", game_version: gameVersion,
  }], null, 2)}\n`);
  writeFileSync(join(data, "enrichment", "fixture", "abilities.json"), `${JSON.stringify([{
    ability_id: "hold-fast", name: "Hold Fast", authored_by: "fixture", game_version: gameVersion, ability_type: "stratagem",
    effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } }, scope: { duration: "phase" }, behavior: "activated",
  }], null, 2)}\n`);
  process.env.SEMANTIC_AUTHORING_DATA_ROOT = data;
  process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = store;
  db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, store);
});

afterEach(() => {
  db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (saved.data === undefined) delete process.env.SEMANTIC_AUTHORING_DATA_ROOT; else process.env.SEMANTIC_AUTHORING_DATA_ROOT = saved.data;
  if (saved.store === undefined) delete process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE; else process.env.SEMANTIC_AUTHORING_SOURCE_FIXTURE = saved.store;
});

describe("Semantic authoring stratagem targets", () => {
  it("publishes a TARGET to the core stratagem beside its effect, with keywords as the units spell them", async () => {
    const decide = (exact_text: string, family_id: string, parameters: Record<string, unknown>) => confirmSurface(db, { reviewer: REVIEWER, exact_text, family_id, parameters });
    decide("Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] });
    decide("One STELLAR WARDENS INFANTRY unit from your army", "stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["STELLAR WARDENS INFANTRY"], match: "all", excluded_keywords: [] });
    decide("that has not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "this-unit", negated: true });
    decide("Until the end of the phase", "duration", { endpoint: "end-of-phase" });
    decide("models in your unit have the Fights First ability", "fights-first", { subject: "this-unit" });

    const shape = listShapes(db).shapes[0]!;
    expect(shape.first_error).toBeNull();
    await approveShape(db, { reviewer: REVIEWER, signature: shape.signature, ability_version_ids: [(db.prepare("SELECT id FROM abilities WHERE ability_id = 'hold-fast'").get() as { id: number }).id] });
    const entry = db.prepare("SELECT id FROM compiled_entries WHERE status = 'approved'").get() as { id: string };
    const preview = await preparePublication(db, { faction_id: "fixture", entry_ids: [entry.id] });
    expect(preview.diff[0]!.fields.map((field) => field.field)).toEqual(["effect", "source_digest", "core.target_restrictions"]);
    await publishPublication(db, { batch_id: preview.batch_id, preview_hash: preview.preview_hash });

    const core = JSON.parse(readFileSync(stratagemsFile, "utf8")) as Array<Record<string, unknown>>;
    expect(core[0]!.target_restrictions).toEqual({
      required_keywords: ["Stellar Wardens", "Infantry"], count: "one", side: "your-army", selects: "unit",
      eligibility: { operator: "not", operands: [{ type: "happened", parameters: { event: "selected", filter: { to: "shoot" }, window: "phase" } }] },
    });
    // Phases were only checked against core, never rewritten.
    expect(core[0]!.phases).toEqual(["shooting"]);
  });

  it("recovers an interrupted publication only when both files hold the staged bytes", async () => {
    confirmSurface(db, { reviewer: REVIEWER, exact_text: "One STELLAR WARDENS INFANTRY unit from your army", family_id: "stratagem-target", parameters: { count: "one", side: "your-army", selects: "unit", keywords: ["STELLAR WARDENS INFANTRY"], match: "all", excluded_keywords: [] } });
    for (const [exact_text, family_id, parameters] of [
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["that has not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "this-unit", negated: true }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["models in your unit have the Fights First ability", "fights-first", { subject: "this-unit" }],
    ] as const) confirmSurface(db, { reviewer: REVIEWER, exact_text, family_id, parameters: parameters as Record<string, unknown> });
    const shape = listShapes(db).shapes[0]!;
    await approveShape(db, { reviewer: REVIEWER, signature: shape.signature, ability_version_ids: [(db.prepare("SELECT id FROM abilities WHERE ability_id = 'hold-fast'").get() as { id: number }).id] });
    const entry = db.prepare("SELECT id FROM compiled_entries WHERE status = 'approved'").get() as { id: string };
    const interrupted = async (writeCore: boolean) => {
      const preview = await preparePublication(db, { faction_id: "fixture", entry_ids: [entry.id] });
      const manifest = JSON.parse((db.prepare("SELECT manifest_json FROM publication_batches WHERE id = ?").get(preview.batch_id) as { manifest_json: string }).manifest_json);
      db.prepare("UPDATE publication_batches SET state = 'publishing' WHERE id = ?").run(preview.batch_id);
      const abilitiesBefore = readFileSync(manifest.destination, "utf8");
      const coreBefore = readFileSync(manifest.core.destination, "utf8");
      writeFileSync(manifest.destination, manifest.after_text);
      if (writeCore) writeFileSync(manifest.core.destination, manifest.core.after_text);
      const result = reconcilePublicationBatches(db, preview.batch_id);
      writeFileSync(manifest.destination, abilitiesBefore);
      writeFileSync(manifest.core.destination, coreBefore);
      return result;
    };
    // Only one of the two files holds the new bytes: that is not a finished publication.
    expect(await interrupted(false)).toMatchObject({ recovered: [], failed: [expect.any(String)] });
    expect((await interrupted(true)).recovered).toHaveLength(1);
  });

  it("splits bolded keyword groups and refuses alternatives core cannot store flat", () => {
    const index = keywordIndex(process.env.SEMANTIC_AUTHORING_DATA_ROOT!);
    expect(canonicalTarget({ required_keywords_any: ["STELLAR WARDENS INFANTRY", "STELLAR WARDENS BATTLELINE"], count: "one" }, index))
      .toEqual({ required_keywords: ["Stellar Wardens"], required_keywords_any: ["Infantry", "Battleline"], count: "one" });
    expect(() => canonicalTarget({ required_keywords: ["STELLAR WARDENS DREADNOUGHT"] }, index)).toThrow(/"DREADNOUGHT" .* is not a unit keyword/u);
    expect(() => canonicalTarget({ required_keywords_any: ["INFANTRY BATTLELINE", "STELLAR WARDENS"] }, index)).toThrow(/one alternative keyword per option/u);
  });

  it("passes the compiled warlord field through and refuses an entry compiled with WARLORD as a keyword", () => {
    const index = keywordIndex(process.env.SEMANTIC_AUTHORING_DATA_ROOT!);
    expect(canonicalTarget({ count: "one", side: "your-army", selects: "model", warlord: true, required_keywords: ["STELLAR WARDENS"] }, index))
      .toEqual({ required_keywords: ["Stellar Wardens"], count: "one", side: "your-army", selects: "model", warlord: true });
    // Compiled before the field existed: refused, never rewritten at publication.
    expect(() => canonicalTarget({ count: "one", side: "your-army", selects: "model", required_keywords: ["STELLAR WARDENS", "WARLORD"] }, index)).toThrow(/recompile this entry/u);
    expect(() => canonicalTarget({ required_keywords_any: ["STELLAR WARDENS", "WARLORD"] }, index)).toThrow(/recompile this entry/u);
    // A proposed TARGET leaf may name the Warlord; any other unknown word is still refused.
    expect(() => assertKnownKeywords("stratagem-target", { keywords: ["STELLAR WARDENS WARLORD"], match: "all" }, index)).not.toThrow();
    expect(() => assertKnownKeywords("stratagem-target", { keywords: ["STELLAR WARDENS WARLORD"], match: "any" }, index)).toThrow(/"WARLORD" .* is not a unit keyword/u);
  });
});
