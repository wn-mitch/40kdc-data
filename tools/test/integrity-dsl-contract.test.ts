import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkDslContract } from "../src/integrity-dsl-contract.js";
import { checkDslShapes } from "../src/integrity-shapes.js";
import type { ValidationResult } from "../src/validate.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const menu = (id: string, optionIds = ["first", "second"]) => ({ ability_id: id, effect: { type: "stance-select", options: optionIds.map((optionId) => ({ id: optionId, name: "A mutable display label", effect: { type: "no-effect" } })) } });

async function issues(files: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "dsl-contract-"));
  roots.push(root);
  for (const [relative, value] of Object.entries(files)) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  }
  const result: ValidationResult = { totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] };
  await checkDslContract(root, result);
  await checkDslShapes(root, result);
  return result.errors.flatMap((entry) => entry.errors);
}

describe("canonical DSL semantic integrity", () => {
  it("resolves option identity locally before shared core, never by a label or foreign faction", async () => {
    const refs = (option_id: string) => ({ type: "rule-active", parameters: { rule: { ability_id: "doctrine", option_id } } });
    const errors = await issues({
      "enrichment/example/abilities.json": [menu("doctrine"), { ability_id: "observer", effect: { type: "sequence", steps: [refs("first"), refs("foreign"), refs("A mutable display label")] } }],
      "enrichment/_core/abilities.json": [menu("doctrine", ["foreign"])],
      "enrichment/another/abilities.json": [menu("doctrine", ["foreign"])],
    });
    expect(errors.map((error) => error.message)).toEqual([
      'option "foreign" is absent from ability "doctrine"',
      'option "A mutable display label" is absent from ability "doctrine"',
    ]);
  });

  it("requires string rule references to name local or shared entities, never option labels or foreign records", async () => {
    const ref = (rule: string) => ({ type: "rule-active", parameters: { rule } });
    const errors = await issues({
      "enrichment/example/abilities.json": [menu("local"), { ability_id: "consumer", effect: { type: "sequence", steps: [
        ref("local"), ref("shared"), ref("missing"), ref("a-mutable-display-label"), ref("foreign-only"),
      ] } }],
      "enrichment/_core/abilities.json": [menu("shared")],
      "enrichment/another/abilities.json": [menu("foreign-only")],
    });
    expect(errors.map((error) => error.path)).toEqual([
      "/1/effect/steps/2/parameters/rule",
      "/1/effect/steps/3/parameters/rule",
      "/1/effect/steps/4/parameters/rule",
    ]);
  });

  it("resolves dice-pool option identities independently of their display names", async () => {
    const errors = await issues({ "enrichment/example/abilities.json": [
      { ability_id: "pool", effect: { type: "dice-pool-allocation", options: [{ id: "chosen", name: "Renamed display", effect: { type: "no-effect" } }] } },
      { ability_id: "consumer", effect: { type: "rule-active", parameters: { rule: { ability_id: "pool", option_id: "chosen" } } } },
    ] });
    expect(errors).toEqual([]);
  });

  it("resolves named definitions in their owner without borrowing a foreign declaration", async () => {
    const grant = (ability_id: string, definition_id: string, declared = false) => ({
      type: "ability-grant",
      modifier: { ability: { ability_id, definition_id }, ...(declared ? { definition: { effect: { type: "no-effect" } } } : {}) },
    });
    const errors = await issues({
      "enrichment/example/abilities.json": [
        { ability_id: "parent", effect: grant("parent", "local", true) },
        { ability_id: "consumer", effect: { type: "sequence", steps: [grant("parent", "local"), grant("parent", "foreign")] } },
        { ability_id: "misplaced", effect: grant("parent", "injected", true) },
        { ability_id: "duplicate", effect: { type: "sequence", steps: [grant("duplicate", "same", true), grant("duplicate", "same", true)] } },
      ],
      "enrichment/another/abilities.json": [{ ability_id: "parent", effect: grant("parent", "foreign", true) }],
    });
    expect(errors.map((error) => error.message)).toEqual([
      'definition "foreign" is absent from ability "parent"',
      "named definition must be declared in its owning ability",
      'definition "injected" is absent from ability "parent"',
      'duplicate named definition "same" within this ability',
    ]);
  });

  it("rejects duplicate option identities and options allocated to another menu", async () => {
    const errors = await issues({ "enrichment/example/abilities.json": [menu("first-menu", ["same", "same"]), menu("second-menu"), {
      ability_id: "capacity", effect: { type: "stance-selection-capacity", modifier: { ability_id: "first-menu", allocation: "fixed-option", additional_selections: 1, option: { ability_id: "second-menu", option_id: "first" } } },
    }] });
    expect(errors.map((error) => error.message)).toEqual([
      'duplicate option id "same" within this ability',
      "capacity options must belong to the containing ability_id",
    ]);
  });

  it("rejects positional option ids, which re-point references when options are reordered", async () => {
    const errors = await issues({ "enrichment/example/abilities.json": [menu("positional", ["option-1", "option-12", "option-one"])] });
    expect(errors.map((error) => error.message)).toEqual([
      'positional option id "option-1": name the option by its slug',
      'positional option id "option-12": name the option by its slug',
    ]);
  });

  it("allows rating-agnostic selectors but requires complete catalog grants", async () => {
    const anti = { keyword_id: "anti", parameters: { target_keyword: "INFANTRY" } };
    const errors = await issues({
      "core/weapon-keywords.json": [{ id: "anti", required_parameters: ["target_keyword", "threshold"] }, { id: "blast", required_parameters: [], optional_parameters: ["value"] }],
      "enrichment/example/abilities.json": [{ ability_id: "grant", effect: { type: "sequence", steps: [
        { type: "stat-modifier", modifier: { weapons: { keyword: anti } } },
        { type: "weapon-ability-grant", modifier: { keywords: [anti, { keyword_id: "blast", parameters: { value: 1 } }] } },
      ] } }],
    });
    expect(errors).toEqual([{ path: "/0/effect/steps/1/modifier/keywords/0/parameters/threshold", message: 'weapon keyword "anti" requires parameter "threshold"' }]);
  });

  it("preserves compound Anti target gates without inventing a single keyword", async () => {
    const errors = await issues({
      "core/weapon-keywords.json": [{ id: "anti", required_parameters: ["target_keyword", "threshold"] }],
      "enrichment/example/abilities.json": [{ ability_id: "compound-anti", effect: { type: "weapon-ability-grant", modifier: { keywords: [
        { keyword_id: "anti", parameters: { required_target_keywords_any: ["MONSTER", "VEHICLE"], threshold: 4 } },
        { keyword_id: "anti", parameters: { excluded_target_keywords: ["INFANTRY"], threshold: 3 } },
        { keyword_id: "anti", parameters: { required_target_keywords_any: [], threshold: 4 } },
      ] } } }],
    });
    expect(errors).toEqual([{ path: "/0/effect/modifier/keywords/2/parameters/target_keyword", message: 'weapon keyword "anti" requires parameter "target_keyword"' }]);
  });

  it("rejects unknown catalog identities and unrelated parameters", async () => {
    const errors = await issues({
      "core/weapon-keywords.json": [{ id: "hazardous", required_parameters: [] }],
      "enrichment/example/abilities.json": [{ ability_id: "grant", effect: { type: "weapon-ability-grant", modifier: { keywords: [{ keyword_id: "unknown" }, { keyword_id: "hazardous", parameters: { value: 2 } }] } } }],
    });
    expect(new Set(errors.map((error) => error.message))).toEqual(new Set(['unknown weapon keyword "unknown"', 'weapon keyword "hazardous" does not accept parameter "value"']));
  });

  it("requires activation events rather than historical guards", async () => {
    const reactive = (ability_id: string, effect: unknown, trigger?: unknown) => ({ ability_id, behavior: "reactive", effect, ...(trigger ? { trigger } : {}) });
    const errors = await issues({ "enrichment/example/abilities.json": [
      reactive("history-only", { type: "conditional", condition: { type: "happened", parameters: { event: "destroyed", window: "turn" } } }),
      reactive("top-level", { type: "no-effect" }, { event: "destroyed" }),
      reactive("local-part", { type: "ability-part", trigger: { event: "selected" }, effect: { type: "no-effect" } }),
      reactive("local-resource", { type: "resource-action-menu", actions: [{ when: { event: "move-ended" }, effect: { type: "no-effect" } }] }),
    ] });
    expect(errors).toEqual([{ path: "/0/behavior", message: "reactive ability requires a top-level or supported local activation trigger" }]);
  });

  it("does not borrow a granted holder's activation for the granting ability", async () => {
    const grant = (owner: string) => ({
      type: "ability-grant", target: "this-unit", modifier: {
        ability: { ability_id: owner, definition_id: "reaction" },
        definition: { type: "ability-part", trigger: { event: "destroyed" }, effect: { type: "no-effect" } },
      },
    });
    const errors = await issues({ "enrichment/example/abilities.json": [
      { ability_id: "grant-only", behavior: "reactive", effect: grant("grant-only") },
      { ability_id: "triggered-grant", behavior: "reactive", trigger: { event: "battle-start" }, effect: grant("triggered-grant") },
      { ability_id: "local-grant", behavior: "reactive", effect: {
        type: "ability-part", trigger: { event: "selected" }, effect: grant("local-grant"),
      } },
    ] });
    expect(errors).toEqual([{ path: "/0/behavior", message: "reactive ability requires a top-level or supported local activation trigger" }]);
  });

  it("rejects reversed resolved bounds without inventing values for symbolic quantities", async () => {
    const errors = await issues({ "enrichment/example/abilities.json": [{ ability_id: "bounds", effect: { type: "sequence", steps: [
      { type: "select-units", selector: { count: { min: 2, max: 1 } } },
      { type: "select-units", selector: { count: { min: 0, max: "D3" } } },
      { type: "select-units", selector: { count: { min: 0 } } },
    ] } }] });
    expect(errors).toEqual([{ path: "/0/effect/steps/0/selector/count", message: "inclusive count minimum exceeds maximum" }]);
  });

  it("compares scalar and battle-size bounds without comparing unrelated roll parameters", async () => {
    const errors = await issues({ "enrichment/example/abilities.json": [{ ability_id: "bounds", effect: { type: "sequence", steps: [
      { type: "select-units", selector: { count: { min: 2, max: { incursion: 1, "strike-force": 2, onslaught: 3 } } } },
      { type: "select-units", selector: { count: { min: { incursion: 1, "strike-force": 2, onslaught: 3 }, max: 2 } } },
      { type: "roll", roll_var: "first", effect: { type: "roll", roll_var: "second", effect: {
        type: "select-units", selector: { count: { min: { roll_var: "first", successes_on: 6 }, max: { roll_var: "second", successes_on: 2 } } },
      } } },
    ] } }] });
    expect(errors.map((error) => error.path)).toEqual([
      "/0/effect/steps/0/selector/count/incursion",
      "/0/effect/steps/1/selector/count/onslaught",
    ]);
  });
  it("binds weapon selections only after their step and never across choice branches", async () => {
    const selected = { weapon_var: "chosen" };
    const select = { type: "select-weapon", modifier: { bind_as: "chosen" } };
    const use = { type: "stat-modifier", modifier: { weapons: { ref: selected } } };
    const errors = await issues({ "enrichment/example/abilities.json": [
      { ability_id: "valid", effect: { type: "sequence", steps: [select, use] } },
      { ability_id: "forward", effect: { type: "sequence", steps: [use, select] } },
      { ability_id: "self", effect: { type: "select-weapon", modifier: { bind_as: "chosen", weapons: { ref: selected } } } },
      { ability_id: "branch", effect: { type: "choice", options: [select, use] } },
    ] });
    expect(errors.map((error) => error.path)).toEqual([
      "/1/effect/steps/0/modifier/weapons/ref/weapon_var",
      "/2/effect/modifier/weapons/ref/weapon_var",
      "/3/effect/options/1/modifier/weapons/ref/weapon_var",
    ]);
  });
});
