import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { meetsEnhancementGroups } from "../src/data/enhancement-eligibility.js";
import { canTakeEnhancement } from "../src/data/lever-providers.js";
import type { Enhancement } from "../src/generated.js";

const base = { id: "fabricated-relic", name: "Fabricated Relic", detachment_id: "fabricated", cost: 10, game_version: { edition: "11th", dataslate: "mfm-995" } } as Enhancement;
const holds = (keywords: string[]) => (keyword: string) => keywords.includes(keyword);

describe("meetsEnhancementGroups", () => {
  it("admits any bearer only when no group of either kind is present", () => {
    expect(meetsEnhancementGroups(base, "any-unit", holds([]))).toBe(true);
  });

  it("restricts a record whose only groups are datasheet-scoped", () => {
    const record = { ...base, datasheet_restriction_groups: [{ unit_id: "squad-a", keywords: ["Faction"] }] } as Enhancement;
    expect(meetsEnhancementGroups(record, "squad-b", holds(["Faction", "Squad A"]))).toBe(false);
    expect(meetsEnhancementGroups(record, "squad-a", holds([]))).toBe(false);
    expect(meetsEnhancementGroups(record, "squad-a", holds(["Faction"]))).toBe(true);
  });

  it("reads datasheet groups as alternatives to the keyword groups", () => {
    const record = { ...base, keyword_restrictions: ["Infantry", "Leader"], datasheet_restriction_groups: [{ unit_id: "squad-a" }] } as Enhancement;
    expect(meetsEnhancementGroups(record, "squad-b", holds(["Infantry", "Leader"]))).toBe(true);
    expect(meetsEnhancementGroups(record, "squad-a", holds([]))).toBe(true);
    expect(meetsEnhancementGroups(record, "squad-b", holds(["Infantry"]))).toBe(false);
  });
});

describe("canTakeEnhancement on the embedded data", () => {
  const ds = Dataset.embedded();
  const hat = ds.enhancements.get("kaptins-hat-wreckas-orks")!;
  const unit = (id: string) => ds.units.getInFaction(id, "orks")!;

  it("keeps the datasheet group to its datasheet", () => {
    expect(hat.datasheet_restriction_groups).toEqual([{ unit_id: "big-mek" }]);
    expect(canTakeEnhancement(ds, hat, unit("big-mek"))).toBe(true);
    expect(canTakeEnhancement(ds, hat, unit("big-mek-dakkarig"))).toBe(false);
  });
});
