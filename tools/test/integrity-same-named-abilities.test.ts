import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReferentialIntegrity, sameNamedAbilities } from "../src/integrity.js";

/** A datasheet prints each ability once; two records of one name on a unit are a merged copy. */
describe("same-named ability records on one unit", () => {
  const names = new Map([
    ["shield-alpha", "Shield"],
    ["shield-beta", "Shield"],
    ["charge", "Charge"],
  ]);

  it("reports two datasheet records of one name, not a wargear-gated copy", () => {
    expect(sameNamedAbilities(["shield-alpha", "charge", "shield-beta"], names)).toEqual([["Shield", ["shield-alpha", "shield-beta"]]]);
    expect(sameNamedAbilities(["shield-alpha", { id: "shield-beta", wargear: "shield" }], names)).toEqual([]);
    expect(sameNamedAbilities(["shield-alpha", "shield-alpha"], names)).toEqual([]);
  });

  it("fails validation for the unit carrying both copies", async () => {
    const root = mkdtempSync(join(tmpdir(), "integrity-same-name-"));
    try {
      mkdirSync(join(root, "core/alpha"), { recursive: true });
      mkdirSync(join(root, "enrichment/alpha"), { recursive: true });
      writeFileSync(join(root, "core/alpha/units.json"), JSON.stringify([
        { id: "tank", ability_ids: ["shield-alpha", "shield-beta"] },
        { id: "walker", ability_ids: ["shield-alpha"] },
      ]));
      writeFileSync(join(root, "enrichment/alpha/abilities.json"), JSON.stringify([
        { ability_id: "shield-alpha", name: "Shield" },
        { ability_id: "shield-beta", name: "Shield" },
      ]));
      const result = await checkReferentialIntegrity(root);
      const messages = result.errors.flatMap((e) => e.errors.map((x) => x.message));
      expect(messages.filter((m) => m.includes('share the name "Shield"'))).toEqual([
        'unit "tank": ability records "shield-alpha", "shield-beta" share the name "Shield"; a unit lists one record per printed ability',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
