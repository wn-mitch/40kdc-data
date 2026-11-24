import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/effect.js";
import { expectCompiled, expectRefused, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// Named target groups, moment designations, history counts and per-option selections of the long-tail batch C.
// Wording is fabricated; the record names are only the designation ids the registry carries.

const compiled = (text: string, items: Item[], name?: string) => {
  const result = compileLeaves(placed(text, ...items), text, name ? { abilityId: "fabricated", name } : {});
  expectCompiled(result);
  return result;
};
const normalize = (family: string, parameters: Record<string, unknown>) =>
  normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
const render = (mechanics: Record<string, unknown>) => describeAbility({ ...mechanics, ability_id: "fabricated" } as Parameters<typeof describeAbility>[0]);

describe("named Stratagem target groups", () => {
  const text = "Start of the Fight phase.\nOne FOO model from your army, and one or more friendly BAR models affected by that model's Oath ability.\nSelect one enemy unit. Until the end of the phase, each time one of your BAR models makes an attack that targets that enemy unit, add 1 to the Hit roll.";
  const items: Item[] = [
    ["Start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }, "WHEN"],
    ["One", "stratagem-target", { count: "one", bind_as: "lead" }, "TARGET"],
    ["FOO model from your army", "unit-filter", { side: "friendly", keywords: ["FOO"], level: "model" }, "TARGET"],
    ["one or more", "stratagem-target", { count: "one-or-more", bind_as: "bondsmen" }, "TARGET"],
    ["friendly BAR models", "unit-filter", { side: "friendly", keywords: ["BAR"], level: "model" }, "TARGET"],
    ["affected by that model's Oath ability", "designated-filter", { subject: "this-unit", tag: "bondsman-affected", by: { bound: "lead" } }, "TARGET"],
    ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }, "EFFECT"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["your BAR models", "unit-filter", { side: "friendly", keywords: ["BAR"], level: "model", among: "stratagem-targets", targets: "one" }, "EFFECT"],
    ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }, "EFFECT"],
    ["that targets that enemy unit", "target-is-selected", {}, "EFFECT"],
    ["add 1 to the Hit roll", "roll-modifier", { operation: "add", value: 1, roll: "hit" }, "EFFECT"],
  ];

  it("names each group by its bind_as and ties the bondsmen to the lead's designation", () => {
    const result = compiled(text, items, "Virtue of Courage");
    const core = JSON.stringify(result.core);
    expect(core).toContain('"name":"lead"');
    expect(core).toContain('"designated_by":{"stratagem_target":"lead"}');
    const effect = JSON.stringify(result.mechanics.effect);
    expect(effect).toContain('"attacker":{"stratagem_target":"bondsmen"}');
  });

  it("refuses a bind_as on exactly-N targets and a malformed group name", () => {
    expect(() => normalize("stratagem-target", { count: "exactly", count_exact: 2, bind_as: "pair" })).toThrow();
    expect(() => normalize("stratagem-target", { count: "one", bind_as: "Lead" })).toThrow();
    expect(() => normalize("triggering-target", { selects: "model", keywords: ["FOO"], match: "all", bind_as: "lead target" })).toThrow();
  });

  it("names a counts-as range's other unit by its group and limits it to named abilities", () => {
    expect(normalize("counts-as", { subject: "antecedent", within: 12, of: { bound: "psyker" }, for_abilities: ["fixture-guidance", "fixture-guides"] }))
      .toEqual({ subject: "antecedent", within: 12, of: { bound: "psyker" }, for_abilities: ["fixture-guidance", "fixture-guides"] });
    expect(() => normalize("counts-as", { subject: "antecedent", within: 12, for_abilities: ["fixture-guidance", "fixture-guidance"] })).toThrow();
  });
});

describe("a designation's attackers named as several Stratagem targets", () => {
  const effect = {
    type: "designate-target", designation: "virtue-of-courage-target",
    select: { kind: "unit", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 } } },
    applies: { to: "attackers-of-target", attacker: [{ stratagem_target: "lead" }, { stratagem_target: "bondsmen" }], attacker_filter: { all_of: ["BAR"], level: "model" }, effect: { type: "roll-modifier", target: { stratagem_target: "bondsmen" }, modifier: { roll: "hit", operation: "add", value: 1 } } },
  };
  const source = { kind: "ability" as const, abilityId: "fabricated", abilityKind: "detachment-stratagem" as const };

  it("renders the attackers as the named targets' filtered models", () => {
    expect(render({ effect })).toContain("ach time a BAR model in the lead target or the bondsmen target makes an attack against it");
  });

  it("skips the lever when the crunched unit is neither target, and keeps it when it is one", () => {
    const neither = effectToBuffs(effect, source, { phase: "shooting", stratagemTargets: { lead: false, bondsmen: false }, attackerKeywords: ["bar"] });
    expect(neither.activatable).toEqual([]);
    expect(neither.unsupported).toEqual([]);
    const bondsman = effectToBuffs(effect, source, { phase: "shooting", stratagemTargets: { lead: false, bondsmen: true }, attackerKeywords: ["bar"], attackerModelKeywords: ["bar"] });
    expect(bondsman.unsupported).toEqual([]);
    expect(bondsman.activatable.length).toBeGreaterThan(0);
  });
});

describe("the moment's unit designated with no choice", () => {
  const text = "Your opponent's Shooting phase, just after an enemy unit has shot.\nOne FOO unit from your army that was destroyed by that enemy unit this phase. You can use this Stratagem on that unit even though it was just destroyed.\nUntil the end of the battle, each time a BAR model from your army makes an attack that targets that enemy unit, add 1 to the Hit roll.";
  const items = (gate: Record<string, unknown>): Item[] => [
    ["Your opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN"],
    ["just after an enemy unit has shot", "event", { kind: "attacks-resolved", owner: "enemy" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["FOO unit", "unit-filter", { side: "friendly", keywords: ["FOO"] }, "TARGET"],
    ["was destroyed by that enemy unit this phase", "unit-activity", { activities: ["destroyed-by-event-subject-this-phase"], subject: "this-unit", negated: false }, "TARGET"],
    ["You can use this Stratagem on that unit even though it was just destroyed", "eligibility-permission", { subject: "this-unit", activity: "use-stratagem", allow: true, despite: ["destroyed"] }, "TARGET"],
    ["Until the end of the battle", "duration", { endpoint: "end-of-battle" }, "EFFECT"],
    ["BAR model", "unit-filter", { side: "friendly", keywords: ["BAR"], level: "model" }, "EFFECT"],
    ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }, "EFFECT"],
    ["that targets that enemy unit", "target-is-selected", gate, "EFFECT"],
    ["add 1 to the Hit roll", "roll-modifier", { operation: "add", value: 1, roll: "hit" }, "EFFECT"],
  ];

  it("designates the triggering unit for the rest of the battle, with the destroyed-target permission outside it", () => {
    const { mechanics } = compiled(text, items({ unit: "event-subject" }), "Avenge the Star Children");
    const effect = mechanics.effect as { type: string; steps: Array<Record<string, unknown>> };
    expect(effect.type).toBe("sequence");
    expect(effect.steps[0]!.type).toBe("permission");
    expect(effect.steps[1]).toMatchObject({ type: "designate-target", select: { kind: "unit", from: "event-subject" }, duration: "battle" });
    expect(render(mechanics)).toContain("Select the triggering unit (your Avenge the Star Children Target)");
  });

  it("refuses an attack on \"that unit\" with no selection when the gate does not name the moment's unit", () => {
    expectRefused(compileLeaves(placed(text, ...items({})), text, { abilityId: "fabricated", name: "Avenge the Star Children" }));
  });

  it("takes the moment's unit on target-is-selected alone", () => {
    expect(() => normalize("target-is-selected", { unit: "event-subject", by: "this-unit", target: "antecedent" })).toThrow();
    expect(() => normalize("target-is-selected", { unit: "this-unit" })).toThrow();
  });
});

describe("mortal wounds this phase: who suffered them, who inflicted them, and dice counted from them", () => {
  const text = "End of any phase.\nOne FOO unit from your army that suffered one or more mortal wounds this phase.\nSelect one enemy unit which inflicted one or more mortal wounds on your unit this phase, then roll a number of dice equal to the number of mortal wounds your unit suffered this phase: for each 2+, that enemy unit suffers one mortal wound (to a maximum of 6 mortal wounds). These mortal wounds are Psychic Attacks.";
  const items: Item[] = [
    ["End of any phase", "event", { kind: "phase-end", phase: "any", turn: "either" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["FOO unit", "unit-filter", { side: "friendly", keywords: ["FOO"] }, "TARGET"],
    ["suffered one or more mortal wounds this phase", "unit-activity", { activities: ["suffered-mortal-wounds-this-phase"], subject: "antecedent", negated: false }, "TARGET"],
    ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }, "EFFECT"],
    ["which inflicted one or more mortal wounds on your unit this phase", "unit-activity", { activities: ["inflicted-mortal-wounds-on-stratagem-target-this-phase"], subject: "selected-unit", negated: false }, "EFFECT"],
    ["roll a number of dice equal to the number of mortal wounds your unit suffered this phase", "dice-roll", { dice: "D6", count_history: { of: "mortal-wounds-suffered", subject: "this-unit", window: "phase" } }, "EFFECT"],
    ["for each 2+", "roll-result", { from: 2 }, "EFFECT"],
    ["that enemy unit suffers one mortal wound (to a maximum of 6 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "1", max: 6 }, "EFFECT"],
    ["These mortal wounds are Psychic Attacks", "mortal-wound-source", { psychic: true }, "EFFECT"],
  ];

  it("checks the selection against the mortal wounds it inflicted and rolls the dice those wounds count", () => {
    const { mechanics, core } = compiled(text, items);
    const effect = JSON.stringify(mechanics.effect);
    expect(effect).toContain('"eligibility":{"type":"happened","parameters":{"event":"damage-allocated","object":"stratagem-target","filter":{"attack_type":"mortal","by":"selected-unit"},"window":"phase"}}');
    expect(effect).toContain('"count_history":{"of":"mortal-wounds-suffered","subject":"this-unit","window":"phase"}');
    expect(effect).toContain('"max":6,"psychic":true');
    expect(JSON.stringify(core)).toContain('{"event":"damage-allocated","object":"this-unit","filter":{"attack_type":"mortal"},"window":"phase"}');
    const english = render(mechanics);
    expect(english).toContain("Select one enemy unit that inflicted one or more mortal wounds on the Stratagem's target this phase");
    expect(english).toContain("Roll a number of D6 equal to the number of mortal wounds this unit suffered this phase");
  });

  it("refuses the Stratagem's own unit as the source of the mortal wounds it suffered, and a count beside count_history", () => {
    expect(() => normalize("unit-activity", { activities: ["inflicted-mortal-wounds-on-stratagem-target-this-phase"], subject: "this-unit", negated: false })).toThrow();
    expect(() => normalize("dice-roll", { dice: "D6", count: 3, count_history: { of: "mortal-wounds-suffered", subject: "this-unit", window: "phase" } })).toThrow();
  });
});

describe("an Advance with no roll that does not stack with a named ability", () => {
  const text = "Start of your Movement phase.\nUp to two FOO units from your army, or one other BAR unit from your army.\nUntil the end of the phase, each time one of those units Advances, do not make an Advance roll for it. Instead, add 6\" to the Move characteristic of models in that unit (this is not cumulative with the Fixture Swiftness ability).";
  const items: Item[] = [
    ["Start of your Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "your" }, "WHEN"],
    ["Up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"],
    ["FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["other BAR unit", "unit-filter", { side: "friendly", keywords: ["BAR"], excluded_keywords: ["FOO"] }, "TARGET"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["one of those units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "any" }, "EFFECT"],
    ["Advances", "event", { kind: "move-started", move_types: ["advance"] }, "EFFECT"],
    ["do not make an Advance roll for it", "no-advance-roll", { subject: "event-subject" }, "EFFECT"],
    ["Instead", "instead", {}, "EFFECT"],
    ["add 6\" to the Move characteristic of models in that unit (this is not cumulative with the Fixture Swiftness ability)", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 6, weapon_type: "all", not_cumulative: { ability: "fixture-swiftness" } }, "EFFECT"],
  ];

  it("fires for each target in its mode and keeps the limit on the no-roll Advance", () => {
    const { mechanics } = compiled(text, items);
    const effect = JSON.stringify(mechanics.effect);
    expect(effect).toContain('"subject":{"stratagem_target":"first"}');
    expect(effect).toContain('"subject":{"stratagem_target":"second"}');
    expect(effect).toContain('"modifier":{"advance":"fixed-6","not_cumulative":{"ability":"fixture-swiftness"}}');
    expect(render(mechanics)).toContain("add 6\" to its Move characteristic instead (this is not cumulative with the Fixture Swiftness ability)");
  });
});

describe("the Transport a disembarked moment's unit left", () => {
  const text = "Your Movement phase, just after a FOO unit from your army disembarks from a TRANSPORT that made a Normal move this phase.\nThat FOO unit.\nUntil the end of the turn, your unit is eligible to declare a charge.";
  const items: Item[] = [
    ["Your Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"],
    ["FOO unit", "unit-filter", { side: "friendly", keywords: ["FOO"] }, "WHEN"],
    ["disembarks from a TRANSPORT", "event", { kind: "disembarked" }, "WHEN"],
    ["that made a Normal move this phase", "unit-activity", { activities: ["made-normal-move-this-phase"], subject: "disembarked-from", negated: false }, "WHEN"],
    ["That FOO unit", "triggering-target", { selects: "unit", keywords: ["FOO"], match: "all" }, "TARGET"],
    ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"],
    ["your unit is eligible to declare a charge", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: true }, "EFFECT"],
  ];

  it("reads the Transport as the moment's object and names it as the Transport", () => {
    const { mechanics } = compiled(text, items);
    expect(JSON.stringify(mechanics)).toContain('"subject":"event-object","event":"move-ended","filter":{"move_types":["normal"]},"window":"phase"');
    expect(render(mechanics)).toContain("if the Transport made a Normal move this phase");
  });
});

describe("an \"Or:\" whose options each select a unit, one of them destroyed", () => {
  const text = "At the start of your Movement phase, you can use this ability. If you do: Select one friendly unengaged FOO unit. That unit heals 2D6 wounds. Or: Select one friendly destroyed FOO unit. That unit heals 10 wounds and is placed in strategic reserves.";
  const items: Item[] = [
    ["At the start of your Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "your" }],
    ["you can use this ability", "optional-use", { who: "you" }],
    ["Select one", "select-unit", { distance: "any", visible: false }],
    ["friendly unengaged FOO unit", "unit-filter", { side: "friendly", keywords: ["FOO"], states: ["unengaged"] }],
    ["That unit heals 2D6 wounds", "regain-wounds", { subject: "antecedent", amount: "2D6" }],
    ["Or", "instead", { choice: true }],
    ["Select one", "select-unit", { distance: "any", visible: false }],
    ["friendly destroyed FOO unit", "unit-filter", { side: "friendly", keywords: ["FOO"], states: ["destroyed"] }],
    ["That unit heals 10 wounds and is placed in strategic reserves", "revive-into-reserves", { subject: "antecedent", heal: 10 }],
  ];

  it("wraps each option in its own selection and returns the destroyed unit to Reserves", () => {
    const { mechanics } = compiled(text, items);
    const effect = mechanics.effect as { type: string; options: Array<{ type: string; selector: { filter: Record<string, unknown> } }> };
    expect(effect.type).toBe("choice");
    expect(effect.options.map((option) => option.type)).toEqual(["select-units", "select-units"]);
    expect(effect.options[0]!.selector.filter.not_states).toEqual(["engaged"]);
    expect(effect.options[1]!.selector.filter.state).toBe("destroyed");
    expect(JSON.stringify(effect.options[1])).toContain('{"type":"set-up","target":"selected-unit","modifier":{"to":"strategic-reserves","from":"destroyed"}}');
    expect(render(mechanics)).toContain("that unit is returned to the battle and placed into Strategic Reserves");
  });

  it("refuses two selections with no \"Or:\" between them", () => {
    const joined = text.replace(" Or:", " Then");
    const without = items.filter((item) => item[1] !== "instead");
    expectRefused(compileLeaves(placed(joined, ...without), joined));
  });

  it("takes a whole number of healed wounds on the revived unit", () => {
    expect(() => normalize("revive-into-reserves", { subject: "antecedent", heal: 0 })).toThrow();
    expect(() => normalize("revive-into-reserves", { subject: "this-unit", heal: 10 })).toThrow();
  });
});
