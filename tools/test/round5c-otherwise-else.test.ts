import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import {
  OTHERWISE_AMBIGUOUS, OTHERWISE_NO_EFFECT, OTHERWISE_NO_PRECEDING, OTHERWISE_REFUSAL, OTHERWISE_ROLL, OTHERWISE_TEXT, OTHERWISE_UNNEGATABLE,
} from "../src/round5c/compile-otherwise.js";
import { rawSentences } from "../src/round5c/compile-placement.js";
import { describeCondition } from "../src/translate/condition.js";

// Fabricated wording only. Every piece is an EFFECT-fragment leaf unless it says otherwise, so the
// sentence breaks come from the punctuation in the text (compile-placement.ts), as in the real shapes.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];
type Node = Record<string, any>;

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, ...pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment = "EFFECT"]) => {
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

function effectOf(text: string, ...pieces: Piece[]): Node {
  const result = compile(text, ...pieces);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Node).effect as Node;
}

const errorsOf = (text: string, ...pieces: Piece[]): string[] => {
  const result = compile(text, ...pieces);
  return result.ok ? [] : result.errors;
};

const engaged = { states: ["engaged"], subject: "this-unit", negated: true };
const engagedNode = { type: "matches", parameters: { filter: { state: "engaged" } } };
const notEngaged = { operator: "not", operands: [engagedNode] };
const move = (distance: number) => ({ subject: "this-unit", move_type: "normal", distance });
const fallBack = { subject: "this-unit", move_type: "fall-back" };

/** Truth of a gate tree when `eligible` and `engaged` hold or not. Only those two leaves may appear. */
function truth(node: Node, eligible: boolean, engagedNow: boolean): boolean {
  if (node.operator === "and") return node.operands.every((operand: Node) => truth(operand, eligible, engagedNow));
  if (node.operator === "or") return node.operands.some((operand: Node) => truth(operand, eligible, engagedNow));
  if (node.operator === "not") return !truth(node.operands[0], eligible, engagedNow);
  if (node.type === "eligible") return eligible;
  if (node.type === "matches" && node.parameters.filter.state === "engaged") return engagedNow;
  throw new Error(`unexpected gate node ${JSON.stringify(node)}`);
}

describe("an Otherwise sentence takes the negation of the leading condition before it (compile-otherwise.ts)", () => {
  const text = "If your unit is not engaged, it can move six inches. Otherwise, your unit can fall back.";
  const pieces: Piece[] = [
    ["your unit is not engaged", "unit-state", engaged],
    ["it can move six inches", "make-move", move(6)],
    ["Otherwise", "otherwise", {}],
    ["your unit can fall back", "make-move", fallBack],
  ];

  it("gates the normal move on not engaged and the fall-back on engaged, with no double negation", () => {
    expect(effectOf(text, ...pieces)).toMatchObject({ type: "sequence", steps: [
      { type: "conditional", condition: notEngaged, effect: { type: "move", modifier: { move_type: "normal", distance: 6 } } },
      { type: "conditional", condition: engagedNode, effect: { type: "move", modifier: { move_type: "fall-back" } } },
    ] });
  });

  it("does not gate an effect after the Otherwise sentence on the earlier condition (sentence-scoped gate)", () => {
    const withEmbark = `${text} It cannot embark within a TRANSPORT at the end of this move.`;
    const steps = effectOf(withEmbark, ...pieces, ["It cannot embark within a TRANSPORT", "eligibility-permission", { subject: "this-unit", activity: "embark", allow: false }]).steps;
    expect(steps[2]).toMatchObject({ type: "permission" });
    expect(steps[2].type).not.toBe("conditional");
  });

  it("the fall-back's gate is the positive condition: the else gate evaluates engaged, not not-engaged", () => {
    const fallBackGate = effectOf(text, ...pieces).steps[1].condition;
    expect(fallBackGate).toEqual(engagedNode);
    expect(describeCondition(fallBackGate)).toBe(describeCondition(engagedNode));
    expect(describeCondition(fallBackGate)).not.toMatch(/\bnot\b/u);
  });

  it("refuses an Otherwise sentence whose preceding sentence has no effect", () => {
    const errors = errorsOf("Your unit is not engaged. Otherwise, your unit can fall back.",
      ["Your unit is not engaged", "unit-state", engaged],
      ["Otherwise", "otherwise", {}],
      ["your unit can fall back", "make-move", fallBack]);
    expect(errors).toContain(OTHERWISE_NO_PRECEDING);
  });

  it("refuses an Otherwise sentence with no effect of its own", () => {
    const errors = errorsOf("If your unit is not engaged, it can move six inches. Otherwise.",
      ["your unit is not engaged", "unit-state", engaged],
      ["it can move six inches", "make-move", move(6)],
      ["Otherwise", "otherwise", {}]);
    expect(errors).toContain(OTHERWISE_NO_EFFECT);
  });

  it("refuses a leaf whose span does not open with the word Otherwise", () => {
    const errors = errorsOf("If your unit is not engaged, it can move six inches. Retreat, your unit can fall back.",
      ["your unit is not engaged", "unit-state", engaged],
      ["it can move six inches", "make-move", move(6)],
      ["Retreat", "otherwise", {}],
      ["your unit can fall back", "make-move", fallBack]);
    expect(errors).toContain(OTHERWISE_TEXT);
  });

  it("refuses an Otherwise after a result band, which the dice shapes own", () => {
    const errors = errorsOf("Roll one D6: on a 4+, the foe suffers D3 wounds. Otherwise, the foe suffers one wound.",
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 4+", "roll-result", { from: 4 }],
      ["the foe suffers D3 wounds", "mortal-wounds", { recipient: "target", count: "D3" }],
      ["Otherwise", "otherwise", {}],
      ["the foe suffers one wound", "mortal-wounds", { recipient: "target", count: "1" }]);
    expect(errors).toContain(OTHERWISE_ROLL);
  });

  it("refuses a condition on the selected unit in the selection's sentence, which is an eligibility", () => {
    const errors = errorsOf("Select one enemy unit that is not engaged, and your unit can fall back. Otherwise, your unit can move six inches.",
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["that is not engaged", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: true }],
      ["your unit can fall back", "make-move", fallBack],
      ["Otherwise", "otherwise", {}],
      ["your unit can move six inches", "make-move", move(6)]);
    expect(errors).toContain(OTHERWISE_UNNEGATABLE);
  });

  it("refuses two leading conditions with nothing restated in the Otherwise sentence", () => {
    const errors = errorsOf("If your unit is not engaged and it is battle-shocked, it can move six inches. Otherwise, your unit can fall back.",
      ["your unit is not engaged", "unit-state", engaged],
      ["it is battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false }],
      ["it can move six inches", "make-move", move(6)],
      ["Otherwise", "otherwise", {}],
      ["your unit can fall back", "make-move", fallBack]);
    expect(errors).toContain(OTHERWISE_AMBIGUOUS);
  });

  it("keeps the older refusal for an Otherwise sentence with no otherwise leaf", () => {
    const errors = errorsOf(text,
      ["your unit is not engaged", "unit-state", engaged],
      ["it can move six inches", "make-move", move(6)],
      ["your unit can fall back", "make-move", fallBack]);
    expect(errors).toContain(OTHERWISE_REFUSAL);
  });

  it("gates a later effect sentence's Otherwise on its own condition when that sentence is not the first effect", () => {
    const halved = { states: ["below-half-strength"], subject: "target", negated: false };
    const steps = effectOf("Add one to hits. If the foe is halved, add two to hits. Otherwise, add three to hits.",
      ["Add one to hits", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["If the foe is halved", "unit-state", halved],
      ["add two to hits", "roll-modifier", { roll: "hit", operation: "add", value: 2 }],
      ["Otherwise", "otherwise", {}],
      ["add three to hits", "roll-modifier", { roll: "hit", operation: "add", value: 3 }]).steps;
    expect(steps[1].condition).toEqual({ type: "strength", parameters: { subject: "defender", below: "half" } });
    expect(steps[2].condition).toEqual({ operator: "not", operands: [steps[1].condition] });
  });
});

describe("an Otherwise sentence whose restated condition repeats the eligibility (1118 shape)", () => {
  it("is true only where the restated eligibility holds and the earlier pair does not hold together", () => {
    const text = "If this unit was eligible to fight this phase, and this unit is not engaged, it can move six inches. Otherwise, if this unit was eligible to fight this phase, it can fall back.";
    const eligible = { subject: "this-unit", activity: "fight", negated: false };
    const steps = effectOf(text,
      ["this unit was eligible to fight this phase", "eligible", eligible],
      ["this unit is not engaged", "unit-state", engaged],
      ["it can move six inches", "make-move", move(6)],
      ["Otherwise", "otherwise", {}],
      ["if this unit was eligible to fight this phase", "eligible", eligible],
      ["it can fall back", "make-move", fallBack]).steps;
    const gate = steps[1].condition as Node;
    for (const e of [false, true]) for (const g of [false, true]) {
      expect(truth(gate, e, g)).toBe(e && g);
    }
    const normal = steps[0].condition as Node;
    for (const e of [false, true]) for (const g of [false, true]) {
      expect(truth(normal, e, g)).toBe(e && !g);
    }
  });
});

describe("an Otherwise bullet in a list (5644 shape, choice-open retired)", () => {
  it("gates the second bullet on the negation of the first bullet's within-range condition", () => {
    const text = "Each friendly ARMIGER unit from your army:\n■ If that unit is within 6\" of one or more friendly PSYKER models, you can re-roll one Hit roll.\n■ Otherwise, you can re-roll one Wound roll.";
    const steps = effectOf(text,
      ["Each friendly ARMIGER unit", "unit-filter", { side: "friendly", keywords: ["ARMIGER"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["If that unit is within 6\" of one or more friendly PSYKER models", "unit-position", { kind: "within", inches: 6, of: "matching-unit", subject: "antecedent", negated: false, of_keywords: ["PSYKER"], of_side: "friendly" }],
      ["you can", "optional-use", { who: "you" }],
      ["re-roll one Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all", count: 1 }],
      ["Otherwise", "otherwise", {}],
      ["you can", "optional-use", { who: "you" }],
      ["re-roll one Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all", count: 1 }]).steps;
    expect(steps[0].condition).toMatchObject({ type: "matches", parameters: { filter: { within: { range: { inches: 6 } } } } });
    expect(steps[1].condition).toEqual({ operator: "not", operands: [steps[0].condition] });
    expect(steps[1].effect).toMatchObject({ type: "re-roll", modifier: { roll: "wound" } });
  });
});

describe("bullets and colons split the sentences of a list before its Otherwise bullet (compile-placement.ts)", () => {
  it("numbers the sentences of the bullet list so each bullet is its own sentence", () => {
    const text = "Each friendly ARMIGER unit from your army:\n■ If that unit is within 6\" of one or more friendly PSYKER models, you can re-roll one Hit roll.\n■ Otherwise, you can re-roll one Wound roll.";
    const leaves = placed(text,
      ["Each friendly ARMIGER unit", "unit-filter", { side: "friendly", keywords: ["ARMIGER"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["If that unit is within 6\" of one or more friendly PSYKER models", "unit-position", { kind: "within", inches: 6, of: "matching-unit", subject: "antecedent", negated: false, of_keywords: ["PSYKER"], of_side: "friendly" }],
      ["you can", "optional-use", { who: "you" }],
      ["re-roll one Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all", count: 1 }],
      ["Otherwise", "otherwise", {}],
      ["you can", "optional-use", { who: "you" }],
      ["re-roll one Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all", count: 1 }]);
    expect(rawSentences(leaves, text)).toEqual([0, 0, 1, 1, 1, 2, 2, 2]);
  });
});

describe("an Otherwise after a phase-and-selection head (7005 shape, with a bearer-level condition)", () => {
  const text = "In your Command phase, select one friendly SPIRIT unit within 6\" of this model. If this model is below Starting Strength, you can return one destroyed model to that unit. Otherwise, one model in that unit regains up to D3 lost wounds.";
  const pieces: Piece[] = [
    ["In your Command phase", "phase-window", { phase: "command", turn: "own" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["friendly SPIRIT unit", "unit-filter", { side: "friendly", keywords: ["SPIRIT"] }],
    ["within 6\" of this model", "aura-range", { distance: 6 }],
    ["this model is below Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }],
    ["you can return one destroyed model", "return-models", { subject: "antecedent", count: 1 }],
    ["Otherwise", "otherwise", {}],
    ["one model in that unit regains up to D3 lost wounds", "regain-wounds", { subject: "antecedent", amount: "D3" }],
  ];

  it("keeps the phase and selection gates on the whole ability and negates the strength gate for the Otherwise sentence", () => {
    const effect = effectOf(text, ...pieces) as Node;
    expect(effect.type).toBe("conditional");
    expect(effect.condition.operands).toContainEqual({ type: "phase-is", parameters: { phase: "command" } });
    const selected = effect.effect.effect as Node;
    expect(selected.steps[0].condition).toEqual({ type: "strength", parameters: { below: "starting" } });
    expect(selected.steps[1].condition).toEqual({ operator: "not", operands: [{ type: "strength", parameters: { below: "starting" } }] });
  });

  it("compiles the 7005 shape with an antecedent strength condition: the head gates stay on the ability, the strength gate is the else gate", () => {
    const antecedentText = [
      "In your Command phase, select one friendly SPIRIT unit within 6\" of this model.",
      "If that unit is below Starting Strength, you can return one destroyed model to that unit.",
      "Otherwise, one model in that unit regains up to D3 lost wounds.",
    ].join(" ");
    const result = compile(antecedentText,
      ["In your Command phase", "phase-window", { phase: "command", turn: "own" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly SPIRIT unit", "unit-filter", { side: "friendly", keywords: ["SPIRIT"] }],
      ["within 6\" of this model", "aura-range", { distance: 6 }],
      ["that unit is below Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "antecedent", negated: false }],
      ["you can return one destroyed model", "return-models", { subject: "antecedent", count: 1 }],
      ["Otherwise", "otherwise", {}],
      ["one model in that unit regains up to D3 lost wounds", "regain-wounds", { subject: "antecedent", amount: "D3" }]);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    const effect = (result.mechanics as unknown as Node).effect as Node;
    // The head (phase window and selection) gates the whole ability: the Otherwise branch sits inside it.
    expect(effect.type).toBe("conditional");
    expect(effect.condition.operands).toContainEqual({ type: "phase-is", parameters: { phase: "command" } });
    const selected = effect.effect as Node;
    expect(selected.type).toBe("select-units");
    expect(selected.selector.filter.all_of).toEqual(["SPIRIT"]);
    const [returned, healed] = (selected.effect as Node).steps as Node[];
    const below = { type: "strength", parameters: { subject: "selected-unit", below: "starting" } };
    expect(returned!.condition).toEqual(below);
    expect(healed!.condition).toEqual({ operator: "not", operands: [below] });
  });
});

describe("an eligibility permission after an Otherwise sentence (2498 shape)", () => {
  const text = "End of the Fight phase. One friendly ALPHA unit from your army that was eligible to fight this phase. If your unit is not engaged, it can move six inches. Otherwise, your unit can fall back. It cannot embark within a TRANSPORT at the end of this move.";
  const pieces: Piece[] = [
    ["End of the Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "either" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
    ["that was eligible to fight this phase", "eligible", { subject: "this-unit", to: "fight" }, "TARGET"],
    ["your unit is not engaged", "unit-state", engaged],
    ["it can move six inches", "make-move", move(6)],
    ["Otherwise", "otherwise", {}],
    ["your unit can fall back", "make-move", fallBack],
    ["It cannot embark within a TRANSPORT", "eligibility-permission", { subject: "this-unit", activity: "embark", allow: false }],
  ];

  it("compiles, and the trailing permission carries no engaged term from the Otherwise pair", () => {
    const result = compile(text, ...pieces);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    const steps = ((result.mechanics as unknown as Node).effect as Node).steps as Node[];
    expect(steps[2]).toMatchObject({ type: "permission" });
    expect(JSON.stringify(steps[2])).not.toMatch(/engaged/u);
    expect(JSON.stringify(result.core)).toContain("ALPHA");
  });
});

describe("otherwise@1 parameters", () => {
  // Review-apply normalizes every decision's parameters; a family with no normalizer cannot be recorded at all.
  it("accepts the empty parameter object a reviewed leaf records", () => {
    expect(normalizeFingerprintParameters("otherwise", {}, currentFamilyVersion("otherwise"))).toEqual({});
  });

  it("rejects any parameter", () => {
    expect(() => normalizeFingerprintParameters("otherwise", { negated: true }, currentFamilyVersion("otherwise"))).toThrow();
  });
});
