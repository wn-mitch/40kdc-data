import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidationResult } from "../src/validate.js";
import { checkModelNames, modelNameFilters } from "../src/integrity-model-names.js";
import { REPO_ROOT } from "../src/mfm/repo-files.js";

// Fabricated names only.

const emptyResult = (): ValidationResult => ({ totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] });

/** Writes the given files under a temp data root. */
function fixtureRoot(files: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-names-"));
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
