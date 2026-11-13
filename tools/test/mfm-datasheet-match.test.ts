/**
 * Which dump datasheet a repo unit reconciles against: `findDatasheet` (loadout, weapon stats,
 * external refs) and the wargear pass's datasheet order.
 */
import { describe, expect, it } from "vitest";
import { MfmDump } from "../src/mfm/loader.js";
import { findDatasheet } from "../src/mfm/project-loadout.js";
import { datasheetPreference } from "../src/mfm/wargear.js";

// Fabricated datasheets; faction keywords are real so they route to real repo dirs.
const loc = (name: string) => ({ localisations: { en: { name } } });
const pub = (id: string, fk: string, isLegends = false) => ({ id, factionKeywordId: fk, isLegends, isCombatPatrol: false, isCoreRules: false, ...loc(id) });
function dump(): MfmDump {
  return new MfmDump({
    data: {
      faction_keyword: [
        { id: "fk-sm", parentFactionKeywordId: null, ...loc("Adeptus Astartes") },
        { id: "fk-sw", parentFactionKeywordId: "fk-sm", ...loc("Space Wolves") },
        { id: "fk-dw", parentFactionKeywordId: "fk-sm", ...loc("Deathwatch") },
        { id: "fk-gk", parentFactionKeywordId: null, ...loc("Grey Knights") },
        { id: "fk-ag", parentFactionKeywordId: null, ...loc("Agents of the Imperium") },
      ],
      publication: [pub("p-sm", "fk-sm"), pub("p-sm-leg", "fk-sm", true), pub("p-sw", "fk-sw"), pub("p-dw", "fk-dw"), pub("p-gk", "fk-gk"), pub("p-ag", "fk-ag")],
      datasheet: [
        // A chapter datasheet whose name another faction also prints.
        { id: "ds-walker-sw", publicationId: "p-sw", isLegends: false, ...loc("Old Walker") },
        { id: "ds-walker-gk", publicationId: "p-gk", isLegends: false, ...loc("Old Walker") },
        { id: "ds-walker-leg", publicationId: "p-sm-leg", isLegends: true, ...loc("Old Walker") },
        // Two chapters and the parent print one name: the parent's own copy wins in its dir.
        { id: "ds-gunship-sm", publicationId: "p-sm", isLegends: false, ...loc("Gunship") },
        { id: "ds-gunship-dw", publicationId: "p-dw", isLegends: false, ...loc("Gunship") },
        { id: "ds-gunship-ag", publicationId: "p-ag", isLegends: false, ...loc("Gunship") },
        // Two chapters, no parent copy: ambiguous.
        { id: "ds-raider-sw", publicationId: "p-sw", isLegends: false, ...loc("Raider") },
        { id: "ds-raider-dw", publicationId: "p-dw", isLegends: false, ...loc("Raider") },
        { id: "ds-raider-gk", publicationId: "p-gk", isLegends: false, ...loc("Raider") },
      ],
    } as never,
  });
}

describe("findDatasheet", () => {
  const d = dump();
  it("takes a chapter's datasheet for a unit filed under the roster the chapter shares", () => {
    expect(findDatasheet(d, "old-walker", "adeptus-astartes")?.id).toBe("ds-walker-sw");
  });
  it("keeps each faction's own copy of a shared name", () => {
    expect(findDatasheet(d, "old-walker", "grey-knights")?.id).toBe("ds-walker-gk");
    expect(findDatasheet(d, "gunship", "agents-of-the-imperium")?.id).toBe("ds-gunship-ag");
  });
  it("prefers the dir's own datasheet over a chapter's", () => {
    expect(findDatasheet(d, "gunship", "adeptus-astartes")?.id).toBe("ds-gunship-sm");
  });
  it("refuses to choose between two chapters' datasheets", () => {
    expect(findDatasheet(d, "raider", "adeptus-astartes")).toBeNull();
  });
});

describe("wargear pass datasheet order", () => {
  it("tries a current datasheet before a Legends one in the unit's home dir", () => {
    const d = dump();
    const rows = ["ds-walker-leg", "ds-walker-sw"].map((id) => d.byId("datasheet").get(id)!);
    expect(rows.sort(datasheetPreference(d, "adeptus-astartes")).map((r) => r.id)).toEqual(["ds-walker-sw", "ds-walker-leg"]);
  });
  it("tries the dir's own datasheet before a shared import", () => {
    const d = dump();
    const rows = ["ds-gunship-dw", "ds-gunship-sm"].map((id) => d.byId("datasheet").get(id)!);
    expect(rows.sort(datasheetPreference(d, "adeptus-astartes")).map((r) => r.id)).toEqual(["ds-gunship-sm", "ds-gunship-dw"]);
  });
});
