import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { stageVocabulary } from "../src/round6/migrate-vocabulary.js";
import { prepareVocabulary, projectVocabulary } from "../src/round6/vocab-projection.js";
import { StanceIndex } from "../src/round6/vocab-cutover-stance.js";
import type { CutoverContext, Node } from "../src/round6/vocab-cutover-types.js";
import type { KeywordSets } from "../src/round6/vocab-conditions.js";
import { formatReport } from "../src/report.js";
import { transformEffects } from "../src/round6/vocab-cutover-effects.js";
import { transformTiming } from "../src/round6/vocab-cutover-timing.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const sets: KeywordSets = { unit: new Map(), known: new Set(), abilities: new Set(), tags: new Set(), weapon: new Set() };
const version = { edition: "11th", dataslate: "pre-launch-provisional" };
function fixture(value: unknown): { root: string; file: string; before: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vocabulary-projection-"));
  roots.push(root);
  const file = path.join(root, "enrichment/_example/abilities.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = JSON.stringify(value, null, 2) + "\n";
  fs.writeFileSync(file, before);
  return { root, file, before };
}
function ability(effect: Node): Node {
  return { ability_id: "example-protocol", name: "Example Protocol", authored_by: "40kdc-community", game_version: version, ability_type: "unit", behavior: "passive", effect, scope: { duration: "phase" } };
}
const legacyEffect: Node = { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1, weapon_type: "melee" } };
const canonicalEffect: Node = { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } };
function writeAbilities(root: string, faction: string, rows: Node[], basename = "abilities.json"): string {
  const file = path.join(root, "enrichment", faction, basename);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + "\n");
  return file;
}
function menu(id: string, optionId: string): Node {
  return { ...ability({ type: "stance-select", mode: "re-selectable", min_choices: 1, max_choices: 1, options: [
    { id: optionId, name: "Example Form", effect: canonicalEffect },
    { id: `${optionId}-alternative`, name: "Other Form", effect: canonicalEffect },
  ] }), ability_id: id };
}
function guarded(rule: unknown, effect = canonicalEffect): Node {
  return { type: "conditional", condition: { type: "rule-active", parameters: { rule } }, effect };
}

async function stage(file: string, root: string) {
  return stageVocabulary([file], { dataRoot: root, overrides: {}, sets });
}

describe("vocabulary migration projection and persistence", () => {
  it("validates a fabricated full projection, commits exact bytes and reruns as a no-op", async () => {
    const { root, file, before } = fixture([ability(legacyEffect)]);
    const projected = await stage(file, root);
    expect(projected.reviews).toEqual([]);
    expect(projected.staged).toHaveLength(1);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    const prepared = await prepareVocabulary(projected, root);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    prepared.commit();
    expect(fs.readFileSync(file, "utf8")).toBe(projected.staged[0]!.text);
    const second = await stage(file, root);
    expect(second.reviews).toEqual([]);
    expect(second.staged).toEqual([]);
  });

  it("moves destruction selection timing to an event without shortening the designation lifetime", async () => {
    const { root, file } = fixture([{
      ...ability({
        type: "persistent-designation", designation: "marked", duration: "battle", selection_policy: "one-time",
        select: { timing: "on-unit-destroyed", kind: "unit", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 } } },
        consumer: { beneficiary: "this-unit", relation: "attacks-selected-unit", effect: canonicalEffect },
      }),
      behavior: "reactive", trigger: { event: "destroyed", object: "this-unit" },
    }]);
    const projected = await stage(file, root);
    expect(projected.reviews).toEqual([]);
    const rows = projected.staged[0]!.value as Node[];
    expect(rows[0]!.effect).toMatchObject({
      type: "ability-part", trigger: { event: "destroyed", object: "this-unit" },
      effect: { type: "persistent-designation", duration: "battle", selection_policy: "one-time" },
    });
    expect(((rows[0]!.effect as Node).effect as Node).select).not.toHaveProperty("timing");
    (await prepareVocabulary(projected, root)).commit();
    expect((await stage(file, root)).staged).toEqual([]);
  });

  it("audits unchanged and unprojected files through the preparation API", async () => {
    const canonical = ability({ type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } });
    const { root, file, before } = fixture([canonical]);
    const invalidFile = path.join(root, "enrichment/_other/abilities.json");
    fs.mkdirSync(path.dirname(invalidFile), { recursive: true });
    const invalidBytes = JSON.stringify([{ ...canonical, ability_id: "example-invalid", unknown_property: true }]);
    fs.writeFileSync(invalidFile, invalidBytes);
    const projection = await stage(file, root);
    expect(projection.staged).toEqual([]);
    await expect(prepareVocabulary(projection, root)).rejects.toThrow(/FAILS validation/);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readFileSync(invalidFile, "utf8")).toBe(invalidBytes);
  });

  it("retains full stale-input protection for a validated no-op", async () => {
    const { root, file, before } = fixture([ability({ type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } })]);
    const projection = await stage(file, root);
    expect(projection.staged).toEqual([]);
    const prepared = await prepareVocabulary(projection, root);
    fs.writeFileSync(file, before + "\n");
    expect(() => prepared.commit()).toThrow(/changed after preparation/);
    expect(fs.readFileSync(file, "utf8")).toBe(before + "\n");
  });

  it("writes nothing when any projected record is schema-invalid", async () => {
    const bad = ability({ ...legacyEffect, misspelled_field: true });
    const { root, file, before } = fixture([ability(legacyEffect)]);
    const invalidFile = path.join(root, "enrichment/_other/abilities.json");
    const invalidBefore = JSON.stringify([{ ...bad, ability_id: "example-invalid" }]) + "\n";
    fs.mkdirSync(path.dirname(invalidFile), { recursive: true });
    fs.writeFileSync(invalidFile, invalidBefore);
    const projected = await stageVocabulary([file, invalidFile], { dataRoot: root, overrides: {}, sets });
    await expect(prepareVocabulary(projected, root)).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readFileSync(invalidFile, "utf8")).toBe(invalidBefore);
  });

  it("refuses source changes made after staging but before validation", async () => {
    const { root, file, before } = fixture([ability(legacyEffect)]);
    const projection = await stage(file, root);
    fs.writeFileSync(file, before + "\n");
    await expect(prepareVocabulary(projection, root)).rejects.toThrow(/changed after projection/);
    expect(fs.readFileSync(file, "utf8")).toBe(before + "\n");
  });

  it("refuses stale inputs between projection validation and commit", async () => {
    const { root, file, before } = fixture([ability(legacyEffect)]);
    const prepared = await prepareVocabulary(await stage(file, root), root);
    fs.writeFileSync(file, before + "\n");
    expect(() => prepared.commit()).toThrow(/changed after preparation/);
    expect(fs.readFileSync(file, "utf8")).toBe(before + "\n");
  });

  it.each([false, true])("guards unchanged reference dependencies before preparation (no-op: %s)", async (noop) => {
    const { root, file, before } = fixture([ability(guarded("shared-protocol", noop ? canonicalEffect : legacyEffect))]);
    const dependency = writeAbilities(root, "_core", [{ ...ability(canonicalEffect), ability_id: "shared-protocol" }]);
    const dependencyBefore = fs.readFileSync(dependency, "utf8");
    const projection = await stage(file, root);
    expect(projection.reviews).toEqual([]);
    expect(projection.staged).toHaveLength(noop ? 0 : 1);
    expect(projection.sources).toContainEqual({ path: dependency, text: dependencyBefore });
    fs.writeFileSync(dependency, dependencyBefore + "\n");
    await expect(prepareVocabulary(projection, root)).rejects.toThrow(/changed after projection/);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readFileSync(dependency, "utf8")).toBe(dependencyBefore + "\n");
  });

  it.each([false, true])("guards unchanged reference dependencies at commit (no-op: %s)", async (noop) => {
    const { root, file, before } = fixture([ability(guarded("shared-protocol", noop ? canonicalEffect : legacyEffect))]);
    const dependency = writeAbilities(root, "_core", [{ ...ability(canonicalEffect), ability_id: "shared-protocol" }]);
    const dependencyBefore = fs.readFileSync(dependency, "utf8");
    const projection = await stage(file, root);
    expect(projection.reviews).toEqual([]);
    expect(projection.staged).toHaveLength(noop ? 0 : 1);
    const prepared = await prepareVocabulary(projection, root);
    fs.writeFileSync(dependency, dependencyBefore + "\n");
    expect(() => prepared.commit()).toThrow(/changed after preparation/);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readFileSync(dependency, "utf8")).toBe(dependencyBefore + "\n");
  });

  it("indexes selected projected records instead of their on-disk reference definitions", () => {
    const { root, file, before } = fixture([menu("example-menu", "old-option")]);
    const value = [menu("example-menu", "projected-option"), { ...ability({ type: "ability-activate", target: "this-unit", modifier: { ability: "example-menu", option: "Example Form" } }), ability_id: "example-activation" }];
    const projection = projectVocabulary([{ path: file, value, text: JSON.stringify(value), originalText: before }], root);
    expect(projection.reviews).toEqual([]);
    expect(projection.staged[0]!.value).toMatchObject([{}, { effect: { modifier: { option: "projected-option" } } }]);
    expect(projection.sources).toEqual([{ path: file, text: before }]);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("reports ambiguous semantics with record and pointer, and retains unknown data", async () => {
    const effect = { type: "ability-activate", target: "this-model", modifier: { ability: "example-missing", option: "unfinished" } };
    const { root, file, before } = fixture([ability(effect)]);
    const projected = await stage(file, root);
    expect(projected.reviews).toEqual(expect.arrayContaining([expect.objectContaining({ record: "example-protocol", pointer: "/effect", reason: expect.stringContaining("stance option") })]));
    await expect(prepareVocabulary(projected, root)).rejects.toThrow(/example-protocol.*effect/);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("keeps outside-root fixture changes out of the production staged set", () => {
    const { root, file, before } = fixture([ability(legacyEffect)]);
    const result = projectVocabulary([{ path: file, value: JSON.parse(before) as unknown, text: before }], path.join(root, "other-data"));
    expect(result.staged).toEqual([]);
    expect(result.fixtures).toHaveLength(1);
  });

  it("preserves modifier applies_to and corrects critical and ordinary ability grants", async () => {
    const { root, file } = fixture([ability({ type: "sequence", steps: [
      { type: "weapon-ability-grant", target: "this-model", modifier: { abilities: ["Critical Hits 5+"], weapon_type: "melee" } },
      { type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Stealth"] } },
      { type: "cp-modifier", target: "this-unit", modifier: { applies_to: "targeting-this-unit", value: -1 } },
    ] })]);
    const result = await stage(file, root);
    expect(result.reviews).toEqual([]);
    const rows = result.staged[0]!.value as Array<{ effect: { steps: Node[] } }>;
    expect(rows[0]!.effect.steps[0]).toEqual({ type: "roll-result", target: "this-model", modifier: { roll: "hit", critical_on: 5, weapons: { type: "melee" } } });
    expect(rows[0]!.effect.steps[1]).toEqual({ type: "ability-grant", target: "this-unit", modifier: { ability: "stealth" } });
    expect(rows[0]!.effect.steps[2]!.modifier).toEqual({ applies_to: "targeting-this-unit", value: -1 });
  });

  it("normalizes nested weapon selectors and keeps the condition's actual visibility observer", async () => {
    const { root, file } = fixture([ability({
      type: "conditional", condition: { operator: "and", operands: [
        { type: "attack-is", parameters: { weapon_keyword: "SUSTAINED HITS 1" } },
        { type: "within", parameters: { subject: "selected-unit", range: { inches: 8 }, of: { owner: "enemy", visible: true } } },
      ] }, effect: legacyEffect,
    })]);
    const projection = await stage(file, root);
    expect(projection.reviews).toEqual([]);
    expect(projection.staged[0]!.value).toMatchObject([{ effect: { condition: { operands: [
      { type: "attack-is", parameters: { weapons: { keyword: { keyword_id: "sustained-hits", parameters: { value: 1 } } } } },
      { type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: { owner: "enemy", visible: { to: "selected-unit" } } } } } },
    ] } } }]);
  });
});

describe("stable parent-scoped stance references", () => {
  it("assigns source-order IDs and resolves old labels only within the parent", () => {
    const index = new StanceIndex([{ file: "data/enrichment/example/abilities.json", faction: "example", record: "example-menu", value: { type: "stance-select", options: [{ name: "Example Form" }, { name: "Other Form" }] } }]);
    const errors: string[] = [];
    const ctx: CutoverContext = { file: "example", faction: "example", record: "example-menu", pointer: "/effect", report(reason) { errors.push(reason); } };
    const node = index.transform({ type: "ability-activate", modifier: { ability: "example-menu", option: "Example Form" } }, ctx);
    expect(node).toEqual({ type: "ability-activate", modifier: { ability: "example-menu", option: "option-1" } });
    const changedLabel = new StanceIndex([{ file: "example", faction: "example", record: "example-menu", value: { type: "stance-select", options: [{ id: "option-1", name: "Renamed Form" }] } }]);
    expect(changedLabel.transform(node, ctx)).toEqual(node);
    expect(errors).toEqual([]);
  });

  it("keeps phase availability distinct from a phase-start edge and materializes choice defaults", async () => {
    const { root, file } = fixture([{ ...ability({
      type: "stance-select", mode: "re-selectable", select: "command-phase", scope: "unit", min_choices: 0,
      options: [{ name: "Example Form", effect: legacyEffect }, { name: "Other Form", effect: legacyEffect }],
    }), behavior: "reactive" }]);
    const result = await stage(file, root);
    expect(result.reviews).toEqual([]);
    const row = (result.staged[0]!.value as Node[])[0]!;
    expect(row.behavior).toBe("activated");
    expect(row.trigger).toBeUndefined();
    expect(row.effect).toMatchObject({ type: "conditional", condition: { type: "phase-is", parameters: { phase: "command" } }, effect: { type: "stance-select", min_choices: 0, max_choices: 1, options: [{ id: "option-1" }, { id: "option-2" }] } });
  });
});

describe("migration CLI and bounded diagnostics", () => {
  const run = (root: string, ...files: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/round6/migrate-vocabulary.ts", "--data-root", root, "--write", ...files], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });

  it("executes the real CLI, writes canonical bytes and reports a second-run no-op", () => {
    const { root, file } = fixture([ability(legacyEffect)]);
    const first = run(root);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject([{ effect: { modifier: { weapons: { type: "melee" } } } }]);
    const bytes = fs.readFileSync(file, "utf8");
    const second = run(root);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("0 data file(s)");
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
  }, 60_000);

  it("runs a targeted CLI against unchanged shared entities and menus, then reports a no-op", () => {
    const { root } = fixture([]);
    const shared = writeAbilities(root, "_core", [{ ...ability(canonicalEffect), ability_id: "shared-protocol" }, menu("shared-menu", "shared-option")]);
    const file = writeAbilities(root, "example", [ability({ type: "sequence", steps: [
      guarded("shared-protocol"),
      guarded("Example Form"),
      guarded({ ability_id: "shared-menu", option_id: "shared-option" }),
      { type: "ability-activate", target: "this-unit", modifier: { ability: "shared-menu", option: "shared-option" } },
    ] })]);
    const sharedBefore = fs.readFileSync(shared, "utf8");
    const first = run(root, file);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("1 data file(s)");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject([{ effect: { steps: [
      { condition: { parameters: { rule: "shared-protocol" } } },
      { condition: { parameters: { rule: { ability_id: "shared-menu", option_id: "shared-option" } } } },
      { condition: { parameters: { rule: { ability_id: "shared-menu", option_id: "shared-option" } } } },
      { modifier: { option: "shared-option" } },
    ] } }]);
    const bytes = fs.readFileSync(file, "utf8");
    const second = run(root, file);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("0 data file(s)");
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    expect(fs.readFileSync(shared, "utf8")).toBe(sharedBefore);
  }, 60_000);

  it("resolves local menu labels before unchanged shared menus", () => {
    const { root } = fixture([]);
    const shared = writeAbilities(root, "_core", [menu("shared-menu", "shared-option")]);
    const unrelated = writeAbilities(root, "other", [menu("other-menu", "other-option")]);
    const file = writeAbilities(root, "example", [
      menu("example-menu", "local-option"),
      { ...ability(canonicalEffect), ability_id: "local-protocol" },
      ability({ type: "sequence", steps: [
        guarded("local-protocol"),
        guarded("Example Form"),
        { type: "ability-activate", target: "this-unit", modifier: { ability: "example-menu", option: "Example Form" } },
      ] }),
    ]);
    const dependencies = [shared, unrelated].map((file) => ({ file, before: fs.readFileSync(file, "utf8") }));
    const result = run(root, file);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("1 data file(s)");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))[2]).toMatchObject({ effect: { steps: [
      { condition: { parameters: { rule: "local-protocol" } } },
      { condition: { parameters: { rule: { ability_id: "example-menu", option_id: "local-option" } } } },
      { modifier: { option: "local-option" } },
    ] } });
    for (const { file, before } of dependencies) expect(fs.readFileSync(file, "utf8")).toBe(before);
  }, 60_000);

  it("creates a non-writing inspection snapshot with byte-identical share registry", () => {
    const { root, file, before } = fixture([ability(legacyEffect)]);
    const registry = '{ "example-protocol": 7 }\n';
    fs.writeFileSync(path.join(root, "share-registry.json"), registry);
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vocabulary-snapshot-"));
    roots.push(parent);
    const snapshot = path.join(parent, "data");
    const args = ["--import", "tsx", "src/round6/migrate-vocabulary.ts", "--data-root", root, "--staging-root", snapshot];
    const result = spawnSync(process.execPath, args, { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(snapshot, "share-registry.json"), "utf8")).toBe(registry);
    expect(JSON.parse(fs.readFileSync(path.join(snapshot, path.relative(root, file)), "utf8"))).toMatchObject([{ effect: { modifier: { weapons: { type: "melee" } } } }]);
    const repeated = spawnSync(process.execPath, args, { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("requires a new directory");
    expect(fs.readFileSync(path.join(snapshot, "share-registry.json"), "utf8")).toBe(registry);
  }, 60_000);

  it("refuses the entire CLI projection when one record is invalid, including an unchanged invalid record", () => {
    const { root, file, before } = fixture([ability(legacyEffect), { ...ability({ type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } }), ability_id: "example-invalid", unknown_property: true }]);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing was written");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    fs.writeFileSync(file, JSON.stringify([{ ...ability({ type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } }), unknown_property: true }]));
    const unchanged = fs.readFileSync(file, "utf8");
    const noop = run(root);
    expect(noop.status).toBe(1);
    expect(noop.stdout).toContain("0 data file(s)");
    expect(fs.readFileSync(file, "utf8")).toBe(unchanged);
  }, 60_000);

  it("validates unselected files on a targeted CLI run before writing anything", () => {
    const { root, file, before } = fixture([ability(legacyEffect)]);
    const invalid = writeAbilities(root, "other", [{ ...ability(canonicalEffect), ability_id: "invalid-protocol", unknown_property: true }]);
    const invalidBefore = fs.readFileSync(invalid, "utf8");
    const result = run(root, file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing was written");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readFileSync(invalid, "utf8")).toBe(invalidBefore);
  }, 60_000);

  it("bounds validation rendering before constructing the failure message", () => {
    const rendered = formatReport({ totalFiles: 2, totalItems: 2, passed: 0, failed: 2, errors: [
      { file: "first.json", index: 0, errors: Array.from({ length: 1000 }, (_, i) => ({ path: `/effect/${i}`, message: "invalid" })) },
      { file: "second.json", index: 1, errors: [{ path: "/scope", message: "invalid" }] },
    ] }, "pretty", "Projection", 3);
    expect(rendered).toContain("997 additional diagnostics omitted");
    expect(rendered).toContain("second.json[1]");
    expect(rendered).toContain("/scope: invalid");
    expect(rendered.length).toBeLessThan(600);
  });

  it("keeps dice allocation requirements and stable referenced option IDs without turning the pool into a stance", async () => {
    const { root, file } = fixture([ability({ type: "dice-pool-allocation", pool: { count: 2, die: "D6" }, max_activations: 1, options: [{ name: "Example Form", requirement: { type: "pair", min_value: 3 }, effect: legacyEffect }] }), { ...ability({ type: "ability-activate", target: "this-unit", modifier: { ability: "example-protocol", option: "Example Form" } }), ability_id: "example-activation" }]);
    const result = await stage(file, root);
    expect(result.reviews).toEqual([]);
    expect(result.staged[0]!.value).toMatchObject([{ effect: { type: "dice-pool-allocation", options: [{ id: "option-1", requirement: { type: "pair", min_value: 3 } }] } }, { effect: { modifier: { option: "option-1" } } }]);
  });

  it("moves hidden runtime scope predicates into effect guards rather than roster highlighting", async () => {
    const { root, file } = fixture([{ ...ability(legacyEffect), scope: { duration: "phase", applies_to: ["EXAMPLE"] } }]);
    const result = await stage(file, root);
    expect(result.reviews).toEqual([]);
    const row = (result.staged[0]!.value as Node[])[0]!;
    expect(row.scope).toEqual({ duration: "phase" });
    expect(row.applies_to).toBeUndefined();
    expect(row.effect).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { subject: "this-unit", filter: { all_of: ["EXAMPLE"] } } } });
  });

  it("regenerates retired usage fixtures through actual activation extraction", () => {
    const { root } = fixture([]);
    const file = path.join(root, "phase4-cruncher.json");
    const value = [{ fn: "usageGated", input: { abilityType: "unit", usage: [{ frequency: "once-per-battle", per: "model" }, { frequency: "once-per-turn", per: "army" }], effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } }, output: { type: "conditional", condition: { type: "timing-is" } } }];
    const text = JSON.stringify(value);
    fs.writeFileSync(file, text);
    const dataRoot = path.join(root, "data");
    writeAbilities(dataRoot, "_core", [menu("shared-menu", "shared-option")]);
    const projection = projectVocabulary([{ path: file, value, text }], dataRoot);
    expect(projection.sources).toEqual([{ path: file, text }]);
    expect(projection.reviews).toEqual([]);
    expect(projection.staged).toEqual([]);
    const [row] = projection.fixtures[0]!.value as Array<{ fn: string; input: Node; output: { applied: unknown[]; activatable: unknown[] } }>;
    expect(row!.fn).toBe("effectToBuffs");
    expect(row!.input.activation).toEqual({ usage: value[0]!.input.usage });
    expect(row!.output.applied).toEqual([]);
    expect(row!.output.activatable).toHaveLength(1);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
});

describe("source-bound per-model rolls", () => {
  it("uses the enclosing target rather than silently substituting defender", () => {
    const issues: string[] = [];
    const ctx: CutoverContext = { file: "example.json", record: "example", pointer: "/effect", report(reason) { issues.push(reason); } };
    const node = transformEffects({ type: "mortal-wounds", target: { selection_var: "chosen-enemy" }, modifier: { count: 1, roll: { dice: 1, threshold: 4, per_model: "target" } } }, ctx);
    expect(node).toMatchObject({ modifier: { roll: { per_model: { selection_var: "chosen-enemy" } } } });
    expect(issues).toEqual([]);
  });

  it("retains the trusted source-unit binding and refuses an unbound legacy alias", () => {
    const issues: string[] = [];
    const ctx: CutoverContext = { file: "example.json", faction: "orks", record: "krushin-impetus-orks", pointer: "/effect/effect", report(reason) { issues.push(reason); } };
    const input = { type: "mortal-wounds", target: "selected-unit", modifier: { count: 1, roll: { dice: 1, threshold: 3, per_model: "this" } } };
    expect(transformEffects(input, ctx)).toMatchObject({ modifier: { roll: { per_model: "this-unit" } } });
    expect(issues).toEqual([]);
    expect(transformEffects(input, { ...ctx, record: "unresolved" })).toMatchObject({ modifier: { roll: { per_model: "this" } } });
    expect(issues).toHaveLength(1);
  });

  it("normalizes numeric quantities without changing dice or binding identities", () => {
    const ctx: CutoverContext = { file: "example.json", record: "example", pointer: "", report() { throw new Error("unexpected review"); } };
    expect(transformTiming({ count: "3", min: "0", max: "D3", value: "d6+1", bind_as: "3" }, ctx)).toEqual({ count: 3, min: 0, max: "D3", value: "D6+1", bind_as: "3" });
  });
});
