import { describe, expect, it } from "vitest";
import { describeCondition, type Condition } from "../src/translate/condition.js";
import { conditionLeadIn, describeSelectionEligibility } from "../src/translate/condition-leadin.js";
import { describeAbility, describeAppliesTo, describeEffect, type Effect } from "../src/translate/effect.js";
import { describeTrigger } from "../src/translate/trigger.js";

describe("tabletop rules register and composition", () => {
  it("folds trigger subject keywords inline while preserving all_of vs any_of vs none_of", () => {
    expect(describeTrigger({ event: "attacks-resolved", filter: { kind: "shoot" }, subject: { owner: "friendly", all_of: ["ALPHA"] } }))
      .toBe("after a friendly ALPHA unit shoots");
    expect(describeTrigger({ event: "attacks-resolved", filter: { kind: "shoot" }, subject: { owner: "friendly", any_of: ["ALPHA", "BETA"] } }))
      .toBe("after a friendly ALPHA or BETA unit shoots");
    expect(describeTrigger({ event: "selected", filter: { to: "fight" }, subject: { owner: "friendly", none_of: ["MONSTER", "VEHICLE"] } }))
      .toBe("when a friendly unit (excluding MONSTER or VEHICLE units) is selected to fight");
    expect(describeTrigger({ event: "selected", filter: { to: "fight" }, subject: { owner: "friendly", any_of: ["ALPHA"] } }))
      .not.toBe(describeTrigger({ event: "selected", filter: { to: "fight" }, subject: { owner: "friendly", all_of: ["ALPHA"] } }));
  });

  it("fuses phase + player-turn lead-ins and exact battle-round trigger boundaries", () => {
    const phaseTurn: Condition = {
      operator: "and",
      operands: [
        { type: "phase-is", parameters: { phase: "shooting" } },
        { type: "player-turn-is", parameters: { turn: "your-turn" } },
      ],
    };
    expect(conditionLeadIn(phaseTurn)).toBe("during your Shooting phase");
    expect(describeTrigger({
      event: "round-started",
      condition: { type: "battle-round", parameters: { min: 1, max: 1 } },
    })).toBe("at the start of the first battle round");
  });

  it("preserves logical grouping for or-inside-and selection eligibility", () => {
    const elig: Condition = {
      operator: "and",
      operands: [
        { type: "matches", parameters: { subject: "selected-unit", filter: { within: { range: { inches: 24 }, of: "this-model" } } } },
        { type: "matches", parameters: { subject: "selected-unit", filter: { visible: { to: "this-model" } } } },
        {
          operator: "or",
          operands: [
            { type: "matches", parameters: { subject: "selected-unit", filter: { lacks_ability: ["lone-operative"] } } },
            { type: "attachment", parameters: { subject: "selected-unit" } },
            { type: "matches", parameters: { subject: "selected-unit", filter: { within: { range: { inches: 12 }, of: "this-model" } } } },
          ],
        },
      ],
    };
    const rendered = describeSelectionEligibility(elig);
    expect(rendered).toBe(
      'that is within 24" of this model and visible to this model and (without the Lone Operative ability or that is an attached unit or within 12" of this model)',
    );
  });

  it("uses plural pronouns for plural select-units and 'that unit' for for-each-unit recipients", () => {
    const pluralSelect: Effect = {
      type: "select-units",
      selector: { filter: { owner: "friendly", all_of: ["ALPHA"] }, count: { min: 0, max: 3 } },
      effect: { type: "set-up", target: "selected-unit", modifier: { to: "battlefield", from: "battlefield" } },
    };
    expect(describeAbility({ effect: pluralSelect }))
      .toBe("Select up to 3 friendly ALPHA units. Those units can be removed from the battlefield and set up again.");

    const loop: Effect = {
      type: "for-each-unit",
      selector: { filter: { owner: "enemy", within: { range: { inches: 12 }, of: "this-model" } } },
      effect: { type: "mortal-wounds", target: "recipient", modifier: { count: "D3" } },
    };
    expect(describeAbility({ effect: loop }))
      .toBe('For each enemy unit within 12" of this model: That unit suffers D3 mortal wounds.');
  });

  it("renders self-targeting restrictions passively without 'this unit cannot target this unit'", () => {
    const eff: Effect = {
      type: "conditional",
      condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } },
      effect: {
        type: "conditional",
        condition: { operator: "not", operands: [{ type: "matches", parameters: { subject: "attacker", filter: { within: { range: { inches: 18 }, of: "this-unit" } } } }] },
        effect: { type: "targeting", target: "this-unit", modifier: { may: "cannot-target", kind: "attack", weapons: { type: "ranged" }, target: "this-unit" } },
      },
    };
    expect(describeAbility({ effect: eff }))
      .toBe('While this model is leading a unit and the attacking unit is not within 18" of this unit, this unit cannot be targeted with ranged weapons.');
  });

  it("formats roll modifiers, stat suffixes, articles, resource-die lists, 0-inch contact, and ASCII-only risk-reward", () => {
    expect(describeAbility({
      effect: {
        type: "sequence",
        steps: [
          { type: "stat-modifier", target: "this-model", modifier: { stat: "Sv", operation: "set", value: 2 } },
          { type: "feel-no-pain", target: "this-model", modifier: { threshold: 5 } },
        ],
      },
      applies_to: { all_of: ["ALPHA"] },
    })).toBe("Set this model's Save characteristic to 2+.\nThis model has Feel No Pain 5+.\nApplies to: ALPHA units.");

    expect(describeAbility({
      effect: { type: "resource-die", target: "this-unit", modifier: { pool: "example-dice", operation: "substitute", rolls: ["advance", "hit", "wound"] } },
    })).toBe("Discard a die from your Example dice and use its value in place of an Advance, Hit or Wound roll.");

    expect(describeCondition({
      type: "attachment",
      parameters: { subject: "this-model", role: "leading", with: { all_of: ["ASPECT"] } },
    })).toBe("this model is leading an ASPECT unit");

    expect(describeCondition({
      type: "matches",
      parameters: { filter: { within: { range: { inches: 0 }, of: { marker: "example" } } } },
    })).toBe("this unit is in contact with an example marker");

    const riskText = describeEffect({
      type: "risk-reward",
      risk: { test: "leadership", on_fail: { type: "mortal-wounds", target: "this-unit", modifier: { count: "D3" } } },
      reward: { type: "cp-gain", target: "this-unit", modifier: { amount: 1 } },
    });
    expect(riskText).toBe("Take a Leadership test. On a failure, this unit suffers D3 mortal wounds; then you gain 1 CP.");
    expect(/^[\x00-\x7F]+$/.test(riskText)).toBe(true);
  });

  it("does not double-trigger act-on-death inside an ability-part and suppresses redundant bare weapon scope", () => {
    const actOnDeathPart: Effect = {
      type: "ability-part",
      trigger: { event: "model-destroyed", object: "model-in-this-unit" },
      effect: { type: "act-on-death", target: "event-object", modifier: { act: "fight" } },
    };
    expect(describeAbility({ effect: actOnDeathPart }))
      .toBe("When a model in this unit is destroyed, that model can fight before being removed from play.");

    const attackMod: Effect = {
      type: "conditional",
      condition: { type: "attack-is", parameters: { attack_type: "ranged" } },
      effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1, weapons: { type: "ranged" } } },
    };
    expect(describeAbility({ effect: attackMod }))
      .toBe("While making ranged attacks, add 1 to this unit's Hit rolls.");

    // Non-bare weapon scope (e.g. named weapon) is still preserved.
    const namedMod: Effect = {
      type: "conditional",
      condition: { type: "attack-is", parameters: { attack_type: "ranged" } },
      effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1, weapons: { type: "ranged", name: "Example Rifle" } } },
    };
    expect(describeAbility({ effect: namedMod }))
      .toBe("While making ranged attacks, add 1 to this unit's Hit rolls with ranged Example Rifle weapons.");
  });

  it("simplifies redundant aura filters, inlines simple trigger selections/rolls, and avoids doubled clauses", () => {
    // Boolean simplification in aura emitter: (MONSTER or TITANIC) without TITANIC -> MONSTER (excluding TITANIC models).
    const aura: Effect = {
      type: "aura",
      target: "friendly-within-aura",
      modifier: {
        range: { inches: 6 },
        eligible: { owner: "friendly", any_of: ["ALPHA", "BETA"] },
        emitter_filter: { owner: "friendly", all_of: ["FACTION"], any_of: ["MONSTER", "TITANIC"], none_of: ["TITANIC"] },
        effect: { type: "invulnerable-save", target: "recipient", modifier: { invuln_sv: 4 } },
      },
    };
    expect(describeAbility({ effect: aura }))
      .toBe('While a friendly unit with the ALPHA or BETA keyword is within 6" of one or more friendly FACTION MONSTER models (excluding TITANIC models), that unit has a 4+ invulnerable save.');

    // Friendly filtered trigger binds `this-unit` to "that unit".
    expect(describeAbility({
      trigger: { event: "selected", filter: { to: "fight" }, subject: { owner: "friendly", all_of: ["ALPHA"] } },
      scope: { duration: "phase" },
      effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "improve", value: 1, weapons: { type: "melee" } } },
    })).toBe("When a friendly ALPHA unit is selected to fight, until the end of the phase, improve the Attacks characteristic of melee weapons equipped by models in that unit by 1.");

    // Attack stat on `target: "attacker"` refers to the attacking unit's attacks.
    expect(describeAbility({
      trigger: { event: "targets-selected", filter: { kind: "attack" }, subject: { owner: "enemy" }, object: { owner: "friendly", all_of: ["ALPHA"] } },
      scope: { duration: "attack-sequence" },
      effect: { type: "stat-modifier", target: "attacker", modifier: { stat: "AP", operation: "worsen", value: 1 } },
    })).toBe("When an enemy unit targets a friendly ALPHA unit, until the attacking unit finishes resolving its attacks, worsen the Armour Penetration characteristic of the attacking unit's attacks by 1.");

    // Simple trigger + single-leaf select-units / dice-gated inlines into one sentence.
    expect(describeAbility({
      trigger: { event: "phase-ended", condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "movement" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] } },
      effect: {
        type: "select-units",
        selector: { filter: { owner: "enemy", within: { range: { inches: 12 }, of: "this-unit" } }, count: { min: 1, max: 1 } },
        effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock" } },
      },
    })).toBe('At the end of your Movement phase, select one enemy unit within 12" of this unit. That unit must take a Battle-shock test.');

    // Leadership test with no success effect renders "if failed, ...".
    expect(describeAbility({
      effect: {
        type: "dice-gated",
        test: { kind: "leadership", subject: "event-subject" },
        on_fail: { type: "permission", target: "event-subject", modifier: { activity: "fall-back", allow: false } },
      },
    })).toBe("The triggering unit takes a Leadership test; if failed, the triggering unit cannot Fall Back.");

    // Damage reduction under damage-allocated trigger does not repeat "each time an attack is allocated".
    expect(describeAbility({
      effect: {
        type: "ability-part",
        trigger: { event: "damage-allocated" },
        effect: { type: "damage-reduction", target: "this-unit", modifier: { reduction: 1 } },
      },
    })).toBe("When damage is allocated, subtract 1 from the Damage characteristic of that attack.");
  });

  it("formats Applies to cleanly while keeping none_of and not_all_of distinct", () => {
    expect(describeAppliesTo({ all_of: ["ALPHA", "INFANTRY"] })).toBe("Applies to: ALPHA INFANTRY units.");
    expect(describeAppliesTo({ any_of: ["ALPHA", "BETA"], none_of: ["VEHICLE"] }))
      .toBe("Applies to: units with the ALPHA or BETA keyword (excluding VEHICLE units).");
    expect(describeAppliesTo({ not_all_of: ["ALPHA", "CHARACTER"] }))
      .toBe("Applies to: all units (excluding units with all of ALPHA and CHARACTER).");
  });
});
