import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { keywordIndex, splitKeywords } from "../src/semantic-authoring/core-keywords.js";

// Reads the repo's own unit records; no rule prose.
const DATA = join(import.meta.dirname, "..", "..", "data");
const fold = (keyword: string) => keyword.replaceAll("’", "'").replaceAll("\u2011", "-").toLowerCase();

describe("unit keywords", () => {
  it("lists each unit's datasheet name among its keywords, as the Core Rules make it one", () => {
    const missing: string[] = [];
    for (const faction of readdirSync(join(DATA, "core"))) {
      const file = join(DATA, "core", faction, "units.json");
      if (!existsSync(file)) continue;
      for (const unit of JSON.parse(readFileSync(file, "utf8")) as Array<{ id: string; name: string; keywords: string[]; is_legend?: boolean }>) {
        if (unit.is_legend) continue;
        if (!unit.keywords.some((keyword) => fold(keyword) === fold(unit.name))) missing.push(`${faction}/${unit.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("splits a printed datasheet name, including one the dump spells with a non-breaking hyphen", () => {
    const index = keywordIndex(DATA);
    expect(splitKeywords("NOBZ", index)).toEqual(["Nobz"]);
    expect(splitKeywords("BLITZA-BOMMER", index)).toEqual(["Blitza-bommer"]);
  });

  it("spells every keyword with a plain hyphen, never the dump's non-breaking one", () => {
    const spelled: string[] = [];
    for (const faction of readdirSync(join(DATA, "core"))) {
      const file = join(DATA, "core", faction, "units.json");
      if (!existsSync(file)) continue;
      for (const unit of JSON.parse(readFileSync(file, "utf8")) as Array<{ id: string; keywords: string[] }>) {
        for (const keyword of unit.keywords) if (keyword.includes("\u2011")) spelled.push(`${faction}/${unit.id}: ${keyword}`);
      }
    }
    expect(spelled).toEqual([]);
  });
});
