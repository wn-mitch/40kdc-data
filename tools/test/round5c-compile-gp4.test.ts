import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each shape keeps the structure of a record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
}

function resultOf(text: string, pieces: Piece[]): Record<string, any> {
  const result = compileLeaves(placed(text, pieces), text);
  if (!result.ok) throw new Error(`expected a compiled record, got: ${result.errors.join(" | ")}`);
  return result;
}

const mechanicsOf = (text: string, pieces: Piece[]): Record<string, any> => resultOf(text, pieces).mechanics;

function errorsOf(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(placed(text, pieces), text);
  return result.ok ? [] : result.errors;
}

const keyword = (word: string, subject = "this-unit"): Record<string, unknown> => ({ keywords: [word], subject, negated: false });

/** A Stratagem's header: the Fight-phase window and a WHEN moment, then one KEYA target. */
const WHEN: Piece[] = [
  ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
  ["enemy unit", "unit-filter", { side: "enemy" }, "WHEN"],
  ["targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
  ["friendly KEYA unit", "unit-filter", { side: "friendly", keywords: ["KEYA"] }, "WHEN"],
];
const TARGET: Piece[] = [
  ["One", "stratagem-target", { count: "one" }, "TARGET"],
  ["KEYA unit", "unit-filter", { side: "friendly", keywords: ["KEYA"] }, "TARGET"],
  ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
];

describe("a Stratagem's WHEN moment binds the enemy unit a later moment's effect names (compile-when-subject.ts)", () => {
  const text = "Fight phase, when an enemy unit targets a friendly KEYA unit.\nOne KEYA unit from your army.\nWhen a KEYA model in your unit is destroyed, roll one D6: On a 1, that enemy unit suffers 1 mortal wound.";
  const effect: Piece[] = [
    ["When a KEYA model in your unit is destroyed", "event", { kind: "model-destroyed" }, "EFFECT"],
    ["roll one D6", "dice-roll", { dice: "D6" }, "EFFECT"],
    ["On a 1", "roll-result", { from: 1, to: 1 }, "EFFECT"],
    ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }, "EFFECT"],
  ];

  it("names the WHEN unit by event variable, under the later moment as a part of the WHEN trigger", () => {
    const mechanics = mechanicsOf(text, [...WHEN, ...TARGET, ...effect]);
    expect(mechanics.trigger).toMatchObject({ event: "targets-selected", binds_event_variable: "when-subject" });
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "model-destroyed" } });
    const outcomes = mechanics.effect.effect.outcomes as Array<Record<string, any>>;
    expect(outcomes[0]!.effect).toMatchObject({ type: "mortal-wounds", target: { event_var: "when-subject" } });
  });

  it("keeps the refusal when the recipient follows no later moment", () => {
    const direct = "Fight phase, when an enemy unit targets a friendly KEYA unit.\nOne KEYA unit from your army.\nRoll one D6: On a 1, that enemy unit suffers 1 mortal wound.";
    const errors = errorsOf(direct, [...WHEN, ...TARGET, ["Roll one D6", "dice-roll", { dice: "D6" }, "EFFECT"], effect[2]!, effect[3]!]);
    expect(errors.join(" ")).toContain("select-unit");
  });

  it("keeps the refusal when the recipient's wording does not say enemy", () => {
    const friendly = text.replace("that enemy unit suffers", "that unit suffers");
    const errors = errorsOf(friendly, [...WHEN, ...TARGET, ...effect.map((piece): Piece => piece[1] === "mortal-wounds" ? ["that unit suffers 1 mortal wound", piece[1], piece[2], piece[3]] : piece)]);
    expect(errors.join(" ")).toContain("select-unit");
  });

  it("keeps the refusal when the Stratagem selects a unit of its own", () => {
    const select = text.replace("roll one D6", "select one enemy unit, then roll one D6");
    const errors = errorsOf(select, [...WHEN, ...TARGET, effect[0]!, ["select one", "select-unit", { distance: "any", visible: false }, "EFFECT"], ["enemy unit", "unit-filter", { side: "enemy" }, "EFFECT"], ...effect.slice(1)]);
    expect(errors.join(" ")).not.toContain("when-subject");
  });
});

describe("a Stratagem's effect moment is a part under its WHEN moment (compile.ts nestedWhenMoments)", () => {
  const text = "Your opponent's Shooting phase, just after a KEYA model from your army is destroyed.\nOne KEYB unit from your army.\nAfter the attacking unit has shot, your unit can shoot as if it were your Shooting phase.";
  const pieces: Piece[] = [
    ["Your opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN"],
    ["KEYA model", "unit-filter", { side: "friendly", keywords: ["KEYA"], level: "model" }, "WHEN"],
    ["from your army is destroyed", "event", { kind: "model-destroyed" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["KEYB unit", "unit-filter", { side: "friendly", keywords: ["KEYB"] }, "TARGET"],
    ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
    ["After the attacking unit has shot", "event", { kind: "enemy-has-shot" }, "EFFECT"],
    ["your unit can shoot as if it were your Shooting phase", "eligibility-permission", { subject: "this-unit", activity: "shoot", allow: true, as_if: "shooting-phase" }, "EFFECT"],
  ];

  it("fires the permission only on the later moment, with the WHEN moment as the Stratagem's own", () => {
    const mechanics = mechanicsOf(text, pieces);
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed" });
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "attacks-resolved", subject: { owner: "enemy" } }, effect: { type: "permission" } });
  });

  it("keeps a moment that restates the WHEN moment beside it", () => {
    const again = "Your opponent's Shooting phase, just after a KEYA model from your army is destroyed.\nOne KEYB unit from your army.\nWhen a KEYA model in your unit is destroyed, your unit can shoot as if it were your Shooting phase.";
    const restated: Piece[] = [...pieces.slice(0, 6), ["When a KEYA model in your unit is destroyed", "event", { kind: "model-destroyed" }, "EFFECT"], pieces[7]!];
    const mechanics = mechanicsOf(again, restated);
    expect(Array.isArray(mechanics.trigger)).toBe(true);
    expect(mechanics.effect.type).toBe("permission");
  });

  it("keeps the Stratagem's own use beside its WHEN moment", () => {
    const use = "Your opponent's Shooting phase, just after a KEYA model from your army is destroyed.\nOne KEYB unit from your army.\nEach time you use this Stratagem, your unit can shoot as if it were your Shooting phase.";
    const used: Piece[] = [...pieces.slice(0, 6), ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }, "EFFECT"], pieces[7]!];
    expect(mechanicsOf(use, used).effect.type).toBe("permission");
  });

  it("puts a selection printed before the later moment outside the part", () => {
    const chosen = "Start of your Charge phase.\nOne KEYB unit from your army.\nSelect one enemy unit. When that enemy unit declares a charge, that enemy unit has -1 to Charge rolls.";
    const selected: Piece[] = [
      ["Start of your Charge phase", "event", { kind: "phase-start", phase: "charge", turn: "your" }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["KEYB unit", "unit-filter", { side: "friendly", keywords: ["KEYB"] }, "TARGET"],
      ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
      ["Select one", "select-unit", { distance: "any", visible: false }, "EFFECT"],
      ["enemy unit", "unit-filter", { side: "enemy" }, "EFFECT"],
      ["When that enemy unit declares a charge", "event", { kind: "enemy-declared-charge" }, "EFFECT"],
      ["that enemy unit has -1 to Charge rolls", "roll-modifier", { roll: "charge", operation: "subtract", value: 1, subject: "this-unit" }, "EFFECT"],
    ];
    const mechanics = mechanicsOf(chosen, selected);
    expect(mechanics.effect.type).toBe("select-units");
    expect(mechanics.effect.effect).toMatchObject({ type: "ability-part", trigger: { event: "targets-selected" } });
  });
});

describe("a selection's exclusion folds past the selected unit's conditions (compile-select-exclusions.ts)", () => {
  const text = "At the end of the phase, you can select one friendly KEYA unit that has 6 or fewer models that is wholly within 6\" of this model (you cannot select a unit that can KEYB).";
  const pieces: Piece[] = [
    ["At the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
    ["you can", "optional-use", { who: "you" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["friendly KEYA unit", "unit-filter", { side: "friendly", keywords: ["KEYA"] }],
    ["that has 6 or fewer models", "model-count", { subject: "selected-unit", max: 6 }],
    ["that is wholly within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false, wholly: true }],
    ["(you cannot select a unit that can KEYB)", "unit-filter", { side: "friendly", excluded_keywords: ["KEYB"] }],
    ["", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true }],
  ].filter((piece) => piece[0] !== "") as Piece[];

  it("excludes the keyword from the selection after a model count and a distance", () => {
    const withEffect = `${text} That unit can embark.`;
    const mechanics = mechanicsOf(withEffect, [...pieces.slice(0, 7), ["That unit can embark", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true }]]);
    const selector = mechanics.effect.selector;
    expect(selector).toMatchObject({ owner: "friendly", keywords: ["KEYA"], excluded_keywords: ["KEYB"] });
    expect(selector.eligibility.operands.map((operand: any) => operand.type)).toEqual(["model-count", "within"]);
  });

  it("still refuses an exclusion for the other side", () => {
    const withEffect = `${text} That unit can embark.`;
    const wrongSide: Piece = ["(you cannot select a unit that can KEYB)", "unit-filter", { side: "enemy", excluded_keywords: ["KEYB"] }];
    const errors = errorsOf(withEffect, [...pieces.slice(0, 6), wrongSide, ["That unit can embark", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true }]]);
    expect(errors.join(" ")).toContain("side");
  });

  it("still refuses an exclusion that follows an unrelated condition of the selection", () => {
    const other = "At the end of the phase, you can select one friendly KEYA unit that is battle-shocked (you cannot select a unit that can KEYB). That unit can embark.";
    const errors = errorsOf(other, [
      pieces[0]!, pieces[1]!, pieces[2]!, pieces[3]!,
      ["that is battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "selected-unit", negated: false }],
      ["(you cannot select a unit that can KEYB)", "unit-filter", { side: "friendly", excluded_keywords: ["KEYB"] }],
      ["That unit can embark", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true }],
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("a roll change that says \"as well\" keeps the attack qualifier of the sentence before it (compile-attack-continuation.ts)", () => {
  const text = "This unit must take a Battle-shock test and, until the end of the phase, each time a model in this unit makes an attack that targets your unit, subtract 1 from the Hit roll. If that test was failed, subtract 1 from the Wound roll as well.";
  const pieces: Piece[] = [
    ["This unit must take a Battle-shock test", "test", { target: "this-unit", test: "battle-shock" }],
    ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["that targets your unit", "same-unit", { subject: "defender", as: "this-unit" }],
    ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }],
    ["that test was failed", "roll-outcome", { roll: "battle-shock", result: "failure" }],
    ["subtract 1 from the Wound roll", "roll-modifier", { roll: "wound", operation: "subtract", value: 1 }],
  ];
  const sameUnit = { type: "same-unit", parameters: { subject: "defender", as: "this-unit" } };

  it("gates the Wound change on the same unit as the Hit change", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Array<Record<string, any>>;
    const wound = steps.find((step) => JSON.stringify(step).includes('"wound"'))!;
    expect(JSON.stringify(wound.condition)).toContain(JSON.stringify(sameUnit));
    expect(JSON.stringify(steps.find((step) => JSON.stringify(step).includes('"hit"'))!.condition)).toContain(JSON.stringify(sameUnit));
  });

  it("leaves a later sentence without \"as well\" ungated by the attack qualifier", () => {
    const plain = text.replace(" as well", "");
    const steps = mechanicsOf(plain, pieces).effect.steps as Array<Record<string, any>>;
    const wound = steps.find((step) => JSON.stringify(step).includes('"wound"'))!;
    expect(JSON.stringify(wound.condition)).not.toContain("same-unit");
  });
});

describe("a moment inside a result band is a part of that band (compile-band-moment.ts)", () => {
  const text = "In your phase, you can roll one D6:\rOn a 1, this model has KEYA, and when this unit has shot, this model is destroyed.\rOn a 2-5, this model has +1 A.\rOn a 6, this model has KEYB.";
  const pieces: Piece[] = [
    ["In your phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["you can", "optional-use", { who: "you" }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["On a 1", "roll-result", { from: 1, to: 1 }],
    ["this model has KEYA", "weapon-ability-grant", { subject: "this-model", keyword: "Torrent", weapon_type: "ranged" }],
    ["when this unit has shot", "event", { kind: "after-shooting" }],
    ["this model is destroyed", "destroy-models", { recipient: "this-model", count: "1" }],
    ["On a 2-5", "roll-result", { from: 2, to: 5 }],
    ["+1 A", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 1, weapon_type: "ranged" }],
    ["On a 6", "roll-result", { from: 6, to: 6 }],
    ["this model has KEYB", "weapon-ability-grant", { subject: "this-model", keyword: "Sustained Hits 2", weapon_type: "ranged" }],
  ];

  it("keeps the destruction under the first band's outcome, behind the shooting moment", () => {
    const mechanics = mechanicsOf(text, pieces);
    const table = JSON.stringify(mechanics.effect);
    const outcomes = (mechanics.effect.effect ?? mechanics.effect).outcomes as Array<Record<string, any>>;
    expect(outcomes.map((outcome) => outcome.results)).toEqual([[1], [2, 3, 4, 5], [6]]);
    expect(outcomes[0]!.effect.steps.map((step: any) => step.type)).toEqual(["weapon-ability-grant", "ability-part"]);
    expect(outcomes[0]!.effect.steps[1]).toMatchObject({ trigger: { event: "attacks-resolved" }, effect: { type: "destroy-models" } });
    expect(table.match(/destroy-models/gu)).toHaveLength(1);
    expect(mechanics.trigger).toBeNull();
  });

  it("does not move a moment that comes before any dice roll", () => {
    const early = "In your phase, when this unit has shot, you can roll one D6:\rOn a 1, this model has KEYA.";
    const mechanics = mechanicsOf(early, [
      pieces[0]!, ["when this unit has shot", "event", { kind: "after-shooting" }], pieces[1]!, pieces[2]!, pieces[3]!, ["this model has KEYA", "weapon-ability-grant", { subject: "this-model", keyword: "Torrent", weapon_type: "ranged" }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "attacks-resolved" });
  });
});

describe("a sentence that opens with Then runs once after a for-each (compile-for-each-tail.ts)", () => {
  const text = "Roll one D6 for each enemy unit engaged with your unit: On a 2+ that enemy unit suffers D6 mortal wounds. Then, your unit suffers 3D3 mortal wounds.";
  const pieces: Piece[] = [
    ["Roll one D6", "dice-roll", { dice: "D6" }],
    ["for each", "for-each-unit-select", {}],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["engaged with your unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "this-unit" }],
    ["On a 2+", "roll-result", { from: 2 }],
    ["that enemy unit suffers D6 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D6" }],
    ["your unit suffers 3D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "3D3" }],
  ];

  it("applies the trailing wounds once, beside the loop", () => {
    const effect = mechanicsOf(text, pieces).effect;
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step: any) => step.type)).toEqual(["for-each-unit", "mortal-wounds"]);
    expect(effect.steps[1]).toMatchObject({ target: "this-unit", modifier: { count: "3D3" } });
  });

  it("keeps a later sentence without Then inside the loop", () => {
    const plain = text.replace("Then, your unit", "Your unit");
    const effect = mechanicsOf(plain, [...pieces.slice(0, 6), ["Your unit suffers 3D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "3D3" }]]).effect;
    expect(effect.type).toBe("for-each-unit");
  });

  it("keeps a Then sentence that names the loop's unit inside it", () => {
    const again = text.replace("Then, your unit suffers 3D3 mortal wounds", "Then, that enemy unit suffers 3D3 mortal wounds");
    const effect = mechanicsOf(again, [...pieces.slice(0, 6), ["that enemy unit suffers 3D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3D3" }]]).effect;
    expect(effect.type).toBe("for-each-unit");
  });
});

describe("a While-led leading frame gates a later sentence that says that unit (compile-segments.ts leadingFrame)", () => {
  const text = "While this model is leading a unit, models in that unit have the KEYA ability. When making a Normal move, models in that unit can move through models.";
  const pieces: Piece[] = [
    ["While this model is leading a unit", "leading-unit", { subject: "this-model", attachment: "leading" }],
    ["models in that unit have the KEYA ability", "core-ability-grant", { subject: "this-unit", ability: "deep-strike", value: { rating: true } }],
    ["When making a Normal move", "event", { kind: "move-ended", move_types: ["normal"], subject: "antecedent" }],
    ["models in that unit can move through models", "move-through", { subject: "antecedent", passthrough: ["models"], applies_to_moves: ["normal"] }],
  ];
  const leading = { type: "attachment", parameters: { subject: "this-model", role: "leading" } };

  it("carries the leading condition into the second sentence's part", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "move-ended" }, effect: { type: "conditional", condition: leading } });
  });

  it("leaves a later sentence that never says that unit ungated", () => {
    const other = text.replace("models in that unit can move through models", "this model can move through models");
    const steps = mechanicsOf(other, [...pieces.slice(0, 3), ["this model can move through models", "move-through", { subject: "this-model", passthrough: ["models"], applies_to_moves: ["normal"] }]]).effect.steps as Array<Record<string, any>>;
    expect(JSON.stringify(steps[1])).not.toContain("attachment");
  });
});

describe("a printed duration inside an eligibility ban is its own leaf (BRIEF: buried durations)", () => {
  const text = "At the start of the phase, until the end of the phase, this unit has the KEYA ability. This unit is not eligible to declare a charge in the same turn.";
  const base: Piece[] = [
    ["At the start of the phase", "event", { kind: "phase-start", phase: "any", turn: "either" }],
    ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["this unit has the KEYA ability", "core-ability-grant", { subject: "this-unit", ability: "deep-strike", value: { rating: true } }],
  ];

  it("lasts the turn when the wording is split from the ban", () => {
    const steps = mechanicsOf(text, [...base, ["This unit is not eligible to declare a charge", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: false }], ["in the same turn", "duration", { endpoint: "end-of-turn" }]]).effect;
    const parts = JSON.stringify(steps);
    expect(parts).toContain('"duration":"phase"');
    expect(parts).toContain('"duration":"turn"');
  });
});

describe("an optional re-roll traded for a suppressed rule stays per attack and optional (compile-cross-family-instead.ts)", () => {
  const text = "Each time this unit ends a Charge move, you can declare a gambit. If you do, until the end of the turn, this unit does not have the KEYA ability, but instead, each time a model in this unit makes an attack, you can re-roll the Hit roll and you can re-roll a Wound roll of 1.";
  const pieces: Piece[] = [
    ["Each time this unit ends a Charge move", "event", { kind: "move-ended", move_types: ["charge"] }],
    ["you can", "optional-use", { who: "you" }],
    ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ["this unit does not have the KEYA ability", "rule-state", { subject: "this-unit", direction: "suppressed", rule_kind: "core-rule", rule: "fights-first" }],
    ["instead", "instead", {}],
    ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
    ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
  ];

  it("compiles the loss and both re-rolls under the optional charge-end moment for the turn, none mandatory", () => {
    const mechanics = mechanicsOf(text, pieces);
    expect(mechanics.scope).toMatchObject({ duration: "turn" });
    expect(mechanics.trigger).toMatchObject({ event: "move-ended", optional: true });
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.type)).toEqual(["rule-state", "re-roll", "re-roll"]);
    expect(steps.every((step) => step.modifier.mandatory === undefined)).toBe(true);
  });
});
