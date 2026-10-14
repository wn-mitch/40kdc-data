import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

type Item = [string, string, Record<string, unknown>];
const BULLET = "■";

function compile(text: string, items: Item[]) {
  return compileLeaves(placed(text, items), text, {});
}
function mechanicsOf(text: string, items: Item[]): Record<string, any> {
  const result = compile(text, items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}
function errorsOf(text: string, items: Item[]): string {
  const result = compile(text, items);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics)}`);
  return result.errors.join(" ");
}

describe("Round 5C t7 choice and grant bundle", () => {
  // 6819: an option whose move ends somewhere ("provided every model … ends that move wholly within 6\" of …").
  const MOVE_TEXT = `In your Shooting phase, after this unit has shot, it can do one of the following:\n${BULLET} Make a Normal move of up to 6".\n${BULLET} Make a Normal move of up to 12", provided every model in this unit ends that move wholly within 6" of one or more friendly ALPHA units.\nUntil the end of the turn, this unit is not eligible to declare a charge.`;
  const MOVE_ITEMS: Item[] = [
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["after this unit has shot", "event", { kind: "after-shooting" }],
    ["it can do one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
    ["Make a Normal move of up to 6", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }],
    ["Make a Normal move of up to 12", "make-move", { subject: "this-unit", move_type: "normal", distance: 12 }],
    ["provided every model in this unit ends that move", "move-must-end", { match: "all", polarity: "must" }],
    ["wholly within 6\" of one or more friendly ALPHA units", "unit-position", { kind: "within", inches: 6, of: "matching-unit", subject: "this-unit", negated: false, of_keywords: ["ALPHA"], of_side: "friendly", wholly: true }],
    ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ["not eligible to declare a charge", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: false }],
  ];

  it("ends only the second option's move where its wording says, and keeps the trailing sentence outside the choice", () => {
    const mechanics = mechanicsOf(MOVE_TEXT, MOVE_ITEMS);
    const choice = mechanics.effect.effect.steps[0];
    expect(choice.type).toBe("choice");
    expect(choice.options[0].modifier.ends_when).toBeUndefined();
    expect(choice.options[1].modifier.ends_when).toBeDefined();
    expect(mechanics.effect.effect.steps[1]).toMatchObject({ type: "permission", modifier: { activity: "declare-charge", allow: false } });
    expect(mechanics.scope).toEqual({ duration: "turn" });
  });

  it("refuses a move-end that names move types after the option's make-move, as the top-level form does", () => {
    const items = MOVE_ITEMS.map((item): Item => item[0].startsWith("provided") ? [item[0], item[1], { ...item[2], move_types: ["normal"] }] : item);
    expect(errorsOf(MOVE_TEXT, items)).toMatch(/move types/u);
  });

  // 9103: a result band over a printed bullet list decides every bullet effect, not only the first.
  const BAND_TEXT = `Select one enemy unit. Roll one D6: On a 2+, that unit suffers 1 mortal wound.\n${BULLET} That unit suffers D3 mortal wounds.\n${BULLET} That unit suffers 2 mortal wounds.\n\nThat unit suffers 3 mortal wounds.`;
  const BAND_ITEMS: Item[] = [
    ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: true }],
    ["Roll one D6", "dice-roll", { dice: "D6" }],
    ["On a 2+", "roll-result", { from: 2 }],
    ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
    ["That unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
    ["That unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "2" }],
    ["That unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }],
  ];

  // 9103 prints its block as separate lines under "On a 2+:", with no bullet glyphs.
  it("gates the lines of a block printed under a band, with no bullet glyphs", () => {
    const text = "Select one enemy unit. Roll one D6: On a 2+: That unit suffers 1 mortal wound.\rThat unit cannot be hidden.\rThat unit suffers 2 mortal wounds.";
    const effect = mechanicsOf(text, [
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: true }],
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
      ["That unit cannot be hidden", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
      ["That unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "2" }],
    ]).effect;
    expect(effect.effect.type).toBe("dice-gated");
    expect(effect.effect.on_success.steps.map((step: any) => step.modifier.count)).toEqual([1, "D3", 2]);
  });

  it("gates every bullet of the band's run, and leaves the sentence after the list ungated", () => {
    const effect = mechanicsOf(BAND_TEXT, BAND_ITEMS).effect;
    const gated = effect.effect.steps[0];
    expect(gated.type).toBe("dice-gated");
    expect(gated.on_success.steps.map((step: any) => step.modifier.count)).toEqual([1, "D3", 2]);
    expect(effect.effect.steps[1]).toMatchObject({ type: "mortal-wounds", modifier: { count: 3 } });
  });

  it("starts a new band run at a second roll-result, so the first run's bullets stop there", () => {
    const text = `Select one enemy unit. Roll one D6: On a 2+, that unit suffers 1 mortal wound.\n${BULLET} That unit suffers D3 mortal wounds. Roll one D6: On a 4+, that unit suffers 2 mortal wounds.`;
    const items: Item[] = [
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: true }],
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
      ["That unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 4+", "roll-result", { from: 4 }],
      ["that unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "2" }],
    ];
    const result = compile(text, items);
    expect(JSON.stringify(result.ok ? result.mechanics : result.errors)).toBeTruthy();
  });

  // 10706: a leading condition before an "Or:" pick gates only the option it starts.
  const CHOICE_TEXT = "At the end of the Fight phase, you can use this ability. If this unit is unengaged, this unit can make a Normal move of up to 6\".Or: If this unit is engaged, this unit can make a Fall Back move of up to 3\".";
  const CHOICE_ITEMS: Item[] = [
    ["At the end of the Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "either" }],
    ["If this unit is unengaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }],
    ["this unit can make a Normal move of up to 6", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }],
    ["Or:", "instead", { choice: true }],
    ["If this unit is engaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false }],
    ["this unit can make a Fall Back move of up to 3", "make-move", { subject: "this-unit", move_type: "fall-back", distance: 3 }],
  ];

  it("gives each option of an instead-choice its own leading condition, not one over the choice", () => {
    const effect = mechanicsOf(CHOICE_TEXT, CHOICE_ITEMS).effect;
    expect(effect.type).toBe("choice");
    expect(effect.options[0]).toMatchObject({ type: "conditional", effect: { type: "move", modifier: { move_type: "normal" } } });
    expect(effect.options[1]).toMatchObject({ type: "conditional", effect: { type: "move", modifier: { move_type: "fall-back" } } });
  });

  // 7121 (Creeping Barrage pass): a unit-filter after a quantifier that names its side narrows each pass.
  it("folds a unit-filter after a for-each quantifier into the pass's units", () => {
    const text = "For each enemy unit, ALPHA unit within 6\" of this model suffers 1 mortal wound.";
    const effect = mechanicsOf(text, [
      ["For each enemy unit", "for-each-unit-select", { scope: "enemy", distance: "any" }],
      ["ALPHA unit", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }],
      ["suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
    ]).effect;
    expect(effect.type).toBe("for-each-unit");
    expect(effect.selector).toMatchObject({ filter: { owner: "enemy", all_of: ["ALPHA"] } });
  });

  // 10328: a reserves arrival binds the set-up its option holds, in the same sentence.
  const RESERVES_TEXT = `Select one of the following:\n${BULLET} Set this unit up in Strategic Reserves, and it arrives in your next Movement phase.\n${BULLET} This unit can make a Normal move of up to 6".`;
  const RESERVES_ITEMS: Item[] = [
    ["Select one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
    ["Set this unit up in Strategic Reserves", "set-up", { subject: "this-unit", to: "strategic-reserves" }],
    ["arrives in your next Movement phase", "reserves-arrival", { allow_first_round: false }],
    ["This unit can make a Normal move of up to 6", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }],
  ];

  it("binds a reserves arrival to the set-up inside its option", () => {
    const effect = mechanicsOf(RESERVES_TEXT, RESERVES_ITEMS).effect;
    expect(effect.options[0].modifier).toMatchObject({ to: "strategic-reserves", arrives: "next-movement-phase" });
  });

  it("refuses a reserves arrival with no set-up anywhere before it", () => {
    const text = "This unit arrives in your next Movement phase.";
    expect(errorsOf(text, [["arrives in your next Movement phase", "reserves-arrival", { allow_first_round: false }]])).toMatch(/no set-up before it/u);
  });

  // 716: two printed grant headers, each with its own holders and body.
  const GRANT_TEXT = `Friendly ANATHEMA PSYKANA units have the following ability:\n**Null Aegis:** This unit has a 5+ invulnerable save.\nAll other ADEPTUS CUSTODES units from your army gain the following ability:\n**Deadly Unity:** This unit has Feel No Pain 5+.`;
  const grantHeader = (wording: string): Item => [wording, "ability-record-grant", { subject: "antecedent", printed: "one" }];
  const grantLabel = (wording: string, name: string): Item => [wording, "granted-ability-name", { label: name }];

  it("gives each printed granted body its own holders", () => {
    const effect = mechanicsOf(GRANT_TEXT, [
      ["Friendly ANATHEMA PSYKANA units", "unit-filter", { side: "friendly", keywords: ["ANATHEMA PSYKANA"] }],
      grantHeader("have the following ability"), grantLabel("Null Aegis", "Null Aegis"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["All other ADEPTUS CUSTODES units from your army", "unit-filter", { side: "friendly", keywords: ["ADEPTUS CUSTODES"] }],
      grantHeader("gain the following ability"), grantLabel("Deadly Unity", "Deadly Unity"),
      ["This unit has Feel No Pain 5+", "feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }],
    ]).effect;
    expect(effect.steps.map((step: any) => step.target.all_of)).toEqual([["ANATHEMA PSYKANA"], ["ADEPTUS CUSTODES"]]);
  });

  // 5584: a recipient unit-filter between a weapon frame and its keyword names the frame's units. The frame must
  // name a recipient role (antecedent); a this-unit frame with such a filter stays refused (round5c-compile-grants).
  it("grants a keyword to the units a recipient unit-filter after its frame names", () => {
    const text = "Psychic weapons equipped by ALPHA models from your army have [DEVASTATING WOUNDS].";
    const effect = mechanicsOf(text, [
      ["Psychic weapons equipped by", "weapon-ability-grant", { subject: "antecedent", weapon_type: "all" }],
      ["ALPHA models from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["[DEVASTATING WOUNDS]", "weapon-ability-keyword", { keyword: "Devastating Wounds" }],
    ]).effect;
    expect(effect).toMatchObject({ type: "weapon-ability-grant", target: { owner: "friendly", all_of: ["ALPHA"], level: "model" }, modifier: { keywords: [{ keyword_id: "devastating-wounds" }] } });
  });

  // The ability-activate version that takes a recipient unit-filter as its subject (ability-activate@3, families/abilities.ts).
  it("accepts the filtered-units subject on the current ability-activate version, and every value the previous version took", () => {
    const version = currentFamilyVersion("ability-activate");
    expect(version).toBeGreaterThan(2);
    const shape = { ability: "sample-options-ability", chosen: true };
    expect(() => normalizeFingerprintParameters("ability-activate", { ...shape, subject: "filtered-units" }, version)).not.toThrow();
    expect(() => normalizeFingerprintParameters("ability-activate", { ...shape, subject: "this-unit" }, version)).not.toThrow();
    expect(() => normalizeFingerprintParameters("ability-activate", { ...shape, subject: "recipient" }, version)).not.toThrow();
    expect(() => normalizeFingerprintParameters("ability-activate", { ...shape, subject: "selected-unit" }, version)).not.toThrow();
    expect(() => normalizeFingerprintParameters("ability-activate", { ...shape, subject: "filtered-units" }, 2)).toThrow();
  });

  // Authored leaves the t7 records draft with (design section 2): each must normalize at the current family version.
  it("normalizes the leaves the t7 records draft with at their current versions", () => {
    const at = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
    expect(() => at("stance-selection-capacity", { scope: "army", stance_id: "doctrine", additional_selections: 1, allocation: "choose-one-option", option_ids: ["assault-doctrine", "tactical-doctrine"] })).not.toThrow();
    expect(() => at("feel-no-pain", { subject: "antecedent", threshold: 5, against: "psychic-and-mortal" })).not.toThrow();
    expect(() => at("count-by-battle-size", { incursion: 2, "strike-force": 3, onslaught: 4 })).not.toThrow();
    expect(() => at("select-unit", { scope: "friendly", distance: "any", visible: false })).not.toThrow();
    expect(() => at("apply-mark", { subject: "antecedent", tag: "shaken" })).not.toThrow();
  });
});

// 10152: an "Or:" line after a banded sentence is an alternative, so the band does not decide it. Without an
// authored choice leaf at the "Or:", the line stays outside the roll; it must never join the band's list.
describe("Round 5C t7 result band and an Or line", () => {
  it("stops the band's block run at an Or line", () => {
    const text = "Select one enemy unit. Roll one D6: On a 2+: That unit suffers 1 mortal wound.\rOr: That unit suffers 2 mortal wounds.";
    const effect = mechanicsOf(text, [
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: true }],
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
      ["That unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "2" }],
    ]).effect;
    expect(effect.effect.steps[0]).toMatchObject({ type: "dice-gated", on_success: { modifier: { count: 1 } } });
    expect(effect.effect.steps[1]).toMatchObject({ type: "mortal-wounds", modifier: { count: 2 } });
  });
});

// 10121: a menu whose third option holds two qualified keyword runs joined by "and" under an opening condition.
// The qualifiers are target unit-keyword leaves, as the authored record holds them (fabricated keywords here).
describe("Round 5C t7 keyword menu with a two-run option", () => {
  const text = "Select one of the following for this unit's attacks to have: [Lethal Hits: ALPHA]. Or: [Sustained Hits 1: non-ALPHA]. Or: If the bravo doctrine is active for this unit, [Lethal Hits: ALPHA] and [Sustained Hits 1: non-ALPHA].";
  const target = (negated: boolean): Record<string, unknown> => ({ keywords: ["ALPHA"], subject: "target", negated });
  // `second` is the qualifier of the second option's run; null leaves that run unqualified.
  const items = (second: Record<string, unknown> | null): Item[] => [
    ["Select one of the following", "choice-open", { min_choices: 1, max_choices: 1, choice_label: "attacks ability" }],
    ["for this unit's attacks to have", "weapon-ability-grant", { subject: "this-unit", weapon_type: "all" }],
    ["Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ["ALPHA]", "unit-keyword", target(false)],
    ["Sustained Hits 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
    ...(second === null ? [] : [["non-ALPHA]", "unit-keyword", second] as Item]),
    ["the bravo doctrine is active for this unit", "rule-active", { rule: "bravo-doctrine", negated: false }],
    ["Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ["ALPHA]", "unit-keyword", target(false)],
    ["Sustained Hits 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
    ["non-ALPHA]", "unit-keyword", target(true)],
  ];

  it("folds three options into one choice, the third option a sequence of two qualified grants under its condition", () => {
    const effect = mechanicsOf(text, items(target(true))).effect;
    expect(effect.type).toBe("choice");
    expect(effect.options).toHaveLength(3);
    expect(effect.options[2]).toMatchObject({ type: "conditional", effect: { type: "sequence" } });
    expect(effect.options[2].effect.steps).toHaveLength(2);
    expect(effect.options[2].effect.steps.map((step: any) => step.effect.modifier.keywords)).toEqual([[{ keyword_id: "lethal-hits" }], [{ keyword_id: "sustained-hits", parameters: { value: 1 } }]]);
  });

  it("refuses a menu where one run has its qualifier and another run in the menu has none", () => {
    expect(errorsOf(text, items(null))).toMatch(/some runs qualified and some not/u);
  });
});
