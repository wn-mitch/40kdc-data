import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { armyFactionRefs, checkArmyFactionRefs } from "../src/integrity-army-faction.js";
import { checkReferentialIntegrity } from "../src/integrity.js";
import type { ValidationResult } from "../src/validate.js";

// Fabricated names only.

const emptyResult = (): ValidationResult => ({ totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] });
const ability = (id: string, faction: string) => ({
  ability_id: id, name: id, faction_id: "glimmer-host",
  effect: { type: "conditional", condition: { type: "army-faction", parameters: { faction } }, effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } },
});

describe("army-faction conditions name a faction id", () => {
  let root = "";
  afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));
  const fixture = (records: unknown[]) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "army-faction-"));
    const write = (rel: string, value: unknown) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), JSON.stringify(value));
    };
    write("core/glimmer-host/factions.json", [{ id: "glimmer-host", name: "Glimmer Host", keywords: ["Shard Kin"] }]);
    write("core/glimmer-host/units.json", [{ id: "lancer-squad", faction_id: "glimmer-host", keywords: ["Infantry"], faction_keywords: ["Shard Kin"] }]);
    write("enrichment/glimmer-host/abilities.json", records);
    return root;
  };
  const messages = (result: ValidationResult) => result.errors.flatMap((entry) => entry.errors.map((error) => error.message));

  it("passes a faction id and fails the faction's keyword", async () => {
    const result = emptyResult();
    await checkArmyFactionRefs(fixture([ability("pact", "glimmer-host"), ability("oath", "shard-kin")]), result);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(messages(result)).toEqual([expect.stringContaining('army-faction "shard-kin" is not a faction id')]);
  });

  it("finds a condition nested under operators", () => {
    expect(armyFactionRefs({ operator: "not", operands: [{ type: "army-faction", parameters: { faction: "x" } }] })).toEqual(["x"]);
  });

  it("runs as part of referential integrity", async () => {
    const result = await checkReferentialIntegrity(fixture([ability("oath", "shard-kin")]));
    expect(messages(result)).toContainEqual(expect.stringContaining('army-faction "shard-kin"'));
  });
});
