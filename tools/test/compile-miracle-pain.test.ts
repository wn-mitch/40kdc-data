import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import { describeEffect } from "../src/translate/effect.js";
import { describeTrigger } from "../src/translate/trigger.js";
import { expectCompiled, expectRefused, placed } from "./semantic-authoring-connective-fixture.js";

// Dice pools whose dice carry a value, a state bought with a spend, and a capped gain. Wording is fabricated.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters);
const leaf = (type: string, modifier: Record<string, unknown>) => ({ type, target: "this-model", modifier });

describe("the families", () => {
  it("reads a spend of a range as at_least up to up_to, never an empty or inverted range", () => {
    expect(normalize("resource-spend", { pool: "pain-token-pool", amount: { up_to: 3, at_least: 1 }, bind_as: "spent" })).toMatchObject({ amount: { up_to: 3, at_least: 1 } });
    expect(normalize("resource-spend", { pool: "pain-token-pool", amount: { up_to: 2 } })).toMatchObject({ amount: { up_to: 2 } });
    expect(() => normalize("resource-spend", { pool: "pain-token-pool", amount: { up_to: 3, at_least: 3 } })).toThrow();
    expect(() => normalize("resource-spend", { pool: "pain-token-pool", amount: { up_to: 3, at_most: 1 } })).toThrow();
  });

  it("takes a spent amount for the wounds a returned model has", () => {
    expect(normalize("wounds-remaining", { value: { spent: "pain" } })).toEqual({ value: { spent: "pain" } });
    expect(normalize("wounds-remaining", { value: "3" })).toEqual({ value: 3 });
    expect(() => normalize("wounds-remaining", { value: { pool: "pain" } })).toThrow();
  });

  it("reads a die gained at a roll's result only as add, with roll-result", () => {
    expect(normalize("resource-die", { pool: "miracle-dice-pool", operation: "add", value: "roll-result" })).toMatchObject({ value: "roll-result" });
    expect(() => normalize("resource-die", { pool: "miracle-dice-pool", operation: "add", value: "that-result" })).toThrow();
  });

  it("names the unit a spend serves by object or by its owner, not both", () => {
    const spend = { kind: "resource-spent", pool: "pain-token-pool", tag: "empowered" };
    expect(normalize("event", { ...spend, object_owner: "friendly" })).toMatchObject({ object_owner: "friendly" });
    expect(() => normalize("event", { ...spend, object_owner: "friendly", object: "this-unit" })).toThrow(/not both/u);
  });

  it("keeps own_ability to occupied-by and caps a gain only from a named source", () => {
    expect(normalize("objective-criterion", { criterion: "occupied-by", side: "friendly", own_ability: true })).toEqual({ criterion: "occupied-by", own_ability: true, side: "friendly" });
    expect(() => normalize("objective-criterion", { criterion: "clear-of", side: "enemy", own_ability: true })).toThrow();
    expect(() => normalize("objective-criterion", { criterion: "occupied-by", side: "friendly", own_ability: false })).toThrow();
    expect(normalize("resource-gain-cap", { pool: "pain-token-pool", max: 3, source: "failed-battle-shock" })).toEqual({ pool: "pain-token-pool", max: 3, source: "failed-battle-shock" });
    expect(() => normalize("resource-gain-cap", { pool: "pain-token-pool", max: 0, source: "failed-battle-shock" })).toThrow();
    expect(() => normalize("resource-gain-cap", { pool: "pain-token-pool", max: 3, source: "destroyed" })).toThrow();
  });

  it("maps every earlier leaf of a bumped family onto the current version unchanged", () => {
    for (const [family, from] of [["event", 40], ["event", 41], ["resource-spend", 4], ["resource-spend", 5], ["resource-die", 1], ["wounds-remaining", 1], ["objective-criterion", 2]] as const) {
      const parameters = { probe: family };
      expect(mapToLatest(family, from, parameters)).toMatchObject({ family, parameters });
    }
  });
});

describe("bullets that print the effect before its moment", () => {
  const text = "You gain Glim tokens as follows:\n■ 1 Glim token at the start of your Command phase.\n■ 1 Glim token each time an enemy unit is destroyed.";
  const gain = ["1 Glim token", "resource-gain", { pool: "pain-token-pool", amount: 1 }] as const;

  it("fires each bullet's gain at its own moment", () => {
    const result = compileLeaves(placed(text,
      gain, ["at the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }],
      gain, ["enemy unit", "unit-filter", { side: "enemy" }], ["is destroyed", "event", { kind: "unit-destroyed" }]), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics.effect);
    // Two parts, one gain each: without the fold the first gain is unconditional and the last moment fires nothing.
    expect(json.match(/"type":"ability-part"/gu)?.length).toBe(2);
    expect(json.match(/"type":"resource-gain"/gu)?.length).toBe(2);
    expect(json).toContain('"trigger":{"event":"phase-started"');
    expect(json).toContain('"trigger":{"event":"destroyed","object":{"owner":"enemy"}}');
  });

  it("fires an effect introduced by a colon at each moment the bullets after it list", () => {
    const listed = "You gain 1 Glim die:\n■ At the start of each battle round.\n■ Each time a friendly unit is destroyed.";
    const result = compileLeaves(placed(listed,
      ["You gain 1 Glim die", "resource-die", { pool: "miracle-dice-pool", operation: "add", value: "rolled" }],
      ["At the start of each battle round", "turn-start", { turn: "battle-round" }],
      ["friendly unit", "unit-filter", { side: "friendly" }], ["is destroyed", "event", { kind: "unit-destroyed" }]), listed);
    expectCompiled(result);
    // One die, fired by either listed moment: without the fold the moments trail the effect and fire nothing.
    expect(result.mechanics.effect).toMatchObject({ type: "resource-die" });
    expect(result.mechanics.trigger).toEqual([{ event: "round-started" }, { event: "destroyed", object: { owner: "friendly" } }]);
  });

  it("leaves a bullet whose moment comes first untouched", () => {
    const first = "Gains:\n■ At the start of your Command phase, you gain 1 Glim token.";
    const result = compileLeaves(placed(first,
      ["At the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }],
      ["you gain 1 Glim token", "resource-gain", { pool: "pain-token-pool", amount: 1 }]), first);
    expectCompiled(result);
    expect(JSON.stringify(result.mechanics)).toContain('"trigger":{"event":"phase-started"');
  });
});

describe("bullets the moment fold leaves alone", () => {
  it("keeps each option of a choice whole when a bullet's own selection and roll sit before its effect", () => {
    const text = "At the end of your opponent's Fight phase, you can do one of the following:\n■ Select one visible enemy unit within 18\" of this unit and roll four D6: for each 4+, that unit suffers 1 mortal wound.\n■ Add a new Glim Drone unit containing D3 models to your army and set it up within 6\" of this model. You cannot select this option more than once per turn.";
    const result = compileLeaves(placed(text,
      ["At the end of your opponent's Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "opponent" }],
      ["you can", "optional-use", { who: "you" }],
      ["do one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["visible enemy unit", "unit-filter", { side: "enemy", visible: true }],
      ["within 18\" of this unit", "unit-position", { kind: "within", subject: "selected-unit", negated: false, inches: 18, of: "this-unit" }],
      ["roll four D6", "dice-roll", { dice: "D6", count: 4 }],
      ["for each 4+", "roll-result", { from: 4 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "antecedent", count: "1" }],
      ["Add a new Glim Drone unit containing D3 models to your army", "add-unit", { source: "datasheet", count: "D3", datasheet: "glim-drones" }],
      ["set it up", "set-up", { subject: "antecedent", to: "battlefield" }],
      ["within 6\" of this model", "unit-position", { kind: "within", subject: "antecedent", negated: false, inches: 6, of: "this-model" }],
      ["You cannot select this option more than once per turn", "usage-limit", { frequency: "once-per-turn", per: "army" }]), text);
    expectCompiled(result);
    // The selection and roll are not moments: folding them would split the first option and fire the choice nowhere.
    expect(result.mechanics.trigger).toMatchObject({ event: "phase-ended", optional: true });
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect).toMatchObject({ type: "choice", min_choices: 1, max_choices: 1 });
    expect(effect.options).toHaveLength(2);
    expect(effect.options[0]).toMatchObject({ type: "select-units", effect: { type: "mortal-wounds", target: "selected-unit", modifier: { count: 1, per: "success", roll: { dice: 4, threshold: 4 } } } });
    expect(effect.options[1]).toMatchObject({ type: "ability-part", effect: { type: "add-unit", modifier: { datasheet: "glim-drones", count: "D3" } }, usage: { frequency: "once-per-turn", per: "army" } });
  });

  it("keeps an effect printed before a colon at its own moment when the bullet after it starts with a new moment", () => {
    const text = "If your Army Faction is NECRONS, at the end of your Command phase, each friendly unit with this ability that is on the battlefield activates its Glim Rite:\n■ When a unit's Glim Rite activates, that unit heals D3 wounds.";
    const result = compileLeaves(placed(text,
      ["If your Army Faction is NECRONS", "army-faction", { faction: "necrons" }],
      ["at the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
      ["each", "for-each-unit-select", {}],
      ["friendly unit", "unit-filter", { side: "friendly" }],
      ["with this ability", "unit-has-ability", { subject: "antecedent", own: true }],
      ["that is on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "antecedent", negated: false }],
      ["activates its Glim Rite", "ability-activate", { subject: "antecedent", ability: "example-rite" }],
      ["When a unit's Glim Rite activates", "event", { kind: "used", activity: "ability", id: "example-rite" }],
      ["that unit heals D3 wounds", "regain-wounds", { subject: "this-unit", amount: "D3" }]), text, { abilityId: "example-rite" });
    expectCompiled(result);
    // Two parts: the activation at the phase end, the heal when the rite is used. Folding would move the activation onto its own use.
    expect(result.mechanics.trigger).toBeNull();
    const steps = (result.mechanics.effect as Record<string, any>).effect.steps;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: "ability-part", trigger: { event: "phase-ended" }, effect: { type: "for-each-unit", selector: { filter: { owner: "friendly", has_ability: ["example-rite"] } } } });
    expect(JSON.stringify(steps[0].effect)).toContain('"type":"ability-activate"');
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "used", filter: { kind: "ability", id: "example-rite" } }, effect: { type: "heal", target: "this-unit", modifier: { amount: "D3" } } });
  });
});

describe("objectives held by a unit with this ability", () => {
  const text = "At the end of your Command phase, for each objective you control that has a friendly unit with this ability within range of it, roll one D6: on a 4+, you gain 1 Glim die with a value equal to that result.";
  const leaves = placed(text,
    ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
    ["for each objective you control", "select-objective-open", { bind_as: "held", each: true, controlled_by: "your-army" }],
    ["that has a friendly unit with this ability within range of it", "objective-criterion", { criterion: "occupied-by", side: "friendly", own_ability: true }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["on a 4+", "roll-result", { from: 4 }],
    ["you gain 1 Glim die with a value equal to that result", "resource-die", { pool: "miracle-dice-pool", operation: "add", value: "roll-result" }]);

  it("iterates every controlled marker a holder of this ability occupies, and keeps the gating roll's result", () => {
    const result = compileLeaves(leaves, text, { abilityId: "example-relic" });
    expectCompiled(result);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.selector).toEqual({ filter: { controlled_by: "friendly", occupied_by: { owner: "friendly", has_ability: ["example-relic"] } }, bind_as: "held" });
    expect(JSON.stringify(effect.effect)).toContain('"modifier":{"pool":"miracle-dice-pool","operation":"add","value":"roll-result"}');
    expect(describeEffect(effect)).toMatch(/for each objective marker you control, with one or more friendly units with the Example Relic ability within range of it/iu);
  });

  it("refuses this ability's holders when the record's ability is unknown", () => {
    expectRefused(compileLeaves(leaves, text));
  });
});

describe("a destroyed Stratagem target set back up at the end of the phase", () => {
  const text = "One HAEMONCULUS model from your army that was just destroyed. Spend 1-3 Glim tokens. At the end of the phase, set up the destroyed model on the battlefield. That model has a number of wounds remaining equal to the number of Glim tokens you just spent.";
  const leaves = placed(text,
    ["was just destroyed", "event", { kind: "model-destroyed" }, "TARGET"],
    ["Spend 1-3 Glim tokens", "resource-spend", { pool: "pain-token-pool", amount: { up_to: 3, at_least: 1 }, bind_as: "glim" }, "EFFECT"],
    ["At the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }, "EFFECT"],
    ["set up the destroyed model on the battlefield", "set-up", { subject: "this-model", to: "battlefield" }, "EFFECT"],
    ["That model has a number of wounds remaining equal to the number of Glim tokens you just spent", "wounds-remaining", { value: { spent: "glim" } }, "EFFECT"]);

  it("nests the phase end under the target's destruction and sets the spent amount as its wounds", () => {
    const result = compileLeaves(leaves, text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics);
    expect(json).toContain('"modifier":{"pool":"pain-token-pool","amount":{"up_to":3,"at_least":1}');
    expect(json).toContain('"wounds_remaining":{"spent":"glim"}');
    expect(json).toContain('"trigger":{"event":"phase-ended"}');
  });
});

describe("the describer", () => {
  it("says the range a spend allows and the unit a spend Empowers", () => {
    expect(describeEffect(leaf("resource-spend", { pool: "pain-token-pool", amount: { up_to: 3, at_least: 1 } }))).toBe("Spend 1-3 Pain tokens.");
    expect(describeEffect(leaf("resource-spend", { pool: "pain-token-pool", amount: { up_to: 2 } }))).toBe("Spend up to 2 Pain tokens.");
    expect(describeTrigger({ event: "resource-spent", filter: { pool: "pain-token-pool", tag: "empowered" }, object: { owner: "friendly" } })).toBe("each time you spend Pain tokens to Empower a friendly unit");
    expect(describeTrigger({ event: "resource-spent", filter: { pool: "pain-token-pool", tag: "empowered" } })).toBe("each time you spend Pain tokens to Empower a unit");
    expect(describeTrigger({ event: "resource-spent", filter: { pool: "pain-token-pool" } })).toBe("each time pain token pool is spent");
  });

  it("says a die keeps the gating roll's result, and a gain's cap", () => {
    expect(describeEffect(leaf("resource-die", { pool: "miracle-dice-pool", operation: "add", value: "roll-result" }))).toBe("Add a die showing that result to your Miracle dice.");
    expect(describeEffect(leaf("resource-gain-cap", { pool: "pain-token-pool", max: 3, source: "failed-battle-shock" }))).toBe("You cannot gain more than 3 Pain tokens from failed Battle-shock tests this ability causes.");
  });
});
