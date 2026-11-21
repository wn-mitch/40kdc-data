import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { CoreExternalRefStore } from "../src/core-external-refs.js";
import { unitIdForDatasheet } from "../src/mfm/chapter-reprints.js";
import { datasheetTwins } from "../src/mfm/datasheet-twins.js";
import { DEFAULT_DUMP_PATH, loadDump } from "../src/mfm/loader.js";
import { findDatasheet } from "../src/mfm/project-loadout.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import { partialDump } from "./mfm-fixture.js";

/**
 * A Combat Patrol box can print one unit twice under one name. Identical copies are one unit;
 * copies that differ are `<slug>`, `<slug>-2`, …, the copy printing the most rows keeping the slug.
 * Fabricated names and ids only.
 */
function boxDump() {
  const sheet = (id: string, name = "Grunt Mob") => ({ id, publicationId: "pub-box", isLegends: false, localisations: { en: { name } } });
  return partialDump({
    data: {
      publication: [{ id: "pub-box", localisations: { en: { name: "Combat Patrol: Grunt Box" } } }],
      datasheet: [sheet("ds-a"), sheet("ds-b"), sheet("ds-c"), sheet("ds-d", "Lone Boss")],
      miniature: [
        { id: "m-a", datasheetId: "ds-a", wounds: "1", localisations: { en: { name: "Grunt" } } },
        { id: "m-b", datasheetId: "ds-b", wounds: "1", localisations: { en: { name: "Grunt" } } },
        { id: "m-c", datasheetId: "ds-c", wounds: "1", localisations: { en: { name: "Grunt" } } },
      ],
      wargear_item: [
        { id: "w-gun", wargearType: "weapon", localisations: { en: { name: "Gun" } } },
        { id: "w-axe", wargearType: "weapon", localisations: { en: { name: "Axe" } } },
      ],
      wargear_option_group: [
        { id: "g-a", datasheetId: "ds-a", miniatureId: "m-a" },
        { id: "g-b", datasheetId: "ds-b", miniatureId: "m-b" },
        { id: "g-c", datasheetId: "ds-c", miniatureId: "m-c" },
      ],
      wargear_option: [
        { id: "o-a", wargearOptionGroupId: "g-a", wargearItemId: "w-gun", defaultValue: 1 },
        { id: "o-b", wargearOptionGroupId: "g-b", wargearItemId: "w-gun", defaultValue: 1 },
        { id: "o-c", wargearOptionGroupId: "g-c", wargearItemId: "w-axe", defaultValue: 1 },
      ],
      // Only the gun copies can be led; ds-b and ds-a print the same rows under other row ids.
      datasheet_bodyguard_group: [{ id: "bg-1", datasheetId: "ds-d", bodyguardType: "leader" }],
      datasheet_bodyguard_group_datasheet: [
        { datasheetBodyguardGroupId: "bg-1", datasheetId: "ds-a" },
        { datasheetBodyguardGroupId: "bg-1", datasheetId: "ds-b" },
      ],
    },
  });
}

describe("same-named datasheets of one publication", () => {
  it("joins identical copies into one unit and gives a distinct copy its own", () => {
    const d = boxDump();
    const twins = datasheetTwins(d);
    expect([...twins.values()].map((t) => [t.datasheetId, t.unitId, t.primaryId])).toEqual([
      ["ds-a", "grunt-mob", "ds-a"],
      ["ds-b", "grunt-mob", "ds-a"],
      ["ds-c", "grunt-mob-2", "ds-c"],
    ]);
    const ds = (id: string) => d.byId("datasheet").get(id);
    expect(unitIdForDatasheet(d, ds("ds-b"))).toBe("grunt-mob");
    expect(unitIdForDatasheet(d, ds("ds-c"))).toBe("grunt-mob-2");
    expect(unitIdForDatasheet(d, ds("ds-d"))).toBe("lone-boss");
  });

  it("reads each unit from its own copy", () => {
    const d = boxDump();
    expect(findDatasheet(d, "grunt-mob", "orks")?.id).toBe("ds-a");
    expect(findDatasheet(d, "grunt-mob-2", "orks")?.id).toBe("ds-c");
  });
});

interface CoreUnit {
  id: string;
  external_refs?: { namespace: string; id: string }[];
}

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("every unit against the dump", () => {
  const units = fs
    .readdirSync(CORE_DIR)
    .filter((dir) => fs.existsSync(path.join(CORE_DIR, dir, "units.json")))
    .flatMap((dir) => (JSON.parse(fs.readFileSync(path.join(CORE_DIR, dir, "units.json"), "utf8")) as CoreUnit[]).map((u) => ({ dir, ...u })));
  const mfmRefs = (u: CoreUnit): string[] => (u.external_refs ?? []).filter((r) => r.namespace === "mfm").map((r) => r.id);

  it("carries no mfm ref to a row the dump no longer has", () => {
    const d = loadDump();
    const tables = { faction: "faction_keyword", unit: "datasheet", detachment: "detachment", enhancement: "enhancement", stratagem: "stratagem", weapon: "wargear_item", wargear: "wargear_item" } as const;
    const stale = new CoreExternalRefStore()
      .locations()
      .flatMap((l) => (l.record.external_refs ?? []).filter((r) => r.namespace === "mfm" && !d.byId(tables[l.entity_type]).has(r.id)).map((r) => `${l.entity_type} ${l.dir}/${l.record.id} → ${r.id}`));
    expect(stale).toEqual([]);
  });

  // Legends datasheets are a separate game mode, so only live sheets count.
  it("joins no unit to live datasheets of different faction keyword sets", () => {
    const d = loadDump();
    const keywordSet = (datasheetId: string): string =>
      (d.groupBy("datasheet_faction_keyword", "datasheetId").get(datasheetId) ?? [])
        .map((r) => d.enName(d.byId("faction_keyword").get(r.factionKeywordId)))
        .sort()
        .join("|");
    const mixed = units
      .map((u) => ({ id: `${u.dir}/${u.id}`, sets: [...new Set(mfmRefs(u).filter((id) => d.byId("datasheet").get(id)?.isLegends === false).map(keywordSet))] }))
      .filter((u) => u.sets.length > 1);
    expect(mixed).toEqual([]);
  });

  it("joins no unit to two different datasheets of one publication", () => {
    const d = loadDump();
    const twins = datasheetTwins(d);
    const merged = units.flatMap((u) => {
      const byPublication = new Map<string, Set<string>>();
      for (const id of mfmRefs(u)) {
        const ds = d.byId("datasheet").get(id);
        if (!ds || ds.isLegends) continue;
        const copies = byPublication.get(ds.publicationId) ?? byPublication.set(ds.publicationId, new Set()).get(ds.publicationId)!;
        copies.add(twins.get(id)?.primaryId ?? id);
      }
      return [...byPublication.values()].filter((c) => c.size > 1).map((c) => `${u.dir}/${u.id}: ${[...c].join(", ")}`);
    });
    expect(merged).toEqual([]);
  });

  it("files every routed copy as its own unit", () => {
    const d = loadDump();
    const ids = new Set(units.map((u) => u.id));
    const routed = [...datasheetTwins(d).values()].filter((t) => t.unitId !== t.slug);
    expect(routed.map((t) => t.unitId).sort()).toEqual(["ardmob-boyz-2", "coven-of-agonies-wracks-2"]);
    for (const t of routed) expect(ids.has(t.unitId), t.unitId).toBe(true);
  });
});
