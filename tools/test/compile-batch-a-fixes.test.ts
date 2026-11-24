import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { describeAbility } from "../src/translate/effect.js";
import { expectCompiled, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// A Stratagem's anaphors bound to the moment's unit rather than its target. Wording is fabricated.

const when: Item[] = [
  ["Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN"],
  ["just after an enemy unit has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
  ["One", "stratagem-target", { count: "one" }, "TARGET"],
  ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "TARGET"],
  ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
];
const head = "Shooting phase, just after an enemy unit has selected its targets.\nOne FIXTURE unit from your army.\n";
const compiled = (text: string, items: Item[]) => {
  const result = compileLeaves(placed(text, ...items), text);
  expectCompiled(result);
  return result.mechanics;
};

describe("a destroyed model's own history", () => {
  const text = `${head}Until the end of the phase, each time a model in your unit is destroyed, if that model has not shot or fought this phase, roll one D6. On a 4+, you gain 1 Pain token.`;
  const items: Item[] = [
    ...when,
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["each time a model in your unit is destroyed", "event", { kind: "model-destroyed" }, "EFFECT"],
    ["that model has not shot or fought this phase", "unit-activity", { activities: ["fought-this-phase", "selected-to-shoot-this-phase"], subject: "antecedent", negated: true }, "EFFECT"],
    ["roll one D6", "dice-roll", { dice: "D6" }, "EFFECT"],
    ["On a 4+", "roll-result", { from: 4 }, "EFFECT"],
    ["you gain 1 Pain token", "resource-gain", { pool: "pain-token-pool", amount: 1 }, "EFFECT"],
  ];

  it("checks \"that model\" on the destroyed model, not the Stratagem's target", () => {
    const mechanics = compiled(text, items);
    const json = JSON.stringify(mechanics.effect);
    expect(json.match(/"subject":"event-object","event":"selected"/gu)?.length).toBe(2);
    expect(describeAbility(mechanics as never)).toContain("unless that model has fought this phase or that model has been selected to shoot this phase");
  });

  it("keeps \"your unit\" after the same moment on the Stratagem's target", () => {
    const unitText = text.replace("if that model has not shot", "if your unit has not shot");
    const unitItems = items.map((item): Item => item[0] === "that model has not shot or fought this phase"
      ? ["your unit has not shot or fought this phase", "unit-activity", { activities: ["fought-this-phase", "selected-to-shoot-this-phase"], subject: "antecedent", negated: true }, "EFFECT"] : item);
    const json = JSON.stringify(compiled(unitText, unitItems).effect);
    expect(json).not.toContain('"subject":"event-object"');
  });
});

describe("the attacking unit of the Stratagem's moment", () => {
  const text = `${head}Until the end of the phase, your unit has a 4+ invulnerable save and, after the attacking unit has resolved its attacks, unless your unit is within Engagement Range of one or more enemy units, it can make a Normal move of up to 6".`;
  const items = (moment: string): Item[] => [
    ...when,
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["your unit has a 4+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 4 }, "EFFECT"],
    [moment, "event", { kind: "attacks-resolved", owner: "enemy" }, "EFFECT"],
    ["unless your unit is within Engagement Range of one or more enemy units", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }, "EFFECT"],
    ["it can make a Normal move of up to 6", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }, "EFFECT"],
  ];

  it("binds \"the attacking unit\" to the enemy unit whose target selection is the moment", () => {
    const json = JSON.stringify(compiled(text, items("after the attacking unit has resolved its attacks")).effect);
    expect(json).toContain('"binds_event_variable":"moment-subject"');
    expect(json).toContain('"trigger":{"event":"attacks-resolved","subject":{"event_var":"moment-subject"}}');
    expect(json).not.toContain('"event":"attacks-resolved","subject":{"owner":"enemy"}');
  });

  it("leaves \"an enemy unit\" resolving its attacks as any enemy unit", () => {
    const anyText = text.replace("after the attacking unit has resolved", "after an enemy unit has resolved");
    const json = JSON.stringify(compiled(anyText, items("after an enemy unit has resolved its attacks")).effect);
    expect(json).toContain('"event":"attacks-resolved","subject":{"owner":"enemy"}');
    expect(json).not.toContain("moment-subject");
  });
});

describe("the describer", () => {
  it("names a destroyed model of this unit as that model", () => {
    const text = describeAbility({ effect: { type: "ability-part", trigger: { event: "model-destroyed", object: "model-in-this-unit" },
      effect: { type: "conditional", condition: { operator: "not", operands: [{ type: "happened", parameters: { subject: "event-object", event: "selected", filter: { to: "fight" }, window: "phase" } }] },
        effect: { type: "cp-gain", target: "this-model", modifier: { amount: 1 } } } }, scope: { duration: "phase" } } as never);
    expect(text).toContain("unless that model has fought this phase");
  });

  it("keeps the triggering unit for a moment of this model", () => {
    const text = describeAbility({ trigger: { event: "set-up", subject: "this-model" },
      effect: { type: "conditional", condition: { type: "happened", parameters: { subject: "event-subject", event: "set-up", window: "phase" } },
        effect: { type: "cp-gain", target: "this-model", modifier: { amount: 1 } } }, scope: { duration: "phase" } } as never);
    expect(text).not.toContain("triggering model");
  });
});
