import { describe, expect, it } from "vitest";
import { MfmDump } from "../src/mfm/loader.js";
import { deriveWargear, limitedSetBudgets } from "../src/mfm/wargear.js";
import { partialDump } from "./mfm-fixture.js";

const wi = (id: string, name: string) => ({ id, wargearType: "weapon", localisations: { en: { name } } });

/**
 * One single-pick champion menu over a bolter + pistol base. Each branch is a
 * list of wargear item ids; the trooper exists only to make the datasheet
 * multi-model.
 */
function champMenuDump(branches: string[][]): MfmDump {
  const choices = branches.map((items, i) => ({ id: `c${i}`, loadoutChoiceSetId: "lcs" }));
  const items = branches.flatMap((ids, i) =>
    ids.map((wargearItemId, j) => ({ id: `c${i}-${j}`, count: 1, wargearItemId, loadoutChoiceId: `c${i}` })),
  );
  const base = (id: string, item: string) => ({
    id, wargearItemId: item, wargearOptionGroupId: "g-c", inputType: "checkbox", defaultValue: 1, points: 0, displayOrder: 1,
  });
  return partialDump({
    data: {
      miniature: [
        { id: "m-champ", displayOrder: 0, localisations: { en: { name: "Champion" } } },
        { id: "m-troop", displayOrder: 1, localisations: { en: { name: "Trooper" } } },
      ],
      unit_composition: [{ id: "uc", datasheetId: "ds", isDefault: true, displayOrder: 1, points: 100, referenceGroupingKeywordId: null }],
      unit_composition_miniature: [
        { id: "ucm-c", min: 1, max: 1, unitCompositionId: "uc", miniatureId: "m-champ" },
        { id: "ucm-t", min: 4, max: 9, unitCompositionId: "uc", miniatureId: "m-troop" },
      ],
      wargear_item: [
        wi("wi-bolter", "Bolter"), wi("wi-pistol", "Pistol"), wi("wi-plasma", "Plasma"),
        wi("wi-blade", "Blade"), wi("wi-hammer", "Hammer"),
      ],
      wargear_option_group: [{ id: "g-c", displayOrder: 1, datasheetId: "ds", miniatureId: "m-champ", isStaticWargear: false }],
      wargear_option: [base("wo-b", "wi-bolter"), base("wo-p", "wi-pistol")],
      loadout_choice_set: [{ id: "lcs", limit: 1, allowDuplicates: false, datasheetId: "ds", miniatureId: "m-champ", alternate: false }],
      loadout_choice: choices,
      loadout_choice_wargear_item: items,
      limited_wargear_choice_set: [],
      limited_wargear_choice: [],
      limited_wargear_choice_wargear_item: [],
      wargear_limit: [],
    },
  });
}

const VALID = new Set(["bolter", "pistol", "plasma", "blade", "hammer", "shield"]);
const resolve = (name: string) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return VALID.has(id) ? id : null;
};

describe("single-pick menus whose swaps would stack", () => {
  it("keeps the menu as one option when a stack of its swaps is not a listed branch", () => {
    // Bolter→plasma and pistol→plasma are each listed, but two plasmas are not.
    const { options } = deriveWargear(champMenuDump([
      ["wi-bolter", "wi-pistol"],
      ["wi-plasma", "wi-pistol"],
      ["wi-bolter", "wi-plasma"],
      ["wi-blade", "wi-plasma"],
    ]), "ds", resolve);
    expect(options).toHaveLength(1);
    expect(options[0].replaces).toEqual(["bolter", "pistol"]);
    expect(options[0].replacement_choice).toEqual(expect.arrayContaining([
      ["plasma", "pistol"], ["bolter", "plasma"], ["blade", "plasma"],
    ]));
    expect(options[0].replacement_choice).toHaveLength(3);
  });

  it("keeps overlapping swaps apart, since they cannot stack", () => {
    // Bolter→blade and bolter+pistol→hammer both consume the bolter.
    const { options } = deriveWargear(champMenuDump([
      ["wi-bolter", "wi-pistol"],
      ["wi-blade", "wi-pistol"],
      ["wi-hammer"],
    ]), "ds", resolve);
    expect(options.map((o) => [o.replaces, o.replacement])).toEqual(expect.arrayContaining([
      [["bolter"], ["blade"]],
      [["bolter", "pistol"], ["hammer"]],
    ]));
    expect(options).toHaveLength(2);
  });
});

/** A trooper menu swapping a bolter for a shield, limited to `count` per `per` models. */
function shieldLimitDump(count: number, per: number): MfmDump {
  return partialDump({
    data: {
      miniature: [{ id: "m-troop", displayOrder: 1, localisations: { en: { name: "Trooper" } } }],
      wargear_item: [wi("wi-shield", "Shield")],
      limited_wargear_choice_set: [{ id: "lim", mandatory: false, datasheetId: "ds", miniatureId: "m-troop" }],
      limited_wargear_choice: [{ id: "lwc", limitedWargearChoiceSetId: "lim" }],
      limited_wargear_choice_wargear_item: [{ id: "li", count: 1, wargearItemId: "wi-shield", limitedWargearChoiceId: "lwc" }],
      wargear_limit: [{ id: "wl", modelCount: per, choiceLimit: count, duplicateLimit: null, limitedWargearChoiceSetId: "lim" }],
    },
  });
}

describe("single-weapon ratio allowances", () => {
  const options = [{
    id: "x", unit_id: "u", faction_id: "f", game_version: { edition: "11th", dataslate: "launch" },
    replaces: ["bolter"], replacement: ["shield"], model_constraint: { model_name: "Trooper", any_number: true },
  }];

  it("budgets a k-per-N ratio no per-option cap can express", () => {
    expect(limitedSetBudgets(shieldLimitDump(2, 5), "ds", resolve, options as never)).toEqual([
      { items: ["shield"], count: 2, per_models: 5 },
    ]);
  });

  it("leaves a 1-per-N ratio to the per-option cap", () => {
    expect(limitedSetBudgets(shieldLimitDump(1, 5), "ds", resolve, options as never)).toEqual([]);
  });
});
