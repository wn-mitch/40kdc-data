import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { placements } from "../src/round5c/compile-placement.js";
import { OTHERWISE_REFUSAL } from "../src/round5c/compile-otherwise.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each shape keeps the structure of a real record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, ...pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

function compile(text: string, ...pieces: Piece[]) {
  return compileLeaves(placed(text, ...pieces), text);
}

function mechanicsOf(text: string, ...pieces: Piece[]): Record<string, any> {
  const result = compile(text, ...pieces);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const plus = (value: number): Record<string, unknown> => ({ roll: "hit", operation: "add", value });
const halved: Record<string, unknown> = { states: ["below-half-strength"], subject: "target", negated: false };
const rolled = (from: number): Record<string, unknown> => ({ from });
const wounds = (count: string): Record<string, unknown> => ({ recipient: "this-unit", count });
const robot: Record<string, unknown> = { keywords: ["ROBOT"], subject: "this-unit", negated: false };
const fortified: Record<string, unknown> = { keywords: ["FORTIFICATION", "VEHICLE"], subject: "this-unit", negated: false };

describe("an instead written as \"or\" opens its own clause (compile-placement.ts)", () => {
  const text = "Add one to hits, or add two to hits if the foe is halved.";
  const pieces: Piece[] = [
    ["Add one to hits", "roll-modifier", plus(1), "EFFECT"],
    ["or", "instead", {}, "EFFECT"],
    ["add two to hits", "roll-modifier", plus(2), "EFFECT"],
    ["if the foe is halved", "unit-state", halved, "EFFECT"],
  ];

  it("compiles the base effect and its replacement as separate gated effects", () => {
    expect(mechanicsOf(text, ...pieces).effect).toMatchObject({ type: "sequence", steps: [
      { condition: { operator: "not", operands: [{ type: "strength", parameters: { below: "half" } }] }, effect: { modifier: { value: 1 } } },
      { condition: { type: "strength", parameters: { below: "half" } }, effect: { modifier: { value: 2 } } },
    ] });
  });

  it("also starts the clause when the \"or\" has only a space before it", () => {
    const spaced = "Add one to hits or add two to hits if the foe is halved.";
    expect(mechanicsOf(spaced, ...pieces).effect).toMatchObject({ type: "sequence", steps: [
      { effect: { modifier: { value: 1 } } },
      { effect: { modifier: { value: 2 } } },
    ] });
  });

  it("keeps a parenthesised \"(or\" as a clause opener", () => {
    const parens = "Add one to hits (or add two to hits if the foe is halved).";
    expect(placements(placed(parens, ...pieces), parens).map((place) => place.clause)).toEqual([0, 1, 1, 1]);
  });

  it("does not split a trailing instead off its effect's clause", () => {
    const trailing = "If the foe is halved, add two to hits instead.";
    const list = placed(trailing,
      ["If the foe is halved", "unit-state", halved, "EFFECT"],
      ["add two to hits", "roll-modifier", plus(2), "EFFECT"],
      ["instead", "instead", {}, "EFFECT"]);
    expect(placements(list, trailing).map((place) => place.clause)).toEqual([0, 0, 0]);
  });

  it("keeps a choice \"or\" as a clause opener", () => {
    const choice = "Re-roll a hit of one or re-roll a wound of one.";
    const list = placed(choice,
      ["Re-roll a hit of one", "reroll", { roll: "hit", subset: "ones" }, "EFFECT"],
      ["or", "instead", { choice: true }, "EFFECT"],
      ["re-roll a wound of one", "reroll", { roll: "wound", subset: "ones" }, "EFFECT"]);
    expect(placements(list, choice).map((place) => place.clause)).toEqual([0, 1, 1]);
  });
});

describe("an instead replacement joins the roll band of the effect it replaces (compile-dice.ts)", () => {
  it("puts both branches under the dice gate, with the condition only on the replacement", () => {
    const text = "Roll one D6: on a 2+, the foe suffers D3 wounds, or 2D3 wounds instead if it is a ROBOT unit.";
    const mechanics = mechanicsOf(text,
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 2+", "roll-result", rolled(2)],
      ["the foe suffers D3 wounds", "mortal-wounds", wounds("D3")],
      ["2D3 wounds", "mortal-wounds", wounds("2D3")],
      ["instead", "instead", {}],
      ["ROBOT unit", "unit-keyword", robot]);
    expect(mechanics.effect).toMatchObject({ type: "dice-gated", dice: "D6", threshold: 2, comparison: "gte", on_fail: null, on_success: { type: "sequence", steps: [
      { type: "conditional", condition: { operator: "not", operands: [{ type: "has-keyword", parameters: { all_of: ["ROBOT"] } }] }, effect: { type: "mortal-wounds", modifier: { count: "D3" } } },
      { type: "conditional", condition: { type: "has-keyword", parameters: { all_of: ["ROBOT"] } }, effect: { type: "mortal-wounds", modifier: { count: "2D3" } } },
    ] } });
  });

  it("keeps a two-keyword alternative as one any_of condition under the threshold-3 gate", () => {
    const text = "Roll one D6: on a 3+, the foe suffers D3 wounds, or 2D3 wounds instead if it is a FORTIFICATION or VEHICLE unit.";
    const mechanics = mechanicsOf(text,
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 3+", "roll-result", rolled(3)],
      ["the foe suffers D3 wounds", "mortal-wounds", wounds("D3")],
      ["2D3 wounds", "mortal-wounds", wounds("2D3")],
      ["instead", "instead", {}],
      ["FORTIFICATION or VEHICLE unit", "unit-keyword", fortified]);
    expect(mechanics.effect).toMatchObject({ type: "dice-gated", threshold: 3, on_success: { type: "sequence", steps: [
      { condition: { operator: "not", operands: [{ type: "has-keyword", parameters: { any_of: ["FORTIFICATION", "VEHICLE"] } }] } },
      { condition: { type: "has-keyword", parameters: { any_of: ["FORTIFICATION", "VEHICLE"] } } },
    ] } });
  });

  it("leaves a band with no instead as one dice-gated effect", () => {
    const text = "Roll one D6: on a 2+, the foe suffers D3 wounds.";
    const mechanics = mechanicsOf(text,
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 2+", "roll-result", rolled(2)],
      ["the foe suffers D3 wounds", "mortal-wounds", wounds("D3")]);
    expect(mechanics.effect).toMatchObject({ type: "dice-gated", threshold: 2, on_success: { type: "mortal-wounds", modifier: { count: "D3" } } });
  });
});

describe("an Otherwise sentence after a gating condition is refused (compile-otherwise.ts)", () => {
  it("refuses a leading condition that would gate the Otherwise sentence", () => {
    const text = "If your unit is not engaged, it can move six inches. Otherwise, your unit can fall back.";
    const result = compile(text,
      ["your unit is not engaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }, "EFFECT"],
      ["it can move six inches", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }, "EFFECT"],
      ["your unit can fall back", "make-move", { subject: "this-unit", move_type: "fall-back" }, "EFFECT"]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(OTHERWISE_REFUSAL);
  });

  it("refuses a condition in the sentence before the Otherwise sentence", () => {
    const text = "Add one to hits. If the foe is halved, add two to hits. Otherwise, add three to hits.";
    const result = compile(text,
      ["Add one to hits", "roll-modifier", plus(1), "EFFECT"],
      ["If the foe is halved", "unit-state", halved, "EFFECT"],
      ["add two to hits", "roll-modifier", plus(2), "EFFECT"],
      ["add three to hits", "roll-modifier", plus(3), "EFFECT"]);
    expect(result.ok ? [] : result.errors).toContain(OTHERWISE_REFUSAL);
  });

  it("does not refuse an Otherwise sentence after a result band", () => {
    const text = "Roll one D6: on a 4+, the foe suffers D3 wounds. Otherwise, the foe suffers one wound.";
    const result = compile(text,
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 4+", "roll-result", rolled(4)],
      ["the foe suffers D3 wounds", "mortal-wounds", wounds("D3")],
      ["Otherwise", "roll-result", { from: 1, to: 3 }],
      ["the foe suffers one wound", "mortal-wounds", wounds("1")]);
    expect(result.ok ? [] : result.errors).not.toContain(OTHERWISE_REFUSAL);
  });

  it("does not refuse an Otherwise sentence with no condition before it", () => {
    const text = "Move six inches. Otherwise, fall back.";
    const result = compile(text,
      ["Move six inches", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }, "EFFECT"],
      ["fall back", "make-move", { subject: "this-unit", move_type: "fall-back" }, "EFFECT"]);
    expect(result.ok).toBe(true);
  });
});

describe("an amount alternative under a gate that precedes an Otherwise sentence is refused", () => {
  it("refuses the 2498 mirror: an or-alternative move with a leading not-engaged gate and an Otherwise fall-back", () => {
    const text = "If your unit is not engaged, it can move six inches, or up to 12 inches if your unit is a MOUNTED unit. Otherwise, your unit can fall back.";
    const result = compile(text,
      ["your unit is not engaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }, "EFFECT"],
      ["it can move six inches", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }, "EFFECT"],
      ["or", "instead", {}, "EFFECT"],
      ["up to 12 inches", "make-move", { subject: "this-unit", move_type: "normal", distance: 12 }, "EFFECT"],
      ["MOUNTED unit", "unit-keyword", { keywords: ["MOUNTED"], subject: "this-unit", negated: false }, "EFFECT"],
      ["your unit can fall back", "make-move", { subject: "this-unit", move_type: "fall-back" }, "EFFECT"]);
    expect(result.ok ? [] : result.errors).toContain(OTHERWISE_REFUSAL);
  });
});

describe("authored shapes for the design's sub-shapes compile to their mechanics", () => {
  it("replaces an amount under a leading-unit condition inside a parenthesis", () => {
    const text = "Heal D3 wounds (or D3+1 wounds if a ZARKS HERO is leading the unit).";
    const mechanics = mechanicsOf(text,
      ["Heal D3 wounds", "regain-wounds", { subject: "this-unit", amount: "D3", per: "unit" }, "EFFECT"],
      ["or", "instead", {}, "EFFECT"],
      ["D3+1 wounds", "regain-wounds", { subject: "this-unit", amount: "D3+1", per: "unit" }, "EFFECT"],
      ["a ZARKS HERO is leading the unit", "leading-unit", { subject: "this-unit", attachment: "led", leader_keywords: ["ZARKS", "HERO"] }, "EFFECT"]);
    const led = { type: "attachment", parameters: { role: "led", with: { all_of: ["ZARKS", "HERO"] } } };
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { condition: { operator: "not", operands: [led] }, effect: { modifier: { amount: "D3" } } },
      { condition: led, effect: { modifier: { amount: "D3+1" } } },
    ] });
  });

  it("replaces a range under a keyword condition after a comma-or", () => {
    const text = "Place the unit more than 6 inches from foes, or more than 8 inches from foes if it is a MONSTER unit.";
    const mechanics = mechanicsOf(text,
      ["Place the unit more than 6 inches from foes", "set-up", { subject: "this-unit", to: "battlefield", min_enemy_distance: 6 }, "EFFECT"],
      ["or", "instead", {}, "EFFECT"],
      ["more than 8 inches from foes", "set-up", { subject: "this-unit", to: "battlefield", min_enemy_distance: 8 }, "EFFECT"],
      ["MONSTER unit", "unit-keyword", { keywords: ["MONSTER"], subject: "this-unit", negated: false }, "EFFECT"]);
    const monster = { type: "has-keyword", parameters: { all_of: ["MONSTER"] } };
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { condition: { operator: "not", operands: [monster] }, effect: { modifier: { min_enemy_distance: 6 } } },
      { condition: monster, effect: { modifier: { min_enemy_distance: 8 } } },
    ] });
  });

  it("replaces a returned-model count under a battleline condition", () => {
    const text = "Recall up to one lost model to your unit (not HERO models) or up to D3 lost models (not HERO models) if your unit is a BATTLELINE unit.";
    const mechanics = mechanicsOf(text,
      ["Recall up to one lost model to your unit", "return-models", { subject: "this-unit", count: "1" }, "EFFECT"],
      ["not HERO models", "returned-model-exclusion", { keywords: ["HERO"] }, "EFFECT"],
      ["or", "instead", {}, "EFFECT"],
      ["up to D3 lost models", "return-models", { subject: "this-unit", count: "D3" }, "EFFECT"],
      ["(not HERO models)", "returned-model-exclusion", { keywords: ["HERO"] }, "EFFECT"],
      ["BATTLELINE unit", "unit-keyword", { keywords: ["BATTLELINE"], subject: "this-unit", negated: false }, "EFFECT"]);
    const battleline = { type: "has-keyword", parameters: { all_of: ["BATTLELINE"] } };
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { condition: { operator: "not", operands: [battleline] }, effect: { modifier: { count: 1, exclude_model_keyword: ["HERO"] } } },
      { condition: battleline, effect: { modifier: { count: "D3", exclude_model_keyword: ["HERO"] } } },
    ] });
  });
});
