import { describe, it, expect } from "vitest";
import { MfmDump } from "../src/mfm/loader.js";
import {
  keywordLabel,
  factionKeywordLabel,
  keywordLabels,
  factionKeywordLabels,
} from "../src/mfm/keywords.js";
import { partialDump } from "./mfm-fixture.js";

/**
 * WS0 keyword resolver: dump `keyword`/`faction_keyword` id → the Title-Case repo
 * label (`localisations.en.name`, trimmed). Pure reads — an unknown id or a row
 * with no English name resolves to `null`, and the list helpers drop unresolved
 * ids (collecting them for a caller warning) and collapse an all-empty result to
 * `null` so a consumer stores the schema's "no restriction" shape, not `[]`.
 */
function dump(): MfmDump {
  return partialDump({
    data: {
      keyword: [
        { id: "k-veh", localisations: { en: { name: "Vehicle" } } },
        { id: "k-char", localisations: { en: { name: " Character " } } },
        { id: "k-noen", localisations: { fr: { name: "Véhicule" } } },
      ],
      faction_keyword: [
        { id: "fk-cust", localisations: { en: { name: "Adeptus Custodes" } } },
        { id: "fk-sm", localisations: { en: { name: "Adeptus Astartes" } } },
      ],
    },
  });
}

describe("keywordLabel / factionKeywordLabel", () => {
  it("resolves a known keyword id to its trimmed English label", () => {
    expect(keywordLabel(dump(), "k-veh")).toBe("Vehicle");
    expect(keywordLabel(dump(), "k-char")).toBe("Character");
  });

  it("resolves a known faction-keyword id", () => {
    expect(factionKeywordLabel(dump(), "fk-cust")).toBe("Adeptus Custodes");
  });

  it("returns null for an unknown id, a null/undefined id, or a row without an English name", () => {
    const d = dump();
    expect(keywordLabel(d, "nope")).toBeNull();
    expect(keywordLabel(d, null)).toBeNull();
    expect(keywordLabel(d, undefined)).toBeNull();
    expect(keywordLabel(d, "k-noen")).toBeNull();
    expect(factionKeywordLabel(d, "nope")).toBeNull();
  });
});

describe("keywordLabels / factionKeywordLabels", () => {
  it("resolves, de-duplicates, and sorts labels", () => {
    expect(keywordLabels(dump(), ["k-char", "k-veh", "k-veh"])).toEqual(["Character", "Vehicle"]);
    expect(factionKeywordLabels(dump(), ["fk-sm", "fk-cust"])).toEqual([
      "Adeptus Astartes",
      "Adeptus Custodes",
    ]);
  });

  it("collects unresolved ids and collapses an all-empty result to null", () => {
    const unresolved: string[] = [];
    expect(keywordLabels(dump(), ["k-noen", "ghost"], unresolved)).toBeNull();
    expect(unresolved.sort()).toEqual(["ghost", "k-noen"]);
    expect(keywordLabels(dump(), [])).toBeNull();
  });
});
