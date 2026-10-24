import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidationResult } from "../src/validate.js";
import { checkWeaponGrantRefs, weaponGrantIds } from "../src/integrity-weapon-grant.js";
import { REPO_ROOT } from "../src/mfm/repo-files.js";

const emptyResult = (): ValidationResult => ({ totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] });

/** Writes `data/core/<faction>/weapons.json` and `data/enrichment/<faction>/abilities.json` under a temp root. */
function fixtureRoot(files: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "weapon-grant-"));
  for (const [rel, value] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
  return root;
}

const grant = (weaponId: string) => ({ type: "weapon-grant", target: "this-model", modifier: { weapon_id: weaponId } });
const ability = (id: string, effect: unknown) => ({ ability_id: id, name: id, faction_id: "x", effect });

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
