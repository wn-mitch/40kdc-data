import { describe, expect, it } from "vitest";
import { describeAbility, describeAppliesTo, describeEffect, describeEffectInline, type Effect } from "../src/translate/effect.js";
import { describeCondition } from "../src/translate/condition.js";
import { describeTrigger } from "../src/translate/trigger.js";

const nothing: Effect = { type: "no-effect" };

describe("canonical effect container contracts", () => {
  it("renders exact unit identities without confusing IDs with model names", () => {
    const text = describeCondition({ type: "matches", parameters: { subject: "this-unit", filter: {
      level: "unit", unit_ids: ["example-unit", "another-unit"],
    } } });
    expect(text).toContain("with unit ID example-unit or another-unit");
    expect(describeEffectInline({ type: "stat-modifier", target: { level: "unit", unit_ids: ["example-unit"] }, modifier: {
      stat: "S", operation: "add", value: 1,
    } } as Effect)).toContain("with unit ID example-unit");
  });

  it("renders used-ability source and usage qualifications together", () => {
    expect(describeTrigger({ event: "used", subject: "this-model", binds_event_variable: "used-ability", filter: {
      kind: "ability", source: ["unit", "enhancement"], usage: { frequency: "n-per-battle", count: 1 },
    } })).toBe("each time this model uses an ability from its datasheet or an Enhancement that can be used once per battle");
    expect(describeEffectInline({ type: "ability-modifier", target: "this-model", modifier: {
      ability: { event: "used", event_var: "used-ability" }, aspect: "uses", operation: "add", value: 1, not_same: "phase",
    } } as Effect)).toContain("but not in the same phase as the use that triggered this");
  });

  it("renders unlimited Advance distance without discarding movement restrictions", () => {
    const effect = { type: "move-modifier", target: "this-unit", modifier: {
      maximum: "unlimited", applies_to_moves: ["advance"], no_end_in_engagement: true,
    } } as Effect;
    expect(describeEffectInline(effect)).toBe("the unit can move any distance; the unit cannot end a move within Engagement Range of any enemy unit, during its Advance moves");
  });

  it("renders typed dice-test subjects without legacy target aliases", () => {
    for (const [subject, label] of [
      ["this-model", "this model"],
      ["selected-unit", "the selected unit"],
      [{ selection_var: "chosen" }, "the bound chosen"],
    ] as const) {
      const text = describeEffectInline({ type: "dice-gated", test: { kind: "leadership", subject }, on_success: nothing });
      expect(text).toContain(`${label} takes a Leadership test`);
    }
  });

  it("renders count bounds, model filters, eligibility, binding and army-wide limits together", () => {
    const effect: Effect = {
      type: "select-units",
      selector: {
        filter: { owner: "friendly", level: "model", all_of: ["INFANTRY"], none_of: ["CHARACTER"], model_names: ["Example Trooper"], within: { range: { inches: 7 }, wholly: true, of: "this-model" }, visible: { to: "this-model" } },
        count: { min: 1, max: 2 }, bind_as: "chosen-models", limit: { count: 2, period: "battle-round" },
        eligibility: { type: "matches", parameters: { subject: "this-unit", filter: { not_states: ["battle-shocked"] } } },
      },
      effect: nothing,
    };
    for (const text of [describeEffect(effect), describeEffectInline(effect)]) {
      expect(text).toContain("from one through 2 friendly INFANTRY models");
      expect(text).toContain("excluding CHARACTER models");
      expect(text).toContain('wholly within 7" of this model');
      expect(text).toContain("visible to this model");
      expect(text).toContain("not Battle-shocked");
      expect(text).toContain("at most 2 times per battle round across your army");
      expect(text).toContain("binding them as chosen models");
    }
  });

  it("renders unbounded, exact and per-member selections without inventing a count", () => {
    const selector = { filter: { owner: "enemy", any_of: ["MONSTER", "VEHICLE"] } };
    expect(describeEffectInline({ type: "select-units", selector: { ...selector, count: { min: 2 } }, effect: nothing })).toContain("select at least 2 enemy units");
    expect(describeEffectInline({ type: "select-units", selector: { ...selector, count: { min: 1, max: 1 } }, effect: nothing })).toContain("select one enemy unit");
    expect(describeEffectInline({ type: "for-each-unit", selector: { ...selector, bind_as: "victim" }, effect: nothing })).toBe("for each enemy unit with the MONSTER or VEHICLE keyword, binding it as victim: nothing happens");
  });

  it("keeps designation attacker model and attacker unit predicates independent", () => {
    const effect: Effect = {
      type: "designate-target", designation: "priority-target", duration: "phase",
      select: { kind: "unit", selector: { filter: { owner: "enemy", none_of: ["TITANIC"] }, count: { min: 1, max: 1 }, bind_as: "priority" } },
      applies: { to: "attackers-of-target", attacker_filter: { all_of: ["CHARACTER"] }, attacker_unit_filter: { all_of: ["INFANTRY"] }, effect: nothing },
    };
    for (const text of [describeEffect(effect), describeEffectInline(effect)]) {
      expect(text).toContain("one enemy unit (excluding TITANIC units), binding it as priority");
      expect(text).toContain("each time a CHARACTER model in a friendly INFANTRY unit");
      expect(text).toMatch(/until the end of the phase/i);
    }
  });

  it("uses canonical objective selection and persistent designation lifecycle fields", () => {
    const effect: Effect = {
      type: "persistent-designation", designation: "watch", selection_policy: "one-time", allow_while_embarked: true, duration: "battle",
      select: { kind: "objective", selector: { filter: { controlled_by: "friendly" }, count: { min: 1, max: 1 }, bind_as: "watch-marker", limit: { count: 1, period: "battle" } } },
      consumer: { beneficiary: "this-unit", relation: "within-selected-marker", effect: nothing },
    };
    const text = describeEffect(effect);
    expect(text).toContain("Select one objective marker you control, binding it as watch marker");
    expect(text).toContain("each objective marker can be selected for this ability at most once per battle across your army");
    expect(text).toContain("This selection can be made while this unit is embarked.");
    expect(text).toContain("while a model in this unit is within range of your Watch Marker");
  });

  it("puts stance timing and usage on the parent and uses stable capacity references", () => {
    const effect: Effect = { type: "stance-select", mode: "consumable", options: [{ id: "guard", name: "Guard", effect: nothing }, { id: "strike", name: "Strike", effect: nothing }] };
    const text = describeAbility({ effect, trigger: { event: "turn-started" }, usage: { frequency: "n-per-battle", count: 1 } });
    expect(text.match(/start of/g)).toHaveLength(1);
    expect(text).toContain("once per battle");
    expect(describeEffect(effect)).toMatch(/^Select/);
    expect(describeEffectInline(effect)).toContain("each may be chosen once per battle");
    expect(describeEffectInline({ type: "stance-selection-capacity", modifier: { ability_id: "stances", option: { ability_id: "stances", option_id: "guard" }, allocation: "fixed-option", additional_selections: 1 } })).toBe("you can select Guard one additional time per battle");
  });

  it("renders named region producers from supplied region, threshold, timing and duration", () => {
    const condition = { type: "controls", parameters: { by: "friendly", objective: { territory: "enemy-territory" }, proportion: { comparison: "gte", fraction: 0.75 } } };
    const effect: Effect = { type: "named-region-state", modifier: {
      region_ref: { region_id: "example-region", owner_faction: "example-faction" },
      producer: { mode: "complete", parent_ref: null, baseline: [{ region: { territory: "your-territory" }, duration: "battle" }], phase_extensions: [{ region: { territory: "enemy-territory" }, condition, trigger: { event: "turn-started" }, duration: "turn", evaluation: "snapshot-once" }], additive_extensions: [{ kind: "unit-proximity", filter: { owner: "friendly", all_of: ["PSYKER"] }, range: { inches: 8 } }] },
      consumer: { beneficiary_filter: { owner: "friendly", all_of: ["INFANTRY"] }, membership: { unit_scope: "whole-unit", relation: "wholly-within" }, qualified_condition: { type: "matches", parameters: { filter: { state: "engaged" } } }, default_branch: { effect: { type: "ability-part", name: "Ordinary", effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } } }, qualified_branch: { effect: { type: "ability-part", name: "Empowered", usage: { frequency: "once-per-turn" }, effect: nothing } } },
    } };
    const text = describeEffectInline(effect);
    expect(text).toContain(describeCondition(condition));
    expect(text).toContain("enemy territory is within Example Region until the end of the turn");
    expect(text).toContain("evaluated once at that time");
    expect(text).toContain('within 8" of one or more');
    expect(text).toContain("Ordinary: all friendly INFANTRY units get +1 to Hit rolls");
    expect(text).toContain("Empowered, once per turn: nothing happens");
    expect(text).not.toContain("half");
    expect(text).not.toContain("No Man's Land");
  });

  it("renders canonical aura ranges and each independent keyword predicate", () => {
    const text = describeEffectInline({ type: "aura", target: "friendly-within-aura", modifier: { range: { per_battle_round: [{ inches: 3 }, { inches: 6 }] }, emitter_filter: { all_of: ["PSYKER"], none_of: ["MONSTER"] }, recipient_filter: { any_of: ["INFANTRY", "MOUNTED"], not_all_of: ["CHARACTER", "FLY"] }, effect: nothing } });
    expect(text).toContain('3", 6" in battle rounds 1, 2 respectively');
    expect(text).toContain("INFANTRY or MOUNTED");
    expect(text).toContain("excluding CHARACTER FLY");
    expect(text).toContain("this model with PSYKER without MONSTER");
  });

  it("uses canonical menu durations and eligibility, and delegates defined grants", () => {
    const menu: Effect = { type: "resource-action-menu", actions: [{ label: "Dash", when: { event: "turn-started" }, cost: { amount: 1, pool_id: "example-pool" }, eligibility: { filter: { owner: "friendly", none_of: ["TITANIC"] }, count: { max: 1 } }, duration: "turn", effect: nothing }] };
    expect(describeEffect(menu)).toContain("only usable by up to one friendly unit (excluding TITANIC units)");
    expect(describeEffect(menu)).toContain("until the end of the turn");
    menu.actions![0]!.duration = "resolution";
    expect(describeEffect(menu)).not.toContain("until the end");
    const grant: Effect = { type: "ability-grant", target: { level: "model", attachment_role: "leader", member_of: "this-unit", all_of: ["CHARACTER"] }, modifier: { definition: { type: "ability-part", name: "Example Rule", effect: nothing } } };
    expect(describeEffect(grant)).toContain("Example Rule");
    expect(describeEffect(grant)).toContain("Nothing happens.");
    expect(describeEffect(grant)).not.toContain("[ability-grant]");
  });

  it("retains all four applies-to predicate semantics", () => {
    expect(describeAppliesTo({ all_of: ["INFANTRY"], any_of: ["FLY", "MOUNTED"], none_of: ["MONSTER"], not_all_of: ["CHARACTER", "PSYKER"] })).toBe(
      "Applies to: units with INFANTRY and at least one of FLY or MOUNTED (excluding MONSTER) (excluding units with all of CHARACTER, PSYKER).",
    );
  });
});
