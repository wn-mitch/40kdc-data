import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLoadoutCoverage } from "../src/audit-loadout-coverage.js";

describe("loadout coverage", () => {
  let root: string;
  let faction: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "loadout-coverage-"));
    faction = join(root, "data/core/example-faction");
    mkdirSync(faction, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("separates explicit weaponless compositions from unrecorded or optional equipment", () => {
    const ids = ["terrain", "unknown", "empty-rows", "mixed-rows", "optional-kit", "variant-kit"];
    writeFileSync(join(faction, "units.json"), JSON.stringify(ids.map((id) => ({ id }))));
    writeFileSync(join(faction, "unit-compositions.json"), JSON.stringify([
      { unit_id: "terrain", models: [{ default_weapon_ids: [] }] },
      { unit_id: "unknown", models: [{}] },
      { unit_id: "empty-rows", models: [] },
      { unit_id: "mixed-rows", models: [{ default_weapon_ids: [] }, {}] },
      { unit_id: "optional-kit", models: [{ default_weapon_ids: [] }] },
      { unit_id: "variant-kit", models: [{ default_weapon_ids: [], loadout_variants: [{ weapon_ids: ["rifle"] }] }] },
    ]));
    writeFileSync(join(faction, "wargear-options.json"), JSON.stringify([{ unit_id: "optional-kit" }]));
    const report = auditLoadoutCoverage({ rootDir: root });
    expect(report.weaponlessByFaction).toEqual({ "example-faction": ["terrain"] });
    expect(report.byFaction["example-faction"].map((unit) => unit.unit_id)).toEqual([
      "empty-rows", "mixed-rows", "optional-kit", "unknown", "variant-kit",
    ]);
    expect(report.totalSkeletons).toBe(5);
    expect(report.totalWeaponless).toBe(1);
  });
});
