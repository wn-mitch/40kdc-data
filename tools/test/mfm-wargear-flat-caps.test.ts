import { describe, expect, it } from "vitest";
import { MfmDump } from "../src/mfm/loader.js";
import { deriveWargear, limitedSetBudgets } from "../src/mfm/wargear.js";

/**
 * A Legionaries-shaped dump: the champion and the troopers can each swap their
 * bolter for a heavy blade, and a trooper-scoped limited set caps the troopers'
 * heavy blades at one per unit (`modelCount = 0`). Because the champion may also
 * take the blade, no unit budget can carry the cap; the trooper option must.
 */
function flatCapDump(flatLimit: number, limitedMini = "m-troop", troopSword = true): MfmDump {
  const wi = (id: string, name: string) => ({ id, wargearType: "weapon", localisations: { en: { name } } });
  const choice = (setId: string, choiceId: string, itemId: string) => ({
    choice: { id: choiceId, loadoutChoiceSetId: setId },
    item: { id: `${choiceId}-item`, count: 1, wargearItemId: itemId, loadoutChoiceId: choiceId },
  });
  const choices = [
    choice("lcs-champ", "c-bolter", "wi-bolter"),
    choice("lcs-champ", "c-blade", "wi-blade"),
    choice("lcs-troop", "t-bolter", "wi-bolter"),
    ...(troopSword ? [choice("lcs-troop", "t-sword", "wi-sword")] : []),
    choice("lcs-troop", "t-blade", "wi-blade"),
  ];
  const baseOption = (id: string, group: string, inputType: string, defaultValue: number) => ({
    id, wargearItemId: "wi-bolter", wargearOptionGroupId: group, inputType, defaultValue, points: 0, displayOrder: 1,
  });
  return new MfmDump({
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
      wargear_item: [wi("wi-bolter", "Bolter"), wi("wi-sword", "Sword"), wi("wi-blade", "Heavy blade")],
      wargear_option_group: [
        { id: "g-c", displayOrder: 1, datasheetId: "ds", miniatureId: "m-champ", isStaticWargear: false },
        { id: "g-t", displayOrder: 2, datasheetId: "ds", miniatureId: "m-troop", isStaticWargear: false },
      ],
      wargear_option: [baseOption("wo-c", "g-c", "checkbox", 1), baseOption("wo-t", "g-t", "stepper", 4)],
      loadout_choice_set: [
        { id: "lcs-champ", limit: 1, allowDuplicates: false, datasheetId: "ds", miniatureId: "m-champ", alternate: false },
        { id: "lcs-troop", limit: 1, allowDuplicates: false, datasheetId: "ds", miniatureId: "m-troop", alternate: false },
      ],
      loadout_choice: choices.map((c) => c.choice),
      loadout_choice_wargear_item: choices.map((c) => c.item),
      limited_wargear_choice_set: [{ id: "lim-blade", mandatory: false, datasheetId: "ds", miniatureId: limitedMini }],
      limited_wargear_choice: [{ id: "lwc-blade", limitedWargearChoiceSetId: "lim-blade" }],
      limited_wargear_choice_wargear_item: [{ id: "li-blade", count: 1, wargearItemId: "wi-blade", limitedWargearChoiceId: "lwc-blade" }],
      wargear_limit: [{ id: "wl-blade", modelCount: 0, choiceLimit: flatLimit, duplicateLimit: null, limitedWargearChoiceSetId: "lim-blade" }],
    },
  });
}

const VALID = new Set(["bolter", "sword", "heavy-blade"]);
const resolve = (name: string) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return VALID.has(id) ? id : null;
};

describe("mini-scoped flat wargear caps", () => {
  it("caps the trooper's limited swap without capping the any-number swap in the same menu", () => {
    const troop = deriveWargear(flatCapDump(1), "ds", resolve).options
      .filter((option) => option.model_constraint?.model_name === "Trooper");
    expect(troop).toHaveLength(2);
    expect(troop).toEqual(expect.arrayContaining([
      { model_constraint: { model_name: "Trooper", any_number: true }, replaces: ["bolter"], replacement: ["sword"] },
      { model_constraint: { model_name: "Trooper", max_count: 1 }, replaces: ["bolter"], replacement: ["heavy-blade"] },
    ]));
  });

  it("reads the cap from the dump rather than defaulting to one", () => {
    const blade = deriveWargear(flatCapDump(2), "ds", resolve).options
      .find((option) => option.model_constraint?.model_name === "Trooper" && option.replacement?.[0] === "heavy-blade");
    expect(blade?.model_constraint).toEqual({ model_name: "Trooper", max_count: 2 });
  });

  it("binds a mini-scoped flat cap only on that miniature's swap", () => {
    // The champion-only allowance must not cap the troopers' blade swap: the
    // flat cap is per-miniature, and the trooper row has no limited set.
    const options = deriveWargear(flatCapDump(1, "m-champ", false), "ds", resolve).options;
    const blade = (model: string) =>
      options.find((o) => o.model_constraint?.model_name === model && o.replacement?.[0] === "heavy-blade");
    expect(blade("Champion")?.model_constraint).toEqual({ model_name: "Champion", max_count: 1 });
    expect(blade("Trooper")?.model_constraint).toEqual({ model_name: "Trooper", any_number: true });
  });

  it("emits no unit budget for a weapon another miniature may also take", () => {
    const options = deriveWargear(flatCapDump(1), "ds", resolve).options.map((option) => ({
      id: "x", unit_id: "u", faction_id: "f", game_version: { edition: "11th", dataslate: "launch" }, ...option,
    }));
    expect(limitedSetBudgets(flatCapDump(1), "ds", resolve, options as never)).toEqual([]);
  });
});
