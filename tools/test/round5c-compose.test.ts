import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, shapeSignature, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording only. The compiler reads nothing but the punctuation and joining words
// between leaves, so each case keeps the structure of a real ability with invented words.

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict")!;

type Piece = [phrase: string, role: string, family: string, parameters: Record<string, unknown>];

/** Leaves at the byte offsets of their phrases in the text, as the workbench stores them. */
function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, role, family_id, parameters]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    return { role, family_id, family_version: currentFamilyVersion(family_id), parameters, start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, pieces: Piece[]) {
  const result = compileLeaves(leavesIn(text, pieces), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return { ...result, rendered: check.rendered_text! };
}

const failures = (text: string, pieces: Piece[]) => {
  const result = compileLeaves(leavesIn(text, pieces), text);
  return result.ok ? [] : result.errors;
};

const attack = (direction: string, unit: string, attack_type: string): Piece[3] => ({ direction, unit, attack_type });
const state = (states: string[], negated = false): Piece[3] => ({ states, subject: "target", negated });
const hero: Piece[3] = { keywords: ["CHARACTER"], subject: "target", negated: false };
const plus = (roll: string, value = 1): Piece[3] => ({ roll, operation: "add", value });

describe("Round 5C composition rules", () => {
  it("gates an attack by its type and a negated state of its target", () => {
    const text = "Whenever this model shoots at a foe that is not halved, add one to its hits.";
    const result = compiled(text, [
      ["Whenever this model shoots", "EVENT", "attack", attack("makes", "this-model", "ranged")],
      ["at a foe that is not halved", "CONDITION", "unit-state", state(["below-half-strength"], true)],
      ["add one to its hits", "EFFECT", "roll-modifier", plus("hit")],
    ]);
    expect(result.mechanics.effect).toEqual({
      type: "conditional",
      condition: { operator: "and", operands: [
        { type: "attack-is-type", parameters: { attack_type: "ranged" } },
        { type: "unit-below-half-strength", parameters: { subject: "target" }, negated: true },
      ] },
      effect: { type: "roll-modifier", target: "self", modifier: { roll: "hit", operation: "add", value: 1 } },
    });
    expect(result.signature).toBe("EVENT(attack:makes) · CONDITION(unit-state) · EFFECT(roll-modifier)");
  });

  it("gives each effect the condition in its own clause, in either word order", () => {
    const text = "Whenever a model in that unit swings, add one to hits if the foe is thinned, and add one to wounds as well if the foe is halved.";
    const result = compiled(text, [
      ["Whenever a model in that unit swings", "EVENT", "attack", attack("makes", "that-unit", "any")],
      ["add one to hits", "EFFECT", "roll-modifier", plus("hit")],
      ["if the foe is thinned", "CONDITION", "unit-state", state(["below-starting-strength"])],
      ["add one to wounds", "EFFECT", "roll-modifier", plus("wound")],
      ["if the foe is halved", "CONDITION", "unit-state", state(["below-half-strength"])],
    ]);
    expect(result.mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "conditional", condition: { type: "unit-below-starting-strength", parameters: { subject: "target" } }, effect: { type: "roll-modifier", target: "unit", modifier: { roll: "hit", operation: "add", value: 1 } } },
      { type: "conditional", condition: { type: "unit-below-half-strength", parameters: { subject: "target" } }, effect: { type: "roll-modifier", target: "unit", modifier: { roll: "wound", operation: "add", value: 1 } } },
    ] });
    expect(result.signature).toBe("EVENT(attack:makes) · EFFECT(roll-modifier) · CONDITION(unit-state) | EFFECT(roll-modifier) · CONDITION(unit-state)");

    // The same leaves with the condition first in the second clause bind the same way.
    const flipped = "Whenever a model in that unit swings, add one to hits if the foe is thinned, and if the foe is halved add one to wounds.";
    expect(compiled(flipped, [
      ["Whenever a model in that unit swings", "EVENT", "attack", attack("makes", "that-unit", "any")],
      ["add one to hits", "EFFECT", "roll-modifier", plus("hit")],
      ["if the foe is thinned", "CONDITION", "unit-state", state(["below-starting-strength"])],
      ["if the foe is halved", "CONDITION", "unit-state", state(["below-half-strength"])],
      ["add one to wounds", "EFFECT", "roll-modifier", plus("wound")],
    ]).mechanics.effect).toEqual(result.mechanics.effect);
  });

  it("lets a condition before the first effect gate every clause", () => {
    const text = "Whenever this model strikes a hero, add one to hits and add one to wounds.";
    const result = compiled(text, [
      ["Whenever this model strikes", "EVENT", "attack", attack("makes", "this-model", "melee")],
      ["a hero", "CONDITION", "unit-keyword", hero],
      ["add one to hits", "EFFECT", "roll-modifier", plus("hit")],
      ["add one to wounds", "EFFECT", "roll-modifier", plus("wound")],
    ]);
    expect(result.mechanics.effect).toMatchObject({
      type: "conditional",
      condition: { operator: "and", operands: [{ type: "attack-is-type" }, { type: "target-has-keyword", parameters: { keyword: "CHARACTER" } }] },
      effect: { type: "sequence" },
    });
  });

  it("puts attacks that differ only in who attacks and with what into one shape", () => {
    const shape = (unit: string, type: string) => shapeSignature(leavesIn("Whenever the attacker strikes a hero, re-roll the hit.", [
      ["Whenever the attacker strikes", "EVENT", "attack", attack("makes", unit, type)],
      ["a hero", "CONDITION", "unit-keyword", hero],
      ["re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
    ]), "Whenever the attacker strikes a hero, re-roll the hit.");
    expect(new Set([shape("this-model", "melee"), shape("this-model", "any"), shape("that-unit", "ranged")]).size).toBe(1);
  });

  it("moves the attacker's rolls onto the attacker when an attack targets this unit", () => {
    const text = "Whenever a blade is swung at this unit, take one from the hit and this unit has a 5+ ward.";
    const result = compiled(text, [
      ["Whenever a blade is swung at this unit", "EVENT", "attack", attack("targeted", "this-unit", "melee")],
      ["take one from the hit", "EFFECT", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }],
      ["this unit has a 5+ ward", "EFFECT", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
    ]);
    expect(result.mechanics.effect).toMatchObject({ type: "conditional", effect: { type: "sequence", steps: [
      { type: "roll-modifier", target: "attacker" }, { type: "invulnerable-save", target: "unit" },
    ] } });
    expect(result.signature).toBe("EVENT(attack:targeted) · EFFECT(roll-modifier) | EFFECT(invulnerable-save)");
  });

  it("gives a change to the attack being made to whoever makes it", () => {
    const worsen = (direction: string): Record<string, unknown> => compiled("Whenever a blow lands, worsen its piercing by one.", [
      ["Whenever a blow lands", "EVENT", "attack", attack(direction, "this-unit", "melee")],
      ["worsen its piercing by one", "EFFECT", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "worsen", value: 1, weapon_type: "all" }],
    ]).mechanics.effect as Record<string, unknown>;
    expect(worsen("targeted")).toMatchObject({ effect: { type: "stat-modifier", target: "attacker", modifier: { stat: "AP", operation: "worsen" } } });
    expect(worsen("makes")).toMatchObject({ effect: { type: "stat-modifier", target: "unit" } });
  });

  it("replaces a re-roll when the unit charged, keeping the melee limit on both", () => {
    const text = "Whenever a model here swings, re-roll a one. If it charged this turn, re-roll the swing instead.";
    const result = compiled(text, [
      ["Whenever a model here swings", "EVENT", "attack", attack("makes", "this-unit", "melee")],
      ["re-roll a one", "EFFECT", "reroll", { roll: "hit", subset: "ones" }],
      ["If it charged this turn", "CONDITION", "unit-activity", { activity: "charged-this-turn", subject: "this-unit", negated: false }],
      ["re-roll the swing", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
      ["instead", "COMBINATOR", "instead", {}],
    ]);
    expect(result.mechanics.effect).toEqual({
      type: "conditional", condition: { type: "attack-is-type", parameters: { attack_type: "melee" } },
      effect: { type: "sequence", steps: [
        { type: "conditional", condition: { type: "charged-this-turn", negated: true }, effect: { type: "re-roll", target: "unit", modifier: { roll: "hit", subset: "ones" } } },
        { type: "conditional", condition: { type: "charged-this-turn" }, effect: { type: "re-roll", target: "unit", modifier: { roll: "hit", result_scope: "any-result" } } },
      ] },
    });
  });

  it("turns result bands into a dice table, with faces no band names doing nothing", () => {
    const text = "Whenever it lands a charge, pick one enemy unit and roll one D6: on a 2-5, that unit takes D3 wounds; on a 6, that unit takes D3+3 wounds.";
    const result = compiled(text, [
      ["Whenever it lands a charge", "EVENT", "event", { kind: "charge" }],
      ["pick one enemy unit", "EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["roll one D6", "EVENT", "dice-roll", { dice: "D6" }],
      ["on a 2-5", "CONDITION", "roll-result", { from: 2, to: 5 }],
      ["that unit takes D3 wounds", "EFFECT", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
      ["on a 6", "CONDITION", "roll-result", { from: 6, to: 6 }],
      ["that unit takes D3+3 wounds", "EFFECT", "mortal-wounds", { recipient: "that-unit", count: "D3+3" }],
    ]);
    expect(result.mechanics.effect).toEqual({ type: "dice-table", dice: "D6", outcomes: [
      { results: [1], effect: { type: "no-effect" } },
      { results: [2, 3, 4, 5], effect: { type: "mortal-wounds", target: "target", modifier: { count: "D3" } } },
      { results: [6], effect: { type: "mortal-wounds", target: "target", modifier: { count: "D3+3" } } },
    ] });
    expect(result.mechanics.trigger).toEqual({ event: "charge-move", subject: "self" });
  });

  it("gates one band that reaches the top face with dice-gated", () => {
    const result = compiled("Roll one D6: on a 4+, this unit takes 1 wound.", [
      ["Roll one D6", "EVENT", "dice-roll", { dice: "D6" }],
      ["on a 4+", "CONDITION", "roll-result", { from: 4, to: 6 }],
      ["this unit takes 1 wound", "EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }],
    ]);
    expect(result.mechanics.effect).toEqual({ type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte", on_success: { type: "mortal-wounds", target: "unit", modifier: { count: 1 } }, on_fail: null });
  });

  it("folds a per-model roll and a has-not-fought condition into fighting on death", () => {
    const text = "Whenever a model here falls, if that model has not fought this phase, roll one D6. On a 2+, leave it; it fights after the attackers finish.";
    const result = compiled(text, [
      ["Whenever a model here falls", "EVENT", "event", { kind: "model-destroyed" }],
      ["if that model has not fought this phase", "CONDITION", "unit-activity", { activity: "fought-this-phase", subject: "this-unit", negated: true }],
      ["roll one D6", "EVENT", "dice-roll", { dice: "D6" }],
      ["On a 2+", "CONDITION", "roll-result", { from: 2, to: 6 }],
      ["leave it; it fights after the attackers finish", "EFFECT", "fight-on-death", { timing: "after-the-attacking-unit-finishes" }],
    ]);
    expect(result.mechanics.effect).toEqual({ type: "fight-on-death", target: "destroyed-model", modifier: {
      resolution: "after-attacking-unit-finishes", removal: "after-destroyed-model-fights",
      gate: { dice: "D6", threshold: 2, comparison: "gte" }, eligibility: { type: "has-fought-this-phase", negated: true },
    } });
  });

  it("joins what happens in place of a forbidden Advance roll", () => {
    const result = compiled("Skip the dash roll for it; instead, until the end of the phase, add six to its Move.", [
      ["Skip the dash roll for it", "EFFECT", "no-advance-roll", { subject: "this-unit" }],
      ["instead", "COMBINATOR", "instead", {}],
      ["until the end of the phase", "DURATION", "duration", { endpoint: "end-of-phase" }],
      ["add six to its Move", "EFFECT", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 6, weapon_type: "all" }],
    ]);
    expect(result.mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "ability-grant", target: "unit", modifier: { grant_type: "no-advance-roll" } },
      { type: "stat-modifier", target: "unit", modifier: { stat: "M", operation: "add", value: 6 } },
    ] });
    expect(result.mechanics.scope).toEqual({ range: "unit", duration: "phase" });
  });

  it("refuses bands it cannot place", () => {
    expect(failures("On a 4+, this unit takes 1 wound.", [
      ["On a 4+", "CONDITION", "roll-result", { from: 4, to: 6 }],
      ["this unit takes 1 wound", "EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }],
    ])).toEqual(["Result bands need exactly one roll; found 0."]);
    expect(failures("Roll one D6: on a 2-4, it takes 1 wound; on a 4+, it takes 2 wounds.", [
      ["Roll one D6", "EVENT", "dice-roll", { dice: "D6" }],
      ["on a 2-4", "CONDITION", "roll-result", { from: 2, to: 4 }],
      ["it takes 1 wound", "EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }],
      ["on a 4+", "CONDITION", "roll-result", { from: 4, to: 6 }],
      ["it takes 2 wounds", "EFFECT", "mortal-wounds", { recipient: "this-unit", count: "2" }],
    ])).toEqual(["Two result bands overlap."]);
  });

  it("replaces an earlier effect with \"instead\", for re-rolls and for numbers", () => {
    const rerolls = compiled("Re-roll a hit of one. If the foe is thinned, re-roll the hit instead.", [
      ["Re-roll a hit of one", "EFFECT", "reroll", { roll: "hit", subset: "ones" }],
      ["If the foe is thinned", "CONDITION", "unit-state", state(["below-starting-strength"])],
      ["re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
      ["instead", "COMBINATOR", "instead", {}],
    ]);
    const weak = { type: "unit-below-starting-strength", parameters: { subject: "target" } };
    expect(rerolls.mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "conditional", condition: { ...weak, negated: true }, effect: { type: "re-roll", target: "unit", modifier: { roll: "hit", subset: "ones" } } },
      { type: "conditional", condition: weak, effect: { type: "re-roll", target: "unit", modifier: { roll: "hit", result_scope: "any-result" } } },
    ] });

    // "+1 (or +2 instead if …)": adding both would count the bonus twice.
    const numbers = compiled("Add one to hits (or add two to hits instead if the foe is halved).", [
      ["Add one to hits", "EFFECT", "roll-modifier", plus("hit")],
      ["add two to hits", "EFFECT", "roll-modifier", plus("hit", 2)],
      ["instead", "COMBINATOR", "instead", {}],
      ["if the foe is halved", "CONDITION", "unit-state", state(["below-half-strength"])],
    ]);
    const halved = { type: "unit-below-half-strength", parameters: { subject: "target" } };
    expect(numbers.mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { condition: { ...halved, negated: true }, effect: { modifier: { value: 1 } } },
      { condition: halved, effect: { modifier: { value: 2 } } },
    ] });
    // A compound condition is negated as a whole, not operand by operand.
    const compound = compiled("Add one to hits. If the foe is thinned or shaken, add two to hits instead.", [
      ["Add one to hits", "EFFECT", "roll-modifier", plus("hit")],
      ["If the foe is thinned or shaken", "CONDITION", "unit-state", state(["below-starting-strength", "battle-shocked"])],
      ["add two to hits", "EFFECT", "roll-modifier", plus("hit", 2)],
      ["instead", "COMBINATOR", "instead", {}],
    ]);
    expect((compound.mechanics.effect as { steps: Array<{ condition: unknown }> }).steps[0]!.condition).toMatchObject({ operator: "not", operands: [{ operator: "or" }] });
  });

  it("refuses an \"instead\" it cannot place", () => {
    expect(failures("If the foe is thinned, re-roll the hit instead.", [
      ["If the foe is thinned", "CONDITION", "unit-state", state(["below-starting-strength"])],
      ["re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
      ["instead", "COMBINATOR", "instead", {}],
    ])).toEqual(["\"Instead\" has no earlier reroll effect to replace."]);
    expect(failures("Re-roll a hit of one. Re-roll the hit instead.", [
      ["Re-roll a hit of one", "EFFECT", "reroll", { roll: "hit", subset: "ones" }],
      ["Re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
      ["instead", "COMBINATOR", "instead", {}],
    ])[0]).toMatch(/needs a condition/u);
  });

  it("binds attacks against a selected unit into one designation", () => {
    const text = "Pick one enemy unit within 12\". Whenever a model in this unit attacks that unit, re-roll the hit.";
    const result = compiled(text, [
      ["Pick one enemy unit within 12\"", "EVENT", "select-unit", { scope: "enemy", distance: "within", inches: 12, visible: false }],
      ["Whenever a model in this unit attacks", "EVENT", "attack", attack("makes", "this-unit", "any")],
      ["that unit", "CONDITION", "target-is-selected", {}],
      ["re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
    ]);
    expect(result.mechanics.effect).toEqual({
      type: "designate-target", designation: "selected-unit",
      select: { scope: "enemy-unit", count: 1, within_inches: 12 },
      applies: { to: "attackers-of-target", effect: { type: "re-roll", target: "unit", modifier: { roll: "hit", result_scope: "any-result" } } },
    });
    expect(failures("Whenever this model attacks that unit, re-roll the hit.", [
      ["Whenever this model attacks", "EVENT", "attack", attack("makes", "this-model", "any")],
      ["that unit", "CONDITION", "target-is-selected", {}],
      ["re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
    ])).toEqual(["An attack targets \"that unit\", but no select-unit leaf says which unit."]);
  });

  it("treats a sentence without an effect as leading into the next one", () => {
    const pieces = (text: string) => leavesIn(text, [
      ["While leading", "CONDITION", "leading-unit", { subject: "this-model", attachment: "leading" }],
      ["re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
    ]);
    const comma = "While leading, re-roll the hit.";
    const stop = "While leading. re-roll the hit.";
    expect(shapeSignature(pieces(stop), stop)).toBe(shapeSignature(pieces(comma), comma));
  });

  it("compiles every predicate family to a node the describer renders", () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["unit-keyword", { keywords: ["MONSTER", "VEHICLE"], subject: "target", negated: false }, { operator: "or", operands: [
        { type: "target-has-keyword", parameters: { keyword: "MONSTER" } }, { type: "target-has-keyword", parameters: { keyword: "VEHICLE" } }] }],
      ["unit-keyword", { keywords: ["MONSTER", "VEHICLE"], subject: "target", negated: true }, { operator: "and", operands: [
        { type: "target-has-keyword", parameters: { keyword: "MONSTER" }, negated: true }, { type: "target-has-keyword", parameters: { keyword: "VEHICLE" }, negated: true }] }],
      ["unit-keyword", { keywords: ["FLY"], subject: "this-unit", negated: false }, { type: "unit-has-keyword", parameters: { keyword: "FLY" } }],
      ["unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false }, { type: "is-battle-shocked" }],
      ["unit-mark", { mark: "oath-of-moment", subject: "target", negated: false }, { type: "target-has-keyword", parameters: { keyword: "Oath of Moment target" } }],
      ["unit-position", { kind: "closest-eligible", subject: "target", negated: false }, { type: "unit-within-range-of", parameters: { target_type: "closest-eligible" } }],
      ["unit-position", { kind: "beyond", inches: 12, subject: "target", negated: false }, { type: "unit-within-range-of", parameters: { target_type: "current-ranged-attack-target", range: 12 }, negated: true }],
      ["unit-position", { kind: "objective-range", controlled_by: "you", subject: "target", negated: false }, { type: "within-range-of-objective", parameters: { subject: "target", controlled_by: "your-army" } }],
    ];
    for (const [family, parameters, node] of cases) {
      const result = compiled("If so, re-roll the hit.", [
        ["If so", "CONDITION", family, parameters],
        ["re-roll the hit", "EFFECT", "reroll", { roll: "hit", subset: "all" }],
      ]);
      expect((result.mechanics.effect as { condition: unknown }).condition).toEqual(node);
      expect(result.rendered.length).toBeGreaterThan(0);
    }
  });
});
