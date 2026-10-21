import { describe, expect, it } from "vitest";
import { MfmDump } from "../src/mfm/loader.js";
import { deriveWargear } from "../src/mfm/wargear.js";

/**
 * A Broadside-shaped dump: the default size is the leader miniature alone (the wingman listed at
 * 0/0), larger sizes add wingmen, and each miniature has its own menu of up to two drones. With
 * `wingmanSizes` false the datasheet only ever fields the leader.
 */
function tieredDump(wingmanSizes = true): MfmDump {
  const wi = (id: string, name: string) => ({ id, wargearType: "wargear", localisations: { en: { name } } });
  const choice = (setId: string, choiceId: string, itemId: string) => ({
    choice: { id: choiceId, loadoutChoiceSetId: setId },
    item: { id: `${choiceId}-item`, count: 1, wargearItemId: itemId, loadoutChoiceId: choiceId },
  });
  const choices = [
    choice("lcs-lead", "l-gun", "wi-gun"),
    choice("lcs-lead", "l-shield", "wi-shield"),
    choice("lcs-wing", "w-gun", "wi-gun"),
    choice("lcs-wing", "w-shield", "wi-shield"),
  ];
  const sizes = [
    { id: "uc-1", isDefault: true, displayOrder: 1, rows: [["m-lead", 1], ["m-wing", 0]] },
    ...(wingmanSizes ? [{ id: "uc-3", isDefault: false, displayOrder: 2, rows: [["m-lead", 1], ["m-wing", 2]] }] : []),
  ] as const;
  return new MfmDump({
    data: {
      miniature: [
        { id: "m-lead", displayOrder: 0, localisations: { en: { name: "Leader" } } },
        { id: "m-wing", displayOrder: 1, localisations: { en: { name: "Wingman" } } },
      ],
      unit_composition: sizes.map(({ id, isDefault, displayOrder }) => ({ id, datasheetId: "ds", isDefault, displayOrder, points: 100, referenceGroupingKeywordId: null })),
      unit_composition_miniature: sizes.flatMap(({ id, rows }) => rows.map(([miniatureId, count]) => ({
        id: `${id}-${miniatureId}`, min: count, max: count, unitCompositionId: id, miniatureId,
      }))),
      wargear_item: [wi("wi-gun", "Gun pod"), wi("wi-shield", "Shield pod")],
      wargear_option_group: [],
      wargear_option: [],
      loadout_choice_set: [
        { id: "lcs-lead", limit: 2, allowDuplicates: true, datasheetId: "ds", miniatureId: "m-lead", alternate: false },
        { id: "lcs-wing", limit: 2, allowDuplicates: true, datasheetId: "ds", miniatureId: "m-wing", alternate: false },
      ],
      loadout_choice: choices.map((c) => c.choice),
      loadout_choice_wargear_item: choices.map((c) => c.item),
      limited_wargear_choice_set: [],
      limited_wargear_choice: [],
      limited_wargear_choice_wargear_item: [],
      wargear_limit: [],
    },
  });
}

const VALID = new Set(["gun-pod", "shield-pod"]);
const resolve = (name: string) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return VALID.has(id) ? id : null;
};

describe("per-miniature menus across composition sizes", () => {
  it("scopes each miniature's menu to it when only a larger size fields both", () => {
    // Unscoped, both menus would apply to every model: four drones each instead of two.
    const scopes = deriveWargear(tieredDump(), "ds", resolve).options.map((option) => option.model_constraint);
    expect(scopes).toHaveLength(2);
    expect(scopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ model_name: "Leader", max_count: 2 }),
      expect.objectContaining({ model_name: "Wingman", max_count: 2 }),
    ]));
  });

  it("leaves a single-miniature datasheet's menu unscoped", () => {
    const scopes = deriveWargear(tieredDump(false), "ds", resolve).options.map((option) => option.model_constraint);
    expect(scopes.every((scope) => scope?.model_name === undefined)).toBe(true);
  });
});
