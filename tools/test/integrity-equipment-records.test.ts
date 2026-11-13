import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkReferentialIntegrity } from "../src/integrity.js";

// Fabricated names only.

describe("equipment a unit names has a catalog record", () => {
  let root = "";
  afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));
  const missing = async (extra: { option?: unknown; weaponIds?: string[]; defaults?: string[]; added?: string[] }) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "equipment-records-"));
    const write = (rel: string, value: unknown) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), JSON.stringify(value));
    };
    const gv = { edition: "11th", dataslate: "test" };
    write("core/glimmer-host/units.json", [{ id: "lancer-squad", name: "Lancer Squad", weapon_ids: extra.weaponIds ?? ["shard-pistol"] }]);
    write("core/glimmer-host/weapons.json", [{ id: "shard-pistol", name: "Shard Pistol" }, { id: "shard-lance", name: "Shard Lance" }]);
    write("core/glimmer-host/wargear.json", [{ id: "glimmer-shield", name: "Glimmer Shield" }]);
    write("core/glimmer-host/unit-compositions.json", [{
      unit_id: "lancer-squad",
      faction_id: "glimmer-host",
      game_version: gv,
      models: [{ name: "Lancer", min: 5, max: 5, default_weapon_ids: extra.defaults ?? ["shard-pistol"] }],
      ...(extra.added ? { added_models: [{ name: "Shard Echo", keywords: ["Infantry"], default_weapon_ids: extra.added }] } : {}),
    }]);
    write("core/glimmer-host/wargear-options.json", extra.option ? [{ id: "lancer-squad-wgo-1", unit_id: "lancer-squad", ...extra.option }] : []);
    const result = await checkReferentialIntegrity(root);
    return result.errors.flatMap((entry) => entry.errors.map((error) => error.message)).filter((message) => message.includes("has no record"));
  };

  it("accepts ids the faction's weapons.json or wargear.json defines", async () => {
    expect(await missing({ option: { replaces: ["shard-pistol"], replacement_choice: [["shard-lance"], ["glimmer-shield"]] } })).toEqual([]);
  });

  it("reports an id only option, default or unit data names", async () => {
    expect(await missing({ option: { replaces: ["shard-pistol"], replacement: ["phase-blade"] } }))
      .toEqual(['unit "lancer-squad": equipment "phase-blade" has no record in glimmer-host/weapons.json or wargear.json']);
    expect(await missing({ defaults: ["shard-pistol", "lancer-pod"] })).toEqual([expect.stringContaining('"lancer-pod"')]);
    expect(await missing({ weaponIds: ["shard-pistol", "spare-lance"] })).toEqual([expect.stringContaining('"spare-lance"')]);
    expect(await missing({ added: ["shard-lance", "echo-claws"] })).toEqual([expect.stringContaining('"echo-claws"')]);
  });
});
