/**
 * BattleScribe roster files (`import/battlescribe-ros.ts`). The fixtures are one
 * NewRecruit list exported three ways (.ros, .rosz, NewRecruit JSON) from the
 * BSData export; all three must import to the same roster.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { importBattleScribe, isZip, rosToJson, unzipRosz } from "../src/import/battlescribe-ros.js";
import { tryImportRoster } from "../src/import/import-roster.js";

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/import/battlescribe/${name}`, import.meta.url));

describe("BattleScribe roster import", () => {
  for (const list of ["daemons", "wolves"]) {
    it(`imports the ${list} .ros and .rosz as NewRecruit's JSON export of the same list`, () => {
      const json = tryImportRoster(fixture(`${list}.json`).toString("utf8"));
      const ros = importBattleScribe(fixture(`${list}.ros`).toString("utf8"));
      const rosz = importBattleScribe(new Uint8Array(fixture(`${list}.rosz`)));
      const rosBytes = importBattleScribe(new Uint8Array(fixture(`${list}.ros`)));
      expect(json.ok && ros.ok && rosz.ok && rosBytes.ok).toBe(true);
      if (!json.ok || !ros.ok || !rosz.ok || !rosBytes.ok) return;
      expect(ros.roster).toEqual(json.roster);
      expect(rosz.roster).toEqual(json.roster);
      expect(rosBytes.roster).toEqual(json.roster);
      expect(ros.roster.diagnostics.unresolved_units).toBe(0);
    });
  }

  it("reads the daemons list's units, warlord, detachment and disposition", () => {
    const result = importBattleScribe(fixture("daemons.ros").toString("utf8"));
    if (!result.ok) throw new Error(result.message);
    const { roster } = result;
    expect(roster.faction_id).toBe("chaos-daemons");
    expect(roster.detachments.map((d) => d.ref.id)).toEqual(["blood-legion"]);
    expect(roster.force_disposition).toBe("purge-the-foe");
    expect(roster.units.map((u) => [u.ref.id, u.model_count, u.is_warlord])).toEqual([
      ["bloodmaster", 1, true],
      ["bloodletters", 10, false],
    ]);
    // Per-model groups survive the XML: nine Bloodletters and a Bloodreaper.
    expect(roster.units[1]!.loadout_groups?.map((g) => g.count).sort()).toEqual([1, 9]);
  });

  it("lowers plural containers to arrays, attributes to properties, and numeric attributes to numbers", () => {
    const xml = `<?xml version="1.0"?><roster name="R" xmlns="http://www.battlescribe.net/schema/rosterSchema">
      <costs><cost name="pts" value="85"/></costs>
      <forces><force catalogueName="X"><selections>
        <selection name="U" type="unit" number="2"><categories><category name="Battleline"/></categories><selections/></selection>
      </selections></force></forces></roster>`;
    expect(rosToJson(xml)).toEqual({
      roster: {
        name: "R",
        xmlns: "http://www.battlescribe.net/schema/rosterSchema",
        costs: [{ name: "pts", value: 85 }],
        forces: [{ catalogueName: "X", selections: [{ name: "U", type: "unit", number: 2, categories: [{ name: "Battleline" }], selections: [] }] }],
      },
    });
  });

  it("keeps a non-numeric value attribute a string and keeps element text", () => {
    const xml = `<roster xmlns="x"><rules><rule name="A"><description>Some text</description></rule></rules><costs><cost name="pts" value="n/a"/></costs></roster>`;
    expect(rosToJson(xml).roster).toEqual({ xmlns: "x", rules: [{ name: "A", description: { $text: "Some text" } }], costs: [{ name: "pts", value: "n/a" }] });
  });

  it("finds the .ros inside a .rosz whatever its entry name", () => {
    const zipped = zipSync({ "readme.txt": strToU8("x"), "My List.ros": strToU8("<roster/>") });
    expect(isZip(zipped)).toBe(true);
    expect(unzipRosz(zipped)).toBe("<roster/>");
    expect(isZip(strToU8("<roster/>"))).toBe(false);
  });

  it("reports why a document is not a usable roster", () => {
    expect(importBattleScribe("<catalogue/>")).toMatchObject({ ok: false, reason: "decode-failed" });
    expect(importBattleScribe(`<roster name="R"><forces/></roster>`)).toMatchObject({ ok: false, reason: "no-adapter-matched" });
    expect(importBattleScribe(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toMatchObject({ ok: false, reason: "decode-failed" });
  });
});
