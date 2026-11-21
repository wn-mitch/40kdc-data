import { describe, expect, it } from "vitest";
import {
  enhancementFlags,
  reconcileEnhancementFlags,
  weaponIdsByWargearItem,
} from "../src/mfm/enhancement-flags.js";
import { syncMaxModelCount } from "../src/mfm/wargear.js";
import { Dataset } from "../src/data/index.js";
import type { EnhancementRow } from "../src/mfm/loader.js";

const row = (flags: Partial<EnhancementRow>): EnhancementRow =>
  ({
    id: "e",
    detachmentId: "d",
    basePointsCost: 10,
    cannotBeWarlord: false,
    isIncludedInEnhancementLimit: true,
    isEquipableByEpicHero: false,
    isEquipableByNonCharacterUnit: false,
    ...flags,
  }) as EnhancementRow;

describe("enhancement flags from the dump", () => {
  const weapons = new Map<string, string | null>([["item", "bolter"], ["twice", null]]);

  it("writes only the flags that differ from the schema default", () => {
    const record: Record<string, unknown> = { id: "e" };
    const flags = enhancementFlags(
      row({ isIncludedInEnhancementLimit: false, isEquipableByEpicHero: true, cannotBeWarlord: true }),
      ["item"],
      weapons,
    );
    reconcileEnhancementFlags(record, flags);
    expect(record).toEqual({
      id: "e",
      counts_toward_enhancement_limit: false,
      equipable_by_epic_hero: true,
      bearer_cannot_be_warlord: true,
      required_wargear_ids: ["bolter"],
    });
  });

  it("removes a stale flag the dump now leaves at its default", () => {
    const record: Record<string, unknown> = {
      id: "e",
      counts_toward_enhancement_limit: false,
      equipable_by_non_character: true,
      required_wargear_ids: ["bolter"],
    };
    const changes = reconcileEnhancementFlags(record, enhancementFlags(row({}), [], weapons));
    expect(record).toEqual({ id: "e" });
    expect(changes.map((c) => c.field).sort()).toEqual([
      "counts_toward_enhancement_limit",
      "equipable_by_non_character",
      "required_wargear_ids",
    ]);
  });

  it("removes an explicit default without reporting a change", () => {
    const record: Record<string, unknown> = { id: "e", counts_toward_enhancement_limit: true };
    expect(reconcileEnhancementFlags(record, enhancementFlags(row({}), [], weapons))).toEqual([]);
    expect(record).toEqual({ id: "e" });
  });

  it("leaves required wargear as authored when an item resolves to no single weapon", () => {
    const record: Record<string, unknown> = { id: "e", required_wargear_ids: ["authored"] };
    for (const items of [["twice"], ["absent"]]) {
      const flags = enhancementFlags(row({}), items, weapons);
      expect(flags.unresolvedWargearItemIds).toEqual(items);
      reconcileEnhancementFlags(record, flags);
      expect(record.required_wargear_ids).toEqual(["authored"]);
    }
  });

  it("resolves a wargear item through the weapon carrying its mfm ref", () => {
    // Iron Ambassador's required Autoch-pattern combi-bolter.
    expect(weaponIdsByWargearItem().get("481056d1-ccca-4bd2-b739-d757f1de7949")).toBe("autoch-pattern-combi-bolter");
  });
});

describe("max_model_count", () => {
  it("sets, keeps and clears the datasheet's model cap", () => {
    const unit: { max_model_count?: number } = {};
    expect(syncMaxModelCount(unit, 10)).toBe(true);
    expect(unit.max_model_count).toBe(10);
    expect(syncMaxModelCount(unit, 10)).toBe(false);
    expect(syncMaxModelCount(unit, null)).toBe(true);
    expect("max_model_count" in unit).toBe(false);
  });

  it("refuses every loadout query above the cap and none at it", () => {
    const ds = Dataset.embedded();
    const raw = ds.units.getAny("corsair-voidscarred")!.raw;
    expect(raw.max_model_count).toBe(10);
    const loadout = ds.loadoutOf(raw);
    const at = loadout.base(10)!;
    expect(loadout.check(10, at)).toEqual([]);
    expect(loadout.candidates(10, 1).length).toBeGreaterThan(0);
    expect(loadout.check(11, new Map())).toEqual([
      { id: "corsair-voidscarred", code: "invalid-model-count", message: "corsair-voidscarred: no squad size has 11 models" },
    ]);
    expect(loadout.base(11)).toBeNull();
    expect(loadout.bounds(11)).toBeNull();
    expect(loadout.maximal(11)).toBeNull();
    expect(loadout.complete(11, new Map())).toBeNull();
    expect(loadout.candidates(11)).toEqual([]);
  });
});
