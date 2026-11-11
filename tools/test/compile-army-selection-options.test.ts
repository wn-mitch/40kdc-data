import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, items: Item[]) {
  const result = compileLeaves(placed(text, items), text, { abilityId: "fabricated-boons", name: "Boons" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, any>;
}

const refused = (text: string, items: Item[]) => {
  const result = compileLeaves(placed(text, items), text, { abilityId: "fabricated-boons", name: "Boons" });
  return result.ok ? [] : result.errors;
};

const ALPHA_MODELS = { owner: "friendly", level: "model", all_of: ["ALPHA", "INFANTRY"], none_of: ["BETA"] };
const STATS = ["A", "S", "AP", "T", "D", "BS"];
const NAMES = ["Swift", "Keen", "Hard", "Tough", "Strong", "Steady"];

/** Six numbered options, each a change "equipped by this model". */
function optionsOn(subject: string): { body: string; items: Item[] } {
  let body = "";
  const items: Item[] = [];
  NAMES.forEach((name, at) => {
    const change = `Add 1 to the ${STATS[at]} characteristic of weapons equipped by this model`;
    body += `\n${at + 1} - ${name}: ${change}.`;
    items.push([`${at + 1} - ${name}`, "named-option", { label: name, option_id: name.toLowerCase() }]);
    items.push([change, "characteristic-modifier", { subject, characteristics: [STATS[at]], operation: "add", value: 1, weapon_type: "all" }]);
  });
  return { body, items };
}

const LEAD = "At the start of the battle, select which boons are active for ALPHA INFANTRY models (excluding BETA models) from your army until the end of the battle. To do so, either select one from the list below, or randomly determine two by rolling two D6.";
const REROLL = " If GAMMA LORD is your WARLORD, when randomly determining your boons, you can re-roll one or both of the dice.";
const leadItems: Item[] = [
  ["At the start of the battle", "event", { kind: "battle-started" }],
  ["ALPHA INFANTRY models (excluding BETA models)", "unit-filter", { side: "friendly", keywords: ["ALPHA", "INFANTRY"], excluded_keywords: ["BETA"], level: "model" }],
  ["from your army", "unit-owner", { owner: "friendly" }],
  ["until the end of the battle", "duration", { endpoint: "end-of-battle" }],
  ["select one from the list below, or randomly determine two by rolling two D6", "stance-select-open", { scope: "army", mode: "re-selectable", min_choices: 1, max_choices: 1, or_random: { dice: "D6", count: 2 } }],
];
const rerollItems: Item[] = [
  ["If", "army-includes", { quantifier: "some", with: "following-filter" }],
  ["GAMMA LORD", "unit-filter", { side: "friendly", keywords: ["GAMMA LORD"], level: "model" }],
  ["is your WARLORD", "designated-filter", { subject: "antecedent", tag: "warlord" }],
  ["when randomly determining your boons", "event", { kind: "used", activity: "ability", id: "fabricated-boons" }],
  ["you can", "optional-use", { who: "you" }],
  ["re-roll one or both of the dice", "reroll", { roll: { ability: "fabricated-boons" }, subset: "all", weapon_type: "all" }],
];

describe("a selection made for the models a lead sentence names", () => {
  it("gives each option's \"this model\" change to those models only", () => {
    const { body, items } = optionsOn("this-model");
    const selection = compiled(LEAD + body, [...leadItems, ...items]).effect;
    expect(selection.type).toBe("stance-select");
    expect(selection.options).toHaveLength(6);
    for (const option of selection.options) expect(option.effect.target).toEqual(ALPHA_MODELS);
  });

  it("refuses an option that changes something other than a characteristic of \"this model\"", () => {
    const { body, items } = optionsOn("this-model");
    const text = LEAD + body.replace("Add 1 to the A characteristic of weapons equipped by this model", "This model has the Stealth ability");
    const swapped = items.map((item): Item => item[0].startsWith("Add 1 to the A ")
      ? ["This model has the Stealth ability", "core-ability-grant", { subject: "this-model", ability: "stealth" }] : item);
    expect(refused(text, [...leadItems, ...swapped]).join(" ")).toMatch(/one of the models the selection is made for/u);
  });

  it("keeps a roll-only sentence before the options beside the selection, not inside every option", () => {
    const { body, items } = optionsOn("this-model");
    const mechanics = compiled(LEAD + REROLL + body, [...leadItems, ...rerollItems, ...items]);
    const [pick, reroll] = mechanics.effect.steps;
    expect(pick.effect.type).toBe("stance-select");
    expect(JSON.stringify(pick)).not.toContain("re-roll");
    expect(reroll).toEqual({
      type: "ability-part",
      trigger: { event: "used", filter: { kind: "ability", id: "fabricated-boons" }, optional: true },
      effect: {
        type: "conditional",
        condition: { type: "army-includes", parameters: { filter: { owner: "friendly", all_of: ["GAMMA LORD"], level: "model", designated: "warlord" } } },
        effect: { type: "re-roll", target: "this-unit", modifier: { roll: { of_ability: "fabricated-boons" }, result_scope: "any-result" } },
      },
    });
  });
});

describe("characteristic-modifier subject army-models", () => {
  it("names the army's models with the leaf's keywords, in one leaf spanning \"… models from your army by 1\"", () => {
    const text = "Improve the Leadership characteristic of ALPHA models from your army by 1.";
    const effect = compiled(text, [[text.slice(0, -1), "characteristic-modifier", { subject: "army-models", model_keywords: ["ALPHA"], characteristics: ["Ld"], operation: "improve", value: 1, weapon_type: "all" }]]).effect;
    expect(effect).toEqual({ type: "stat-modifier", target: { owner: "friendly", level: "model", all_of: ["ALPHA"] }, modifier: { stat: "Ld", operation: "improve", value: 1 } });
  });

  it("is refused before version 21", () => {
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { subject: "army-models", characteristics: ["Ld"], operation: "improve", value: 1, weapon_type: "all" }, 20)).toThrow();
  });
});

describe("attack-filter weapon_selected_for", () => {
  const text = "Your unit's ranged attacks with weapons selected for the Firing Deck ability have +1 to hit rolls.";
  it("gates the change on attacks with the weapons the ability selected", () => {
    const effect = compiled(text, [
      ["Your unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      ["with weapons selected for the Firing Deck", "attack-filter", { weapon_selected_for: "firing-deck" }],
      ["have +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]).effect;
    expect(effect.condition.operands).toContainEqual({ type: "attack-is", parameters: { weapons: { ref: { selected_by: { ability: "firing-deck" } } } } });
  });

  it("takes only a weapon-selecting core ability, and nothing that narrows the weapons another way", () => {
    expect(() => normalizeFingerprintParameters("attack-filter", { weapon_selected_for: "deep-strike" }, 5)).toThrow();
    expect(() => normalizeFingerprintParameters("attack-filter", { weapon_selected_for: "firing-deck", weapon_keyword: "Torrent" }, 5)).toThrow();
    expect(() => normalizeFingerprintParameters("attack-filter", { weapon_selected_for: "firing-deck" }, 4)).toThrow();
  });
});
