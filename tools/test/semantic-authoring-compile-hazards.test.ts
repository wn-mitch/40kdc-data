import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, expectRefused, placed, type Item } from "./semantic-authoring-connective-fixture.js";

/**
 * Compositions of moments, durations, selections and designations whose parts each compile alone, but whose
 * combination the compiler once read wrongly: a duration bounding the wrong part, a mark taking another part's
 * expiry, a selection dropped or escaped, a step window or use reaching only one of several moments. Each case either
 * pins the reading or the explicit refusal. All wording is fabricated for this file.
 */

type Mechanics = { trigger: any; scope: { duration: string }; effect: any };
/** A registered designation, so a designate-target compiles (compile-wrappers.ts designationIdFor). */
const FIXTURE_RULE_NAME = "A Trap Well Laid";
function compiled(text: string, ...items: Item[]): Mechanics {
  const result = compileLeaves(placed(text, ...items), text, { name: FIXTURE_RULE_NAME });
  expectCompiled(result);
  return result.mechanics as unknown as Mechanics;
}
function refused(text: string, ...items: Item[]): string[] {
  const result = compileLeaves(placed(text, ...items), text, { name: FIXTURE_RULE_NAME });
  expectRefused(result);
  return result.errors;
}

const PHASE = { endpoint: "end-of-phase" };
const TURN = { endpoint: "end-of-turn" };
const SELECT_ENEMY = { scope: "enemy", distance: "any", visible: false };
const SELECT_FRIENDLY = { scope: "friendly", distance: "any", visible: false };
const HIT_PLUS_ONE: Item = ["add 1 to Hit rolls for this unit", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }];
const LEADERSHIP = (wording: string): Item => [wording, "characteristic-modifier", { subject: "this-unit", characteristics: ["Ld"], operation: "add", value: 1, weapon_type: "all" }];
const MOVEMENT_START: Item = ["At the start of your Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "your" }];

describe("a single printed duration in an ability with several moments", () => {
  it("in a triggered first part, lasts that part, not a later part in another sentence", () => {
    const text = "Each time this unit is selected to shoot, until the end of the phase, add 1 to Hit rolls for this unit. Then, each time this unit ends a Normal move, add 1 to the Leadership of this unit.";
    const mechanics = compiled(text,
      ["Each time this unit is selected to shoot", "event", { kind: "selected", to: "shoot", subject: "this-unit" }],
      ["until the end of the phase", "duration", PHASE],
      HIT_PLUS_ONE,
      ["each time this unit ends a Normal move", "event", { kind: "move-ended", move_types: ["normal"], subject: "this-unit" }],
      LEADERSHIP("add 1 to the Leadership of this unit"));
    expect(mechanics.scope.duration).toBe("permanent");
    const [shoot, move] = mechanics.effect.steps;
    expect(shoot).toMatchObject({ type: "ability-part", duration: "phase", trigger: { event: "selected" } });
    expect(move).toMatchObject({ type: "ability-part", trigger: { event: "move-ended" } });
    expect(move.duration).toBeUndefined();
  });

  it("on a first part's mark, lasts that part, so a later fight moment is not cut to the shooting phase", () => {
    const text = "At the start of your Shooting phase, select one enemy unit; until the end of the phase, that unit is wracked. Each time this unit is selected to fight, add 1 to Hit rolls for this unit.";
    const mechanics = compiled(text,
      ["At the start of your Shooting phase", "event", { kind: "phase-start", phase: "shooting", turn: "your" }],
      ["select one enemy unit", "select-unit", SELECT_ENEMY],
      ["until the end of the phase", "duration", PHASE],
      ["that unit is wracked", "apply-mark", { subject: "selected-unit", tag: "wracked-with-agonies" }],
      ["Each time this unit is selected to fight", "event", { kind: "selected", to: "fight", subject: "this-unit" }],
      HIT_PLUS_ONE);
    expect(mechanics.scope.duration).toBe("permanent");
    expect(mechanics.effect.steps[0]).toMatchObject({ duration: "phase", effect: { type: "select-units" } });
    expect(mechanics.effect.steps[1].duration).toBeUndefined();
  });

  it("over a sentence that also holds the later moment, stays the ability's scope", () => {
    const text = "Each time this unit is selected to shoot, until the end of the phase, add 1 to Hit rolls for this unit and each time this unit ends a Normal move, add 1 to the Leadership of this unit.";
    const mechanics = compiled(text,
      ["Each time this unit is selected to shoot", "event", { kind: "selected", to: "shoot", subject: "this-unit" }],
      ["until the end of the phase", "duration", PHASE],
      HIT_PLUS_ONE,
      ["each time this unit ends a Normal move", "event", { kind: "move-ended", move_types: ["normal"], subject: "this-unit" }],
      LEADERSHIP("add 1 to the Leadership of this unit"));
    expect(mechanics.scope.duration).toBe("phase");
  });

  it("in a later part of a standing ability, lasts that part, and a mark read after the attacks still clears at the phase end", () => {
    const text = "In your Shooting phase, select one enemy unit: that unit is struck by debris. After this model has resolved its attacks, each enemy unit struck by debris suffers D3 mortal wounds. This unit can then be selected to shoot again; until the end of the turn, add 1 to the Leadership of this unit.";
    const mechanics = compiled(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["select one enemy unit", "select-unit", SELECT_ENEMY],
      ["that unit is struck by debris", "apply-mark", { subject: "selected-unit", tag: "struck-by-explosive-debris" }],
      ["After this model has resolved its attacks", "event", { kind: "attacks-resolved", subject: "this-model" }],
      ["each enemy unit struck by debris", "unit-filter", { side: "enemy", designated: "struck-by-explosive-debris" }],
      ["suffers D3 mortal wounds", "mortal-wounds", { recipient: "antecedent", count: "D3" }],
      ["until the end of the turn", "duration", TURN],
      LEADERSHIP("add 1 to the Leadership of this unit"));
    expect(mechanics.scope.duration).toBe("permanent");
    const effect = JSON.stringify(mechanics.effect);
    expect(effect).toContain('"tag":"struck-by-explosive-debris","clears_on":"phase"');
    expect(effect).toContain('"duration":"turn"');
  });
});

describe("a designation a unit applies to another", () => {
  it("does not take a later part's duration as its expiry", () => {
    const text = "At the start of your Command phase, select one friendly FIXTURE unit. That unit is bonded to this unit. Each time this unit is selected to shoot, until the end of the phase, add 1 to Hit rolls for this unit.";
    expect(refused(text,
      ["At the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }],
      ["select one friendly", "select-unit", SELECT_FRIENDLY],
      ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }],
      ["That unit is bonded to this unit", "apply-mark", { subject: "selected-unit", tag: "bondsman-affected", by: "this-unit" }],
      ["Each time this unit is selected to shoot", "event", { kind: "selected", to: "shoot", subject: "this-unit" }],
      ["until the end of the phase", "duration", PHASE],
      HIT_PLUS_ONE)).toContain("A designation a unit applies to another needs its duration printed, or it never ends.");
  });
});

describe("attacks against a selected unit", () => {
  const ATTACK_ITEMS: Item[] = [
    ["At the start of your Shooting phase", "event", { kind: "phase-start", phase: "shooting", turn: "your" }],
    ["select one enemy unit", "select-unit", SELECT_ENEMY],
    ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["that unit", "target-is-selected", {}],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  ];
  it("refuses a later sentence's own-unit effect rather than limit it to those attacks", () => {
    const text = "At the start of your Shooting phase, select one enemy unit. Each time a model in this unit makes an attack that targets that unit, add 1 to the Hit roll. Add 1 to the Leadership of this unit.";
    expect(refused(text, ...ATTACK_ITEMS, LEADERSHIP("Add 1 to the Leadership of this unit"))).toContain("A unit is selected, but not every effect is limited to attacks against it.");
  });

  it("keeps every sentence a colon lists under the attacks", () => {
    const text = "At the start of your Shooting phase, select one enemy unit. Each time a model in this unit makes an attack that targets that unit, it can: Add 1 to the Hit roll. Add 1 to the Wound roll.";
    const mechanics = compiled(text, ...ATTACK_ITEMS.slice(0, 4),
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["Add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]);
    const designation = JSON.stringify(mechanics.effect);
    expect(designation).toContain('"to":"attackers-of-target"');
    expect(designation).toContain('"roll":"wound"');
  });
});

describe("a selection and the moments after it", () => {
  it("keeps the selection around a first part that has no moment", () => {
    const text = "Select one friendly unit: add 1 to the Leadership of that unit. At the end of the phase, this unit suffers 1 mortal wound.";
    const mechanics = compiled(text,
      ["Select one friendly unit", "select-unit", SELECT_FRIENDLY],
      ["add 1 to the Leadership of that unit", "characteristic-modifier", { subject: "selected-unit", characteristics: ["Ld"], operation: "add", value: 1, weapon_type: "all" }],
      ["At the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]);
    expect(mechanics.effect.steps[0]).toMatchObject({ type: "select-units", effect: { type: "stat-modifier", target: "selected-unit" } });
  });

  const OPENING: Item[] = [MOVEMENT_START, ["you can", "optional-use", { who: "you" }], ["select one friendly unit", "select-unit", SELECT_FRIENDLY]];
  const OWN_MOMENT: Item = ["when that unit is selected to make an Advance move", "event", { kind: "selected", to: "move", move_types: ["advance"], subject: "antecedent" }];
  const ENEMY_MOVE: Item = ["when an enemy unit ends a Normal move", "event", { kind: "move-ended", owner: "enemy", move_types: ["normal"] }];
  const ELIGIBLE = (wording: string, activity: string): Item => [wording, "eligibility-permission", { subject: "antecedent", activity, allow: true }];

  it("refuses another moment printed as an alternative to the selected unit's own", () => {
    const text = "At the start of your Movement phase, you can select one friendly unit. If you do, when that unit is selected to make an Advance move or when an enemy unit ends a Normal move this turn: that unit is eligible to shoot.";
    const errors = refused(text, ...OPENING, OWN_MOMENT, ENEMY_MOVE, ["this turn", "duration", TURN], ELIGIBLE("that unit is eligible to shoot", "shoot"));
    expect(errors).toEqual([expect.stringMatching(/the selection cannot carry its effect to that moment/u)]);
  });

  it("refuses an unrelated later moment that acts on the selected unit, after the selected unit's own", () => {
    const text = "At the start of your Movement phase, you can select one friendly unit. If you do, when that unit is selected to make an Advance move this turn: that unit is eligible to shoot. When an enemy unit ends a Normal move this turn, that unit is eligible to declare a charge.";
    const errors = refused(text, ...OPENING, OWN_MOMENT, ["this turn", "duration", TURN], ELIGIBLE("that unit is eligible to shoot", "shoot"),
      ["When an enemy unit ends a Normal move", "event", { kind: "move-ended", owner: "enemy", move_types: ["normal"] }],
      ["this turn", "duration", TURN], ELIGIBLE("that unit is eligible to declare a charge", "declare-charge"));
    expect(errors).toEqual([expect.stringMatching(/the selection cannot carry its effect to that moment/u)]);
  });

  it("nests the selected unit's own moment alone in the selection", () => {
    const text = "At the start of your Movement phase, you can select one friendly unit. If you do, when that unit is selected to make an Advance move this turn: that unit is eligible to shoot.";
    const mechanics = compiled(text, ...OPENING, OWN_MOMENT, ["this turn", "duration", TURN], ELIGIBLE("that unit is eligible to shoot", "shoot"));
    expect(mechanics.effect).toMatchObject({ type: "select-units", effect: { type: "ability-part", trigger: { event: "selected", subject: "selected-unit" } } });
  });
});

describe("a step window over alternative moments", () => {
  it("narrows each alternative, not only the first", () => {
    const text = "In the Reinforcements step of your opponent's Movement phase, just after an enemy unit is set up on the battlefield from Reserves or just after an enemy unit ends a Normal move, this unit can make a Normal move of up to 6\".";
    const { trigger } = compiled(text,
      ["the Reinforcements step of your opponent's Movement phase", "event", { kind: "step-started", step: "reinforcements", turn: "opponent" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["set up on the battlefield from Reserves", "event", { kind: "move-ended", move_types: ["ingress"] }],
      ["just after an enemy unit ends a Normal move", "event", { kind: "move-ended", owner: "enemy", move_types: ["normal"] }],
      ["this unit can make a Normal move of up to 6\"", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }]);
    expect(trigger).toHaveLength(2);
    for (const moment of trigger) expect(JSON.stringify(moment.condition)).toContain('"step":"reinforcements"');
  });
});

describe("a moment under a use with no effect between them", () => {
  it("is refused, since joined as an alternative it would fire without the use", () => {
    const text = "At the start of your opponent's Movement phase, you can use this ability. If you do, when an enemy unit ends a Normal move, that unit suffers 1 mortal wound.";
    const errors = refused(text,
      ["At the start of your opponent's Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "opponent" }],
      ["you can", "optional-use", { who: "you" }],
      ["when an enemy unit ends a Normal move", "event", { kind: "move-ended", owner: "enemy", move_types: ["normal"] }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "antecedent", count: "1" }]);
    expect(errors).toEqual([expect.stringMatching(/waits on the use an earlier moment offers/u)]);
  });
});
