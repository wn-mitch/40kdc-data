import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { DEFAULT_DUMP_PATH, loadDump, MfmDump } from "../src/mfm/loader.js";
import { buildChapterScopeCanon } from "../src/mfm/chapter-scope.js";
import { chapterReprints, unitIdForDatasheet, weaponOwnerId } from "../src/mfm/chapter-reprints.js";
import { findDatasheet } from "../src/mfm/project-loadout.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import { partialDump } from "./mfm-fixture.js";

/**
 * The chapter-scope ingest derives Space Marine chapter access from the dump.
 * `buildChapterScopeCanon` and `chapterReprints` are the pure seams under test, over
 * `datasheet_faction_keyword`, the publications that own each datasheet, and
 * `faction_keyword_excluded_datasheet`:
 *   - faction_keywords: generic `[Adeptus Astartes]` whenever a generic datasheet exists for a
 *     name; the chapter keyword only when every datasheet is chapter-locked.
 *   - excluded_faction_keywords: every chapter that excludes a generic datasheet bars it, whether
 *     or not the chapter prints its own copy.
 *   - a chapter's same-name copy of a generic datasheet is its own unit `<slug>-<chapter-dir>`.
 * A synthetic dump keeps it runnable without _private/dump.json.
 */
function dump(): MfmDump {
  return partialDump({
    data: {
      faction_keyword: [
        { id: "fk-aa", parentFactionKeywordId: null, localisations: { en: { name: "Adeptus Astartes" } } },
        { id: "fk-bt", parentFactionKeywordId: "fk-aa", localisations: { en: { name: "Black Templars" } } },
        { id: "fk-dw", parentFactionKeywordId: "fk-aa", localisations: { en: { name: "Deathwatch" } } },
        // Not a child of Adeptus Astartes — its exclusions must be ignored.
        { id: "fk-gk", parentFactionKeywordId: null, localisations: { en: { name: "Grey Knights" } } },
      ],
      publication: [
        { id: "pub-sm", factionKeywordId: "fk-aa", localisations: { en: { name: "Codex: Space Marines" } } },
        { id: "pub-bt", factionKeywordId: "fk-bt", localisations: { en: { name: "Codex Supplement: Black Templars" } } },
      ],
      datasheet: [
        { id: "ds-rep-g", publicationId: "pub-sm", isLegends: false, localisations: { en: { name: "Repulsor" } } },
        { id: "ds-rep-bt", publicationId: "pub-bt", isLegends: false, localisations: { en: { name: "Repulsor" } } },
        { id: "ds-hel", publicationId: "pub-bt", isLegends: false, localisations: { en: { name: "High Marshal Helbrecht" } } },
        { id: "ds-lib", publicationId: "pub-sm", isLegends: false, localisations: { en: { name: "Librarian" } } },
        { id: "ds-term", publicationId: "pub-sm", isLegends: false, localisations: { en: { name: "Terminator Squad" } } },
      ],
      datasheet_faction_keyword: [
        { id: "x1", displayOrder: 1, datasheetId: "ds-rep-g", factionKeywordId: "fk-aa" },
        { id: "x2", displayOrder: 1, datasheetId: "ds-rep-bt", factionKeywordId: "fk-aa" },
        { id: "x3", displayOrder: 2, datasheetId: "ds-rep-bt", factionKeywordId: "fk-bt" },
        { id: "x4", displayOrder: 1, datasheetId: "ds-hel", factionKeywordId: "fk-aa" },
        { id: "x5", displayOrder: 2, datasheetId: "ds-hel", factionKeywordId: "fk-bt" },
        { id: "x6", displayOrder: 1, datasheetId: "ds-lib", factionKeywordId: "fk-aa" },
        { id: "x7", displayOrder: 1, datasheetId: "ds-term", factionKeywordId: "fk-aa" },
      ],
      faction_keyword_excluded_datasheet: [
        // BT excludes the generic Repulsor and prints its own copy.
        { factionKeywordId: "fk-bt", datasheetId: "ds-rep-g" },
        // BT excludes Librarian with no replacement.
        { factionKeywordId: "fk-bt", datasheetId: "ds-lib" },
        // Deathwatch excludes the generic Terminator Squad (its replacement is renamed).
        { factionKeywordId: "fk-dw", datasheetId: "ds-term" },
      ],
    },
  });
}

describe("buildChapterScopeCanon", () => {
  it("bars a chapter from a generic unit it reprints", () => {
    const canon = buildChapterScopeCanon(dump());
    expect(canon.get("repulsor")).toEqual({
      name: "Repulsor",
      factionKeywords: ["Adeptus Astartes"],
      excludedKeywords: ["Black Templars"],
    });
  });

  it("keeps the chapter keyword when every datasheet is chapter-locked", () => {
    const canon = buildChapterScopeCanon(dump());
    expect(canon.get("high-marshal-helbrecht")).toEqual({
      name: "High Marshal Helbrecht",
      factionKeywords: ["Adeptus Astartes", "Black Templars"],
      excludedKeywords: [],
    });
  });

  it("bars a generic unit a chapter excludes with no same-name replacement", () => {
    const canon = buildChapterScopeCanon(dump());
    expect(canon.get("librarian")).toEqual({
      name: "Librarian",
      factionKeywords: ["Adeptus Astartes"],
      excludedKeywords: ["Black Templars"],
    });
    expect(canon.get("terminator-squad")).toEqual({
      name: "Terminator Squad",
      factionKeywords: ["Adeptus Astartes"],
      excludedKeywords: ["Deathwatch"],
    });
  });

  it("ignores exclusions from factions that are not children of Adeptus Astartes", () => {
    const canon = buildChapterScopeCanon(dump());
    for (const scope of canon.values()) {
      expect(scope.excludedKeywords).not.toContain("Grey Knights");
    }
  });
});

describe("chapterReprints", () => {
  it("routes a chapter's same-name copy to its own unit and leaves the generic sheet on the slug", () => {
    const d = dump();
    expect([...chapterReprints(d).values()]).toEqual([
      {
        datasheetId: "ds-rep-bt",
        slug: "repulsor",
        chapterDir: "black-templars",
        chapterKeyword: "Black Templars",
        unitId: "repulsor-black-templars",
      },
    ]);
    const ds = (id: string) => d.byId("datasheet").get(id);
    expect(unitIdForDatasheet(d, ds("ds-rep-bt"))).toBe("repulsor-black-templars");
    expect(unitIdForDatasheet(d, ds("ds-rep-g"))).toBe("repulsor");
    // A chapter-only datasheet (no generic copy) is not a reprint.
    expect(unitIdForDatasheet(d, ds("ds-hel"))).toBe("high-marshal-helbrecht");
  });

  it("joins each unit to its own datasheet and shares the generic unit's weapon variants", () => {
    const d = dump();
    expect(findDatasheet(d, "repulsor", "adeptus-astartes")?.id).toBe("ds-rep-g");
    // The reprint never answers for the bare slug, even from the chapter's own dir.
    expect(findDatasheet(d, "repulsor", "black-templars")?.id).toBe("ds-rep-g");
    expect(findDatasheet(d, "repulsor-black-templars", "adeptus-astartes")?.id).toBe("ds-rep-bt");
    expect(weaponOwnerId(d, "repulsor-black-templars")).toBe("repulsor");
    expect(weaponOwnerId(d, "repulsor")).toBe("repulsor");
  });
});

interface PoolUnit {
  id: string;
  faction_keywords?: string[];
  excluded_faction_keywords?: string[];
  external_refs?: { namespace: string; id: string }[];
}

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("the Space Marine pool against the dump", () => {
  const units = JSON.parse(fs.readFileSync(path.join(CORE_DIR, "adeptus-astartes", "units.json"), "utf8")) as PoolUnit[];

  // Legends datasheets are a separate game mode (the Space Wolves Venerable Dreadnought keeps
  // the Legends generic sheet's ref), so only live sheets count.
  it("joins no unit to live datasheets of different chapter keyword sets", () => {
    const d = loadDump();
    const fkName = d.byId("faction_keyword");
    const keywordSet = (datasheetId: string): string =>
      (d.groupBy("datasheet_faction_keyword", "datasheetId").get(datasheetId) ?? [])
        .map((r) => d.enName(fkName.get(r.factionKeywordId)))
        .sort()
        .join("|");
    const mixed = units
      .map((u) => {
        const live = (u.external_refs ?? [])
          .filter((r) => r.namespace === "mfm" && d.byId("datasheet").get(r.id)?.isLegends === false)
          .map((r) => r.id);
        return { id: u.id, sets: [...new Set(live.map(keywordSet))] };
      })
      .filter((u) => u.sets.length > 1);
    expect(mixed).toEqual([]);
  });

  it("gives each chapter reprint its own chapter-locked unit and bars the chapter from the generic one", () => {
    const d = loadDump();
    const byId = new Map(units.map((u) => [u.id, u]));
    expect(chapterReprints(d).size).toBeGreaterThan(0);
    for (const r of chapterReprints(d).values()) {
      const reprint = byId.get(r.unitId);
      expect(reprint?.faction_keywords, r.unitId).toEqual(["Adeptus Astartes", r.chapterKeyword]);
      expect(reprint?.external_refs?.filter((ref) => ref.namespace === "mfm").map((ref) => ref.id)).toEqual([r.datasheetId]);
      expect(byId.get(r.slug)?.excluded_faction_keywords, r.slug).toContain(r.chapterKeyword);
    }
  });
});
