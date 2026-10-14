import { describe, it, expect } from "vitest";

import { describeAbility, describeCondition, type Effect } from "../src/translate/index.js";
import { describeTrigger } from "../src/translate/trigger.js";

/**
 * Describer pins for the permission-axis leaves that replaced the 1.0.14 shapes
 * (`ignore-modifiers`, Stratagem `cost-modifier`, `targeting`), plus the English
 * defects the round-6 corpus sweep found in the leaf renders. The data-exercised
 * branches are also pinned cross-language by `conformance/effect-translation`;
 * these lock the branches no current record uses so they cannot rot.
 */
function render(effect: Effect, scope: Record<string, unknown> = { duration: "permanent" }): string {
  return describeAbility({ effect, scope } as Parameters<typeof describeAbility>[0]);
}

describe("rule and turn-start vocabulary", () => {
  it("distinguishes the player's turn from the opponent's turn and the battle round", () => {
    const turn = (t: string) => ({ type: "player-turn-is", parameters: { turn: t } });
    expect(describeTrigger({ event: "turn-started", condition: turn("your-turn") })).toBe("at the start of your turn");
    expect(describeTrigger({ event: "turn-started", condition: turn("opponent-turn") })).toBe(
      "at the start of your opponent's turn",
    );
    expect(describeTrigger({ event: "round-started" })).toBe("at the start of the battle round");
  });

  it("tests whether a rule is active rather than a unit keyword, including negation", () => {
    const condition = { type: "rule-active", parameters: { rule: "acts-of-faith-adepta-sororitas" } };
    expect(describeCondition(condition)).toBe("the Acts of Faith is active");
    expect(describeCondition({ operator: "not", operands: [condition] })).toBe("the Acts of Faith is not active");
    expect(describeCondition({
      type: "rule-active",
      parameters: { rule: "oath-of-moment" },
    })).toBe("the Oath of Moment is active");
    expect(render({ type: "conditional", condition, effect: { type: "no-effect" } })).toContain(
      "While the Acts of Faith is active",
    );
  });
});

describe("ignore-modifiers", () => {
  it("ignores modifiers to characteristics", () => {
    expect(render({ type: "ignore-modifiers", target: "this-unit", modifier: { what: "characteristics" } })).toBe(
      "The unit ignores any modifiers to its characteristics.",
    );
  });

  it("names the listed characteristics instead of all of them", () => {
    expect(
      render({ type: "ignore-modifiers", target: "this-model", modifier: { what: "characteristics", stats: ["BS", "WS"] } }),
    ).toBe("This model ignores any modifiers to its Ballistic Skill and Weapon Skill characteristics.");
  });

  it("keeps the worsening-only restriction on rolls", () => {
    expect(
      render({ type: "ignore-modifiers", target: "this-unit", modifier: { what: "rolls", rolls: ["hit", "wound"], only: "worsening" } }),
    ).toBe("The unit ignores any negative modifiers to its Hit and Wound rolls.");
  });
});

describe("cost-modifier (Stratagems)", () => {
  it("taxes Stratagems that target units within an aura (increase)", () => {
    expect(
      render({
        type: "cost-modifier",
        target: { owner: "enemy", within: { range: { inches: 12 } } },
        modifier: { of: "stratagem", operation: "increase", amount: 1, applies_to: "targeting-this-unit" },
      }),
    ).toBe('Stratagems that target enemy units within 12" cost 1CP more.');
  });

  it("sets a named Stratagem used by the unit to a fixed cost (set)", () => {
    expect(
      render({
        type: "cost-modifier",
        target: "this-unit",
        modifier: { of: "stratagem", id: "command-re-roll", operation: "set", amount: 0, applies_to: "used-by-this-unit" },
      }),
    ).toBe("The Command Re Roll Stratagem used by the unit costs 0CP.");
  });
});

describe("targeting", () => {
  it("ranged, attacker within range (Lone Operative family)", () => {
    expect(
      render({
        type: "targeting",
        target: { owner: "enemy" },
        modifier: { may: "cannot-target", target: "this-model", kind: "shoot", range: { inches: 12 }, weapon_type: "ranged" },
      }),
    ).toBe('Enemy units cannot target this model with ranged weapons unless the attacking unit is within 12".');
  });

  it("any attack, attacker within range", () => {
    expect(
      render({ type: "targeting", target: { owner: "enemy" }, modifier: { may: "cannot-target", target: "this-unit", range: { inches: 18 } } }),
    ).toBe('Enemy units cannot target the unit unless the attacking unit is within 18".');
  });

  it("a model-level attacker filter reads 'the attacking model', with plural agreement", () => {
    // Pins the "enemy models is within" agreement bug: the gate's subject follows the filter's level.
    expect(
      render({
        type: "targeting",
        target: { owner: "enemy", level: "model" },
        modifier: { may: "cannot-target", target: "this-unit", kind: "shoot", range: { inches: 18 } },
      }),
    ).toBe('Enemy models cannot target the unit with ranged attacks unless the attacking model is within 18".');
  });

  it("forbids enemy Stratagems targeting the unit", () => {
    expect(
      render({ type: "targeting", target: "this-model", modifier: { by: { owner: "enemy" }, may: "cannot-target", kind: "stratagem" } }),
    ).toBe("Enemy units cannot target this model with Stratagems.");
  });
});

describe("leaf English defects found by the corpus sweep", () => {
  it("does not double a noun the name already carries", () => {
    expect(
      render({ type: "stat-modifier", target: "this-model", modifier: { stat: "S", operation: "add", value: 1, weapon_name: "hellforged weapons" } }),
    ).toBe("Add 1 to the Strength characteristic of hellforged weapons equipped by this model.");
    expect(render({ type: "marker", target: "this-unit", modifier: { label: "cult-ambush-marker", operation: "relocate", distance: 12 } })).toBe(
      'Move the cult ambush marker up to 12".',
    );
  });

  it("an ability-modifier that only adds recipients has no '?' count", () => {
    expect(
      render({
        type: "ability-modifier",
        target: { owner: "friendly", all_of: ["OFFICER"] },
        modifier: { ability: "voice-of-command-astra-militarum", aspect: "recipients", operation: "add", recipients: { all_of: ["SQUADRON"] } },
      }),
    ).toBe("All friendly OFFICER units' Voice of Command ability can also affect all SQUADRON units.");
  });

  it("does not repeat a range the target filter already states", () => {
    expect(
      render({ type: "mortal-wounds", target: { owner: "enemy", within: { range: { inches: 6 } } }, modifier: { count: "D3", range: { inches: 6 } } }),
    ).toBe('Enemy units within 6" suffer D3 mortal wounds.');
  });

  it("names whose roll a re-roll is when it is not the ability's own unit", () => {
    expect(
      render({ type: "re-roll", target: { owner: "friendly", within: { range: { inches: 6 } } }, modifier: { roll: "hit", subset: "ones" } }),
    ).toBe('You can re-roll a Hit roll of 1 for attacks made by friendly units within 6".');
    expect(render({ type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } })).toBe("You can re-roll a Hit roll of 1.");
  });

  it("'cannot' clauses drop the universal 'all'", () => {
    expect(render({ type: "rule-state", target: { owner: "enemy" }, modifier: { direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" } })).toBe(
      "Enemy units cannot benefit from Cover.",
    );
  });

  it("not(not(X)) reads as X, and same-unit against this unit reads 'this unit'", () => {
    const same = { type: "same-unit", parameters: { as: "this-unit" } };
    expect(describeCondition({ operator: "not", operands: [{ operator: "not", operands: [same] }] })).toBe(
      "the unit is the same unit as this unit",
    );
    expect(describeCondition({ operator: "not", operands: [same] })).toBe("the unit is not the same unit as this unit");
  });

  it("an enemy unit's move is a reaction window with a lead word and article", () => {
    expect(describeTrigger({ event: "move-ended", subject: { owner: "enemy" } })).toBe("each time an enemy unit ends a move");
    expect(describeTrigger({ event: "move-ended", subject: { owner: "friendly" }, filter: { move_types: ["advance"] } })).toBe(
      "each time a friendly unit ends an Advance move",
    );
  });

  it("a gated act-on-death under a model-destroyed trigger has one lead-in", () => {
    const effect = {
      type: "act-on-death", target: "event-object",
      modifier: { act: "fight", gate: { dice: "D6", threshold: 4, comparison: "gte" }, eligibility: { type: "happened", parameters: { event: "selected", filter: { to: "fight" }, window: "phase" } } },
    };
    const text = describeAbility({ effect, scope: { duration: "phase" }, trigger: { event: "model-destroyed", object: "this-unit" } } as never);
    expect(text).toMatch(/^When a model in the unit is destroyed, until the end of the phase, if the unit has fought this phase, roll one D6\./);
    expect(text.match(/is destroyed/g)).toHaveLength(1);
    expect(render(effect as never)).toMatch(/^Each time a model in this unit is destroyed, if the unit has fought this phase, roll one D6\./);
  });

  it("a pool gain names the resource, singular or plural by amount, not the pool", () => {
    const gain = (pool: string, amount: unknown) => render({ type: "resource-gain", target: "this-unit", modifier: { pool, amount } } as never);
    expect(gain("miracle-dice-pool", 1)).toBe("You gain 1 Miracle die.");
    expect(gain("miracle-dice-pool", 2)).toBe("You gain 2 Miracle dice.");
    expect(gain("pain-token-pool", 1)).toBe("You gain 1 Pain token.");
    expect(gain("pain-token-pool", "D3")).toBe("You gain D3 Pain tokens.");
    expect(gain("blood-tithe-pool", 2)).toBe("You gain 2 Blood Tithe points.");
  });
});
