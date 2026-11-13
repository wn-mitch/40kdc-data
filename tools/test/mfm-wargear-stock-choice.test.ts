import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/index.js";
import { validateLoadout, type LoadoutModel } from "../src/data/loadout.js";
import { MfmDump } from "../src/mfm/loader.js";
import { limitedSetBudgets } from "../src/mfm/wargear.js";
import { partialDump } from "./mfm-fixture.js";

const wi = (id: string, name: string) => ({ id, wargearType: "weapon", localisations: { en: { name } } });
const resolve = (name: string) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return ["launcher", "rokkit"].includes(id) ? id : null;
};

/**
 * Five troopers that each carry a launcher, and a flat set of `picks` choices: the stock five
 * launchers, one rokkit, or one more launcher.
 */
function stockChoiceDump(picks: number, duplicateLimit: number | null, stockCopies = 5): MfmDump {
  return partialDump({
    data: {
      miniature: [{ id: "m-troop", displayOrder: 1, localisations: { en: { name: "Trooper" } } }],
      unit_composition: [{ id: "uc", datasheetId: "ds", isDefault: true, displayOrder: 1, points: 100, referenceGroupingKeywordId: null }],
      unit_composition_miniature: [{ id: "ucm", min: 5, max: 5, unitCompositionId: "uc", miniatureId: "m-troop" }],
      wargear_item: [wi("wi-launcher", "Launcher"), wi("wi-rokkit", "Rokkit")],
      wargear_option_group: [{ id: "g", displayOrder: 1, datasheetId: "ds", miniatureId: "m-troop", isStaticWargear: false }],
      wargear_option: [{ id: "wo-l", wargearItemId: "wi-launcher", wargearOptionGroupId: "g", inputType: "checkbox", defaultValue: 1, points: 0, displayOrder: 1 }],
      base_miniature_loadout: [{ id: "m-troop", datasheetId: "ds", miniatureId: "m-troop" }],
      base_miniature_loadout_wargear_option: [{ id: "b", count: 1, wargearOptionId: "wo-l", baseMiniatureLoadoutId: "m-troop" }],
      limited_wargear_choice_set: [{ id: "lim", mandatory: false, datasheetId: "ds", miniatureId: "m-troop" }],
      limited_wargear_choice: [
        { id: "stock", limitedWargearChoiceSetId: "lim" },
        { id: "rokkit", limitedWargearChoiceSetId: "lim" },
        { id: "extra", limitedWargearChoiceSetId: "lim" },
      ],
      limited_wargear_choice_wargear_item: [
        { id: "i-stock", count: stockCopies, wargearItemId: "wi-launcher", limitedWargearChoiceId: "stock" },
        { id: "i-rokkit", count: 1, wargearItemId: "wi-rokkit", limitedWargearChoiceId: "rokkit" },
        { id: "i-extra", count: 1, wargearItemId: "wi-launcher", limitedWargearChoiceId: "extra" },
      ],
      wargear_limit: [{ id: "wl", modelCount: 0, choiceLimit: picks, duplicateLimit, limitedWargearChoiceSetId: "lim" }],
    },
  });
}

describe("a limited set that lists the stock loadout as a choice", () => {
  it("caps the stock item and the extras by the picks the stock choice leaves", () => {
    expect(limitedSetBudgets(stockChoiceDump(2, 1), "ds", resolve)).toContainEqual(
      { items: ["launcher", "rokkit"], count: 6, per_models: 0 },
    );
  });

  it("lets each remaining pick repeat an extra only up to the duplicate limit", () => {
    expect(limitedSetBudgets(stockChoiceDump(3, 1), "ds", resolve)).toContainEqual(
      { items: ["launcher", "rokkit"], count: 7, per_models: 0 },
    );
    expect(limitedSetBudgets(stockChoiceDump(3, null), "ds", resolve)).toContainEqual(
      { items: ["launcher", "rokkit"], count: 7, per_models: 0 },
    );
  });

  it("emits no stock budget for a set without a stock choice", () => {
    expect(limitedSetBudgets(stockChoiceDump(2, 1, 1), "ds", resolve).some((budget) => budget.items.includes("launcher"))).toBe(false);
  });
});

describe("Tankbustas' extra rokkit", () => {
  const dataset = Dataset.embedded();
  const unit = dataset.units.getInFaction("tankbustas", "orks")!;
  const options = dataset.wargearOptionsOf(unit.raw);
  const models = (dataset.unitCompositionOf(unit.raw) as { models?: LoadoutModel[] } | undefined)?.models;
  const loadout = (launchas: number, pulsas: number) => new Map([
    ["busta-rokkit-launcha", launchas],
    ["gitstikka", 5],
    ["choppa-tankbustas", 1],
    ["rokkit-pistol-tankbustas", 2],
    ...(pulsas > 0 ? [["pulsa-rokkit-once-per-battle-per-unit", pulsas] as [string, number]] : []),
  ]);
  const legal = (launchas: number, pulsas: number) => validateLoadout(unit.raw, 6, options, loadout(launchas, pulsas), models).length === 0;

  it("allows one Tankbusta an extra busta rokkit launcha or a pulsa rokkit", () => {
    expect(legal(5, 0)).toBe(true);
    expect(legal(6, 0)).toBe(true);
    expect(legal(5, 1)).toBe(true);
  });

  it("rejects a second extra", () => {
    expect(legal(7, 0)).toBe(false);
    expect(legal(10, 0)).toBe(false);
    expect(legal(6, 1)).toBe(false);
  });
});
