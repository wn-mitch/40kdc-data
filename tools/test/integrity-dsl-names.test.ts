import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { ValidationResult } from "../src/validate.js";
import { checkModelNames, modelNameFilters } from "../src/integrity-model-names.js";
import { REPO_ROOT } from "../src/mfm/repo-files.js";
import { checkWeaponGrantRefs, weaponGrantIds } from "../src/integrity-weapon-grant.js";
import { checkStratagemTargetKeywords, checkTargetingAndAppliesToRefs, targetingRefs } from "../src/integrity-targeting-refs.js";
import { checkReferentialIntegrity } from "../src/integrity.js";

// Fabricated names only.

const emptyResult = (): ValidationResult => ({ totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] });

/** Writes the given files under a temp data root. */
function fixtureRoot(files: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsl-names-"));
  for (const [rel, value] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
  return root;
}

const composition = (unitId: string, ...names: string[]) => ({ unit_id: unitId, models: names.map((name) => ({ name, min: 1, max: 1 })) });
const permission = (target: unknown) => ({ type: "permission", target, modifier: { activity: "shoot", allow: true } });
const ability = (id: string, effect: unknown, unitIds?: string[]) => ({ ability_id: id, name: id, faction_id: "x", effect, ...(unitIds ? { unit_ids: unitIds } : {}) });
const ownModel = (name: string) => ({ level: "model", member_of: "this-unit", model_names: [name] });

async function errorsFor(files: Record<string, unknown>): Promise<string[]> {
  const root = fixtureRoot(files);
  try {
    const result = emptyResult();
    await checkModelNames(root, result);
    return result.errors.flatMap((entry) => entry.errors.map((error) => error.message));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("DSL model_names resolve to a composition model", () => {
  let compositions: Record<string, unknown>;
  beforeEach(() => {
    compositions = {
      "core/tau-empire/unit-compositions.json": [composition("drone-squad", "Drone Leader", "Drone"), composition("other-squad", "Other Leader")],
    };
  });
  afterEach(() => { compositions = {}; });

  it("passes a model of the unit carrying the ability", async () => {
    expect(await errorsFor({ ...compositions, "enrichment/tau-empire/abilities.json": [ability("a", permission(ownModel("Drone Leader")), ["drone-squad"])] })).toEqual([]);
  });

  it("fails a misspelt model name", async () => {
    const errors = await errorsFor({ ...compositions, "enrichment/tau-empire/abilities.json": [ability("a", permission(ownModel("Drone Leeder")), ["drone-squad"])] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"Drone Leeder"');
  });

  it("fails a model of another unit when the filter is the ability's own unit", async () => {
    const errors = await errorsFor({ ...compositions, "enrichment/tau-empire/abilities.json": [ability("a", permission(ownModel("Other Leader")), ["drone-squad"])] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("drone-squad");
  });

  it("accepts any unit of the faction for a friendly filter that is not the ability's unit", async () => {
    const filter = { owner: "friendly", level: "model", model_names: ["Other Leader"] };
    expect(await errorsFor({ ...compositions, "enrichment/tau-empire/abilities.json": [ability("a", permission(filter), ["drone-squad"])] })).toEqual([]);
  });

  it("checks an enemy filter against every faction, and a friendly one only against its own", async () => {
    const files = { ...compositions, "core/orks/unit-compositions.json": [composition("boyz", "Boss Nob")] };
    const enemy = { owner: "enemy", level: "model", model_names: ["Boss Nob"] };
    const friendly = { owner: "friendly", level: "model", model_names: ["Boss Nob"] };
    expect(await errorsFor({ ...files, "enrichment/tau-empire/abilities.json": [ability("a", permission(enemy))] })).toEqual([]);
    expect(await errorsFor({ ...files, "enrichment/tau-empire/abilities.json": [ability("a", permission(friendly))] })).toHaveLength(1);
  });

  it("resolves deathwatch through its shared roster to adeptus-astartes", async () => {
    const files = { "core/adeptus-astartes/unit-compositions.json": [composition("veterans", "Watch Sergeant")] };
    expect(await errorsFor({ ...files, "enrichment/deathwatch/abilities.json": [ability("a", permission(ownModel("Watch Sergeant")), ["veterans"])] })).toEqual([]);
  });

  it("finds filters nested in selections and conditions", () => {
    const tree = { type: "select-units", selector: { filter: { owner: "friendly", model_names: ["X"] } }, effect: { type: "conditional", condition: { type: "matches", parameters: { filter: { model_names: ["Y"] } } } } };
    expect(modelNameFilters(tree).map((filter) => filter.model_names)).toEqual([["X"], ["Y"]]);
  });

  it("holds every shipped model name in the repo's data", async () => {
    const result = emptyResult();
    await checkModelNames(path.join(REPO_ROOT, "data"), result);
    expect(result.errors.flatMap((entry) => entry.errors.map((error) => error.message))).toEqual([]);
    expect(result.passed).toBeGreaterThan(0);
  });
});

const grant = (weaponId: string) => ({ type: "weapon-grant", target: "this-model", modifier: { weapon_id: weaponId } });

describe("weapon-grant ids resolve in the ability's faction", () => {
  let root: string;
  afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));
  beforeEach(() => { root = ""; });

  it("fails a grant whose weapon id is in no weapons.json of the faction", async () => {
    root = fixtureRoot({
      "core/tau-empire/weapons.json": [{ id: "present" }],
      "enrichment/tau-empire/abilities.json": [ability("drone", grant("absent"))],
    });
    const result = emptyResult();
    await checkWeaponGrantRefs(root, result);
    expect(result.failed).toBe(1);
    expect(result.errors[0]!.errors[0]!.message).toContain('"absent"');
  });

  it("passes a grant whose id is in the faction's own weapons.json", async () => {
    root = fixtureRoot({
      "core/tau-empire/weapons.json": [{ id: "present" }],
      "enrichment/tau-empire/abilities.json": [ability("drone", grant("present"))],
    });
    const result = emptyResult();
    await checkWeaponGrantRefs(root, result);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(1);
  });

  it("resolves deathwatch through its shared roster to adeptus-astartes", async () => {
    root = fixtureRoot({
      "core/adeptus-astartes/weapons.json": [{ id: "shared-blade" }],
      "enrichment/deathwatch/abilities.json": [ability("thief", grant("shared-blade"))],
    });
    const result = emptyResult();
    await checkWeaponGrantRefs(root, result);
    expect(result.failed).toBe(0);
  });

  it("fails a faction with no weapons.json and no shared parent that holds the id", async () => {
    root = fixtureRoot({
      "core/adeptus-astartes/weapons.json": [{ id: "shared-blade" }],
      "enrichment/orks/abilities.json": [ability("krunch", grant("shared-blade"))],
    });
    const result = emptyResult();
    await checkWeaponGrantRefs(root, result);
    expect(result.failed).toBe(1);
  });

  it("reads grants nested inside sequence and conditional effects", () => {
    const effect = {
      type: "conditional",
      condition: { type: "has-keyword" },
      effect: { type: "sequence", steps: [{ type: "roll-modifier" }, grant("deep")] },
    };
    expect(weaponGrantIds(effect)).toEqual(["deep"]);
  });

  it("holds every shipped weapon-grant id in the repo's data", async () => {
    const result = emptyResult();
    await checkWeaponGrantRefs(path.join(REPO_ROOT, "data"), result);
    expect(result.errors.flatMap((e) => e.errors.map((x) => x.message))).toEqual([]);
  });
});

const targeting = (modifier: Record<string, unknown>) => ({ type: "targeting", target: { owner: "enemy" }, modifier: { may: "cannot-target", ...modifier } });
const scoped = (id: string, appliesTo: unknown) => ({ ...ability(id, { type: "sequence", steps: [] }), applies_to: appliesTo });

describe("targeting ids and applies_to keywords resolve", () => {
  let root: string;
  afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));
  beforeEach(() => { root = ""; });

  const base = {
    "core/stratagems.json": [{ id: "core-gambit" }],
    "core/glimmer/stratagems.json": [{ id: "own-gambit" }],
    "core/glimmer/units.json": [
      { id: "lancer-squad", keywords: ["Infantry", "Lancer Squad"], faction_keywords: ["Glimmer Host"] },
      { id: "pyre-engine", keywords: ["Vehicle"], conditional_keywords: [{ keyword: "Pyre Engines" }] },
    ],
  };
  const run = async (records: unknown[], abilityIds: string[] = []) => {
    root = fixtureRoot({ ...base, "enrichment/glimmer/abilities.json": records });
    const result = emptyResult();
    await checkTargetingAndAppliesToRefs(root, result, new Set(abilityIds));
    return result;
  };
  const messages = (result: ValidationResult) => result.errors.flatMap((e) => e.errors.map((x) => x.message));

  it("fails a targeting ability id that names no ability record", async () => {
    const result = await run([ability("veil", targeting({ kind: "ability", ability: "ghost-rule" }))], ["real-rule"]);
    expect(result.failed).toBe(1);
    expect(messages(result)).toEqual([expect.stringContaining('targeting ability "ghost-rule"')]);
  });

  it("fails a targeting stratagem id that names no faction or Core Stratagem", async () => {
    const result = await run([ability("veil", targeting({ kind: "stratagem", stratagem: "ghost-gambit" }))]);
    expect(result.failed).toBe(1);
    expect(messages(result)).toEqual([expect.stringContaining('targeting stratagem "ghost-gambit"')]);
  });

  it("passes targeting ids that resolve to an ability record, a faction Stratagem and a Core Stratagem", async () => {
    const result = await run([
      ability("a", targeting({ kind: "ability", ability: "real-rule" })),
      ability("b", targeting({ kind: "stratagem", stratagem: "own-gambit" })),
      ability("c", targeting({ kind: "stratagem", stratagem: "core-gambit" })),
    ], ["real-rule"]);
    expect(messages(result)).toEqual([]);
    expect(result.passed).toBe(3);
  });

  it("fails an applies_to keyword no unit carries, under any predicate key", async () => {
    // "LANCERS" is the shorthand prose uses; the units carry "Lancer Squad".
    const result = await run([
      scoped("all", { all_of: ["LANCERS"] }),
      scoped("none", { none_of: ["Infantry", "Lancer"] }),
    ]);
    expect(result.failed).toBe(2);
    expect(messages(result)).toEqual([
      expect.stringContaining('applies_to keyword "LANCERS"'),
      expect.stringContaining('applies_to keyword "Lancer"'),
    ]);
    expect(result.errors.map((e) => e.errors[0]!.path)).toEqual(["/0/applies_to/all_of", "/1/applies_to/none_of"]);
  });

  it("passes keywords in any case, faction keywords and conditional keywords", async () => {
    const result = await run([
      scoped("a", { all_of: ["LANCER SQUAD"], any_of: ["Glimmer Host"] }),
      scoped("b", { all_of: ["Pyre Engines"], not_all_of: ["VEHICLE"] }),
      scoped("c", {}),
      scoped("d", null),
    ]);
    expect(messages(result)).toEqual([]);
    expect(result.passed).toBe(2);
  });

  it("skips keyword checks, not targeting ids, when a file the keyword index reads is unreadable", async () => {
    root = fixtureRoot({ ...base, "enrichment/glimmer/abilities.json": [ability("veil", targeting({ kind: "stratagem", stratagem: "ghost-gambit" })), scoped("all", { all_of: ["LANCERS"] })] });
    fs.writeFileSync(path.join(root, "core/glimmer/units.json"), "not-json");
    const result = emptyResult();
    await checkTargetingAndAppliesToRefs(root, result, new Set());
    expect(messages(result)).toEqual([expect.stringContaining('targeting stratagem "ghost-gambit"')]);
    const stratagems = emptyResult();
    await checkStratagemTargetKeywords(root, stratagems);
    expect(stratagems.errors).toEqual([]);
  });

  it("reads targeting ids nested in containers", () => {
    const effect = { type: "conditional", effect: { type: "sequence", steps: [targeting({ kind: "stratagem", stratagem: "deep" })] } };
    expect(targetingRefs(effect)).toEqual([{ kind: "stratagem", id: "deep" }]);
  });

  it("runs as part of referential integrity", async () => {
    root = fixtureRoot({ ...base, "enrichment/glimmer/abilities.json": [scoped("all", { all_of: ["LANCERS"] })] });
    expect(messages(await checkReferentialIntegrity(root))).toContainEqual(expect.stringContaining('applies_to keyword "LANCERS"'));
  });

  it("holds every shipped targeting id and applies_to keyword in the repo's data", async () => {
    const result = emptyResult();
    const data = path.join(REPO_ROOT, "data");
    const ids = new Set<string>();
    for (const dir of fs.readdirSync(path.join(data, "enrichment"))) {
      const file = path.join(data, "enrichment", dir, "abilities.json");
      if (!fs.existsSync(file) || (dir.startsWith("_") && dir !== "_core")) continue;
      for (const a of JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ ability_id?: string }>) if (a.ability_id) ids.add(a.ability_id);
    }
    await checkTargetingAndAppliesToRefs(data, result, ids);
    expect(messages(result)).toEqual([]);
    expect(result.passed).toBeGreaterThan(0);
  });
});

describe("Stratagem target keywords resolve", () => {
  let root: string;
  afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));
  beforeEach(() => { root = ""; });

  const run = async (stratagems: unknown[]) => {
    root = fixtureRoot({
      "core/glimmer/units.json": [
        { id: "lancer-squad", keywords: ["Infantry", "Lancer Squad"] },
        { id: "pyre-engine", keywords: ["Vehicle"], conditional_keywords: [{ keyword: "Pyre Engines" }] },
      ],
      "core/glimmer/detachments.json": [{ id: "ember-host", granted_keywords: [{ keyword: "Ember Skirmisher", to_keywords: ["Vehicle"] }] }],
      "enrichment/glimmer/abilities.json": [ability("kindle", { type: "keyword-grant", target: { owner: "friendly", any_of: ["LANCER SQUAD"] }, modifier: { keywords: ["KINDLED"] } })],
      "core/glimmer/stratagems.json": stratagems,
    });
    const result = emptyResult();
    await checkStratagemTargetKeywords(root, result);
    return result;
  };
  const messages = (result: ValidationResult) => result.errors.flatMap((e) => e.errors.map((x) => x.message));

  it("fails a target keyword no unit carries, in a single target and in a named target of several", async () => {
    const result = await run([
      { id: "one", target_restrictions: { required_keywords: ["LANCERS"] } },
      { id: "two", target_restrictions: [{ name: "a", required_keywords: ["Infantry"] }, { name: "b", excluded_keywords: ["PYRE ENGINE"] }] },
    ]);
    expect(result.failed).toBe(2);
    expect(messages(result)).toEqual([
      expect.stringContaining('stratagem "one": target keyword "LANCERS"'),
      expect.stringContaining('stratagem "two": target keyword "PYRE ENGINE"'),
    ]);
    expect(result.errors.map((e) => e.errors[0]!.path)).toEqual(["/0/target_restrictions/required_keywords", "/1/target_restrictions/1/excluded_keywords"]);
  });

  it("passes conditional, detachment-granted and rule-granted keywords", async () => {
    const result = await run([
      { id: "a", target_restrictions: { required_keywords: ["PYRE ENGINES"], required_keywords_any: ["Ember Skirmisher", "KINDLED"] } },
      { id: "b" },
    ]);
    expect(messages(result)).toEqual([]);
    expect(result.passed).toBe(1);
  });

  it("holds every shipped Stratagem target keyword in the repo's data", async () => {
    const result = emptyResult();
    await checkStratagemTargetKeywords(path.join(REPO_ROOT, "data"), result);
    expect(messages(result)).toEqual([]);
    expect(result.passed).toBeGreaterThan(0);
  });
});
