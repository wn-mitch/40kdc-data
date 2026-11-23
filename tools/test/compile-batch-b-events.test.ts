import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/effect.js";
import { expectCompiled, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// Destruction, history and moment shapes of the long-tail events batch. Wording is fabricated.

const compiled = (text: string, items: Item[]) => {
  const result = compileLeaves(placed(text, ...items), text);
  expectCompiled(result);
  return result.mechanics as Record<string, unknown>;
};
const normalize = (family: string, parameters: Record<string, unknown>) =>
  normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

describe("event parameters", () => {
  it("takes the last model of a keyword, and refuses a last with no keyword", () => {
    expect(normalize("event", { kind: "model-destroyed", object_keywords: ["FIXTURE"], last: true })).toEqual({ kind: "model-destroyed", object_keywords: ["FIXTURE"], last: true });
    expect(() => normalize("event", { kind: "model-destroyed", last: true })).toThrow();
    expect(() => normalize("event", { kind: "model-destroyed", object_keywords: ["FIXTURE"], last: false })).toThrow();
  });

  it("takes an any-of destroyed filter of two or more keywords with its owner", () => {
    expect(() => normalize("event", { kind: "unit-destroyed", object_owner: "friendly", object_any_keywords: ["FIXTURE"] })).toThrow();
    expect(() => normalize("event", { kind: "unit-destroyed", object_any_keywords: ["FIXTURE", "OTHER"] })).toThrow();
  });

  it("keeps each timing to its own moment", () => {
    expect(() => normalize("event", { kind: "move-ended", timing: "before-deadly-demise" })).toThrow();
    expect(() => normalize("event", { kind: "unit-destroyed", timing: "before-marker-removal" })).toThrow();
  });
});

describe("a destroyed unit of either keyword, then that enemy unit's attacks", () => {
  const text = "Fight phase, just after an enemy unit destroys a FOO or BAR unit from your army.\nOne BAZ unit from your army.\nAfter that enemy unit has finished making its attacks, your unit can shoot as if it were your Shooting phase.";
  const items: Item[] = [
    ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
    ["enemy unit", "unit-filter", { side: "enemy" }, "WHEN"],
    ["destroys a FOO or BAR unit from your army", "event", { kind: "unit-destroyed", by: "antecedent", object_owner: "friendly", object_any_keywords: ["FOO", "BAR"] }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["BAZ unit", "unit-filter", { side: "friendly", keywords: ["BAZ"] }, "TARGET"],
    ["After that enemy unit has finished making its attacks", "event", { kind: "attacks-resolved", owner: "enemy" }, "EFFECT"],
    ["your unit can shoot as if it were your Shooting phase", "eligibility-permission", { subject: "this-unit", activity: "shoot", allow: true, as_if: "shooting-phase" }, "EFFECT"],
  ];

  it("names either keyword on the destroyed unit and binds the later moment to its destroyer", () => {
    const mechanics = compiled(text, items);
    const json = JSON.stringify(mechanics);
    expect(json).toContain('"object":{"owner":"friendly","any_of":["BAR","FOO"]}');
    expect(json).toContain('"binds_event_variable":"moment-subject"');
    expect(json).toContain('"trigger":{"event":"attacks-resolved","subject":{"event_var":"moment-subject"}}');
  });

  it("leaves \"an enemy unit\" finishing its attacks as any enemy unit", () => {
    const anyText = text.replace("After that enemy unit has", "After an enemy unit has");
    const anyItems = items.map((item): Item => item[1] === "event" && item[3] === "EFFECT" ? ["After an enemy unit has finished making its attacks", item[1], item[2], item[3]] : item);
    const json = JSON.stringify(compiled(anyText, anyItems));
    expect(json).not.toContain("moment-subject");
  });
});

describe("a destroyed model and the attacking unit after its attacks", () => {
  const head = "Fight phase, just after an enemy unit has selected its targets.\nOne FIXTURE unit from your army.\n";
  const when: Item[] = [
    ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
    ["just after an enemy unit has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "TARGET"],
  ];

  it("holds the mortal wound for the end of the destroyer's attacks", () => {
    const text = `${head}Each time a model in your unit is destroyed, roll one D6: on a 6, the attacking unit suffers 1 mortal wound after all of its attacks have been resolved.`;
    const mechanics = compiled(text, [
      ...when,
      ["Each time a model in your unit is destroyed", "event", { kind: "model-destroyed" }, "EFFECT"],
      ["roll one D6", "dice-roll", { dice: "D6" }, "EFFECT"],
      ["on a 6", "roll-result", { from: 6, to: 6 }, "EFFECT"],
      ["the attacking unit suffers 1 mortal wound", "mortal-wounds", { recipient: "event-subject", count: "1" }, "EFFECT"],
      ["after all of its attacks have been resolved", "event", { kind: "attacks-resolved", subject: "antecedent" }, "EFFECT"],
    ]);
    const json = JSON.stringify(mechanics.effect);
    expect(json).toContain('"on_success":{"type":"ability-part","trigger":{"event":"attacks-resolved","subject":"attacker"}');
  });

  it("reads \"its unit\" after a destroyed enemy model as that model's unit", () => {
    const text = "Your Shooting phase.\nOne FIXTURE unit from your army.\nEach time an enemy model is destroyed while its unit is within Engagement Range of your unit, roll one D6: on a 5+, your unit suffers 1 mortal wound.";
    const mechanics = compiled(text, [
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "TARGET"],
      ["enemy model", "unit-filter", { side: "enemy", level: "model" }, "EFFECT"],
      ["is destroyed", "event", { kind: "model-destroyed" }, "EFFECT"],
      ["while its unit is within Engagement Range of your unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "this-unit" }, "EFFECT"],
      ["roll one D6", "dice-roll", { dice: "D6" }, "EFFECT"],
      ["on a 5+", "roll-result", { from: 5 }, "EFFECT"],
      ["your unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }, "EFFECT"],
    ]);
    expect(JSON.stringify(mechanics.effect)).toContain('"subject":"event-object","filter":{"engaged_with":"this-unit"}');
  });
});

describe("a roll's weapon in the first of two parts", () => {
  const text = "While this model is leading a unit, each time you roll to determine the number of attacks made with a fixture gun, you can re-roll the result, and each time you make a Damage roll for a model equipped with a fixture lance, you can re-roll the result.";
  const items: Item[] = [
    ["While this model is leading a", "leading-unit", { subject: "this-model", attachment: "leading" }],
    ["each time you roll to determine the number of attacks", "event", { kind: "before-roll", roll: "attacks" }],
    ["made with a fixture gun", "attack-filter", { weapon_name: "fixture gun" }],
    ["you can", "optional-use", { who: "you" }],
    ["re-roll the result", "reroll", { roll: "attacks", subset: "all", weapon_type: "all" }],
    ["each time you make a Damage roll for a model", "event", { kind: "before-roll", roll: "damage" }],
    ["equipped with a fixture lance", "attack-filter", { weapon_name: "fixture lance" }],
    ["you can", "optional-use", { who: "you" }],
    ["re-roll the result", "reroll", { roll: "damage", subset: "all", weapon_type: "all" }],
  ];

  it("names the first part's weapon on its own moment, not on both parts", () => {
    const mechanics = compiled(text, items);
    const json = JSON.stringify(mechanics.effect);
    expect(json).toContain('"trigger":{"event":"before-roll","filter":{"roll":"attacks","weapons":{"name":"fixture gun"}}');
    expect(json.match(/fixture gun/gu)?.length).toBe(1);
    expect(describeAbility(mechanics as never)).toContain("Before a roll to determine the number of attacks is made with fixture gun weapons");
  });
});

describe("history and state moments", () => {
  it("reads a designation as it was at the start of the phase", () => {
    const text = "Your Shooting phase, just after a FIXTURE unit from your army destroys an enemy unit.\nOne FIXTURE unit from your army.\nIf that enemy unit was unravelling at the start of the phase, your unit's Reanimation Protocols activate.";
    const mechanics = compiled(text, [
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "WHEN"],
      ["destroys an", "event", { kind: "unit-destroyed", by: "antecedent", object_owner: "enemy" }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "TARGET"],
      ["If that enemy unit was unravelling at the start of the phase", "designated-filter", { subject: "event-object", tag: "unravelling", at: "phase-start" }, "EFFECT"],
      ["your unit's Reanimation Protocols activate", "ability-activate", { subject: "this-unit", ability: "reanimation-protocols-necrons" }, "EFFECT"],
    ]);
    expect(JSON.stringify(mechanics.effect)).toContain('"condition":{"type":"designated","parameters":{"subject":"event-object","tag":"unravelling","at":"phase-start"}}');
    expect(describeAbility(mechanics as never)).toContain("that unit was unravelling at the start of the phase");
  });

  it("names the unit that caused another to become Below Half-strength", () => {
    const text = "Fight phase.\nOne FIXTURE unit from your army that just caused an enemy unit to become Below Half-strength.\nYour unit's Reanimation Protocols activate.";
    const mechanics = compiled(text, [
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "TARGET"],
      ["just caused an enemy unit to become Below Half-strength", "event", { kind: "state-changed", strength: "below-half", owner: "enemy", by: "this-unit" }, "TARGET"],
      ["Your unit's Reanimation Protocols activate", "ability-activate", { subject: "this-unit", ability: "reanimation-protocols-necrons" }, "EFFECT"],
    ]);
    expect(mechanics.trigger).toEqual({ event: "state-changed", filter: { strength: "below-half", by: "this-unit" }, subject: { owner: "enemy" } });
    expect(describeAbility(mechanics as never)).toContain("When this unit causes an enemy unit to become Below Half-strength");
  });

  it("gates a model's fight-on-death on a result above the battle round", () => {
    const text = "Each time a model in this unit is destroyed, roll one D6. If the result is greater than the current battle round number, do not remove it; it can fight after the attacking unit has finished making its attacks, and is then removed.";
    const mechanics = compiled(text, [
      ["Each time a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["the result is greater than the current battle round number", "roll-result", { from: { battle_round_plus: 1 } }],
      ["do not remove it; it can fight after the attacking unit has finished making its attacks, and is then removed", "fight-on-death", { act: "fight", timing: "after-the-attacking-unit-finishes" }],
    ]);
    expect(JSON.stringify(mechanics.effect)).toContain('"threshold":{"battle_round_plus":1}');
    expect(describeAbility(mechanics as never)).toContain("On a result greater than the current battle round number");
  });
});

describe("batch B fixes", () => {
  it("relocates a marker anywhere on the battlefield away from enemy units, and refuses the limit on a remove", () => {
    const text = "You can set up that Fixture marker anywhere on the battlefield that is more than 8\" horizontally away from all enemy units.";
    const mechanics = compiled(text, [
      ["You can", "optional-use", { who: "you" }],
      ["set up that Fixture marker anywhere on the battlefield that is more than 8\" horizontally away from all enemy units", "battlefield-marker", { subject: "this-unit", label: "fixture-marker", operation: "relocate", min_enemy_distance: 8 }],
    ]);
    expect(JSON.stringify(mechanics.effect)).toContain('"operation":"relocate","min_enemy_distance":{"inches":8}');
    expect(describeAbility(mechanics as never)).toContain("You can move the fixture marker anywhere on the battlefield more than 8\" horizontally away from all enemy units");
    expect(() => normalize("battlefield-marker", { subject: "this-unit", label: "fixture-marker", operation: "remove", min_enemy_distance: 8 })).toThrow();
  });

  it("names a bound unit's attacks in either phase, and keeps a fight's own verb", () => {
    const bound = (filter?: Record<string, unknown>) => describeAbility({ trigger: { event: "targets-selected", filter: { kind: "attack" }, subject: { owner: "enemy" }, object: "this-unit", binds_event_variable: "moment-subject" },
      effect: { type: "ability-part", trigger: { event: "attacks-resolved", subject: { event_var: "moment-subject" }, ...(filter ? { filter } : {}) }, effect: { type: "cp-gain", target: "this-unit", modifier: { amount: 1 } } },
      scope: { duration: "phase" } } as never);
    expect(bound()).toContain("After that unit has finished making its attacks");
    expect(bound({ kind: "fight" })).toContain("After that unit fights");
  });
});
