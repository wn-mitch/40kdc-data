import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "The Gloom omen is active from the start of the battle. At the start of the battle round, you can select one other omen or randomly select two omens by rolling two D3.\n"
  + "**Gloom**\nThis model has **Stealth**.\n"
  + "**1 - Hush**\nWhile an enemy unit that is Battle-shocked is within 6\" of this model, worsen the Leadership characteristic of models in that unit by 1.\n"
  + "**2 - Murk**\nThis model has **Lone Operative**.\n"
  + "**3 - Pall**\nThis model has **Infiltrators**.";

const OPENER = (random: Record<string, unknown> | null = { dice: "D3", count: 2 }): Item => ["select one other omen or randomly select two omens by rolling two D3", "stance-select-open",
  { scope: "army", mode: "consumable", additive: true, min_choices: 1, max_choices: 1, ...(random ? { or_random: random } : {}) }];
const ITEMS = (opener = OPENER(), extra: Item[] = []): Item[] => [
  ["The Gloom omen is active from the start of the battle", "stance-initial", { option_id: "gloom" }],
  ["At the start of the battle round", "turn-start", { turn: "battle-round" }],
  ["you can", "optional-use", { who: "you" }],
  opener,
  ["Gloom", "named-option", { label: "Gloom", option_id: "gloom" }],
  ["This model has **Stealth", "core-ability-grant", { subject: "this-model", ability: "stealth" }],
  ["1 - Hush", "named-option", { label: "Hush", option_id: "hush" }],
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["that is Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "antecedent", negated: false }],
  ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
  ["worsen the Leadership characteristic of models in that unit by 1", "characteristic-modifier", { subject: "antecedent", characteristics: ["Ld"], operation: "worsen", value: 1, weapon_type: "all" }],
  ["2 - Murk", "named-option", { label: "Murk", option_id: "murk" }],
  ["This model has **Lone Operative", "core-ability-grant", { subject: "this-model", ability: "lone-operative" }],
  ["3 - Pall", "named-option", { label: "Pall", option_id: "pall" }],
  ["This model has **Infiltrators", "core-ability-grant", { subject: "this-model", ability: "infiltrators" }],
  ...extra,
];

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, {});
}

function stanceOf(items: Item[], text = TEXT): any {
  const result = compiled(items, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as any).effect;
}

describe("a stance pick that may instead be rolled (stance-select-open or_random)", () => {
  it("numbers the faces by the options other than the one in force from the start, in order", () => {
    const stance = stanceOf(ITEMS());
    expect(stance).toMatchObject({ type: "stance-select", mode: "consumable", additive: true, initial: "gloom", or_random: { dice: "D3", count: 2, faces: ["hush", "murk", "pall"] } });
    expect(describeAbility({ id: "sample", name: "Sample", effect: stance } as any)).toContain("Or, instead of selecting, roll two D3: each result applies the option it numbers (1 Hush, 2 Murk, 3 Pall); a result already active has no additional effect.");
  });

  it("refuses a die whose faces do not match the numbered options", () => {
    const result = compiled(ITEMS(OPENER({ dice: "D6", count: 2 })));
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/needs exactly 6 numbered options besides the one in force from the start; found 3/u);
  });

  it("leaves a stance without or_random as a plain pick", () => {
    expect(stanceOf(ITEMS(OPENER(null))).or_random).toBeUndefined();
  });

  it("takes dice D3 or D6 and a count of 1 to 3, nothing else", () => {
    const version = currentFamilyVersion("stance-select-open");
    const normalize = (or_random: unknown) => normalizeFingerprintParameters("stance-select-open", { scope: "army", mode: "consumable", or_random }, version);
    expect(normalize({ dice: "D6", count: 2 })).toMatchObject({ or_random: { dice: "D6", count: 2 } });
    expect(() => normalize({ dice: "D8", count: 2 })).toThrow(/or_random\.dice/u);
    expect(() => normalize({ dice: "D6", count: 4 })).toThrow(/or_random\.count/u);
    expect(() => normalize({ dice: "D6", count: 2, faces: ["a"] })).toThrow(/only dice and count/u);
    expect(() => normalize("D6")).toThrow(/an object with dice and count/u);
  });
});

describe("a state of the units an aura reaches, printed between its filter and its range (compile-unit-filters.ts)", () => {
  it("tests each unit the aura reaches", () => {
    const hush = stanceOf(ITEMS()).options.find((option: any) => option.id === "hush").effect;
    expect(hush).toEqual({ type: "aura", target: "enemy-within-aura", modifier: {
      range: { inches: 6 }, eligible: { owner: "enemy" },
      effect: { type: "conditional", condition: { type: "matches", parameters: { subject: "recipient", filter: { state: "battle-shocked" } } },
        effect: { type: "stat-modifier", target: "recipient", modifier: { stat: "Ld", operation: "worsen", value: 1 } } },
    } });
  });

  it("does not take a state of another unit as one of the aura's units", () => {
    const items = ITEMS().map((item): Item => item[0] === "that is Battle-shocked" ? [item[0], "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false }] : item);
    const result = compiled(items);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/A unit-filter needs a select-unit or attack right before it, or an aura-range/u);
  });

  it("still needs the range right after the states", () => {
    const text = TEXT.replace("that is Battle-shocked is within", "that is Battle-shocked and visible is within");
    const items = ITEMS().flatMap((item): Item[] => item[0] === "that is Battle-shocked"
      ? [item, ["visible", "visible", { subject: "antecedent", to: "this-model" }]] : [item]);
    const result = compiled(items, text);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/A unit-filter needs a select-unit or attack right before it, or an aura-range/u);
  });
});
