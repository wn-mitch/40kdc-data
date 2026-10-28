import { describe, expect, it } from "vitest";
import { describeCondition, type Condition } from "../src/translate/condition.js";
import { conditionLeadIn, describeSelectionEligibility } from "../src/translate/condition-leadin.js";
import { countPhrase, objectivePhrase, placeRefPhrase, rangePhrase, unitFilterPhrase } from "../src/translate/condition-refs.js";
import { describeAbility, describeAppliesTo, describeEffect, describeEffectInline, type Effect } from "../src/translate/effect.js";
import { expiryTrail } from "../src/translate/expiry.js";
import { describeTrigger } from "../src/translate/trigger.js";

const matches = (filter: Record<string, unknown>, subject?: string): Condition => ({
  type: "matches", parameters: { filter, ...(subject == null ? {} : { subject }) },
});
const not = (condition: Condition): Condition => ({ operator: "not", operands: [condition] });

describe("canonical condition predicates", () => {
  it("renders counted shared weapon scopes and their negation", () => {
    const condition = { type: "equipped-weapon-count", parameters: {
      subject: "this-model", count: { min: 2, max: 2 },
      weapons: { type: "melee", exclude_name: "Example Blade" },
    } };
    expect(describeCondition(condition)).toBe('this model is equipped with exactly 2 melee weapons other than "Example Blade"');
    expect(describeCondition(not(condition))).toBe('this model is not equipped with exactly 2 melee weapons other than "Example Blade"');
    expect(describeCondition({ ...condition, parameters: { ...condition.parameters, count: { min: 1, max: 1 } } })).toBe('this model is equipped with exactly 1 melee weapon other than "Example Blade"');
  });

  it("preserves keyword, state and ownership wording without retired atoms", () => {
    expect(describeCondition(matches({ all_of: ["INFANTRY"] }))).toBe('the unit has "INFANTRY"');
    expect(conditionLeadIn(matches({ any_of: ["MONSTER", "VEHICLE"] }, "defender"))).toBe("against MONSTER or VEHICLE targets");
    expect(describeCondition(not(matches({ all_of: ["INFANTRY"] })))).toBe('the unit does not have "INFANTRY"');
    expect(describeCondition(matches({ none_of: ["MONSTER", "VEHICLE"] }))).toBe('the unit does not have "MONSTER" or "VEHICLE"');
    expect(describeCondition(matches({ not_all_of: ["MONSTER", "CHARACTER"] }))).toBe('the unit does not have all of "MONSTER" and "CHARACTER"');
    expect(conditionLeadIn(matches({ state: "battle-shocked" }))).toBe("while the unit is Battle-shocked");
    expect(describeSelectionEligibility(not(matches({ state: "battle-shocked" })))).toBe("that is not Battle-shocked");
    expect(describeCondition(matches({ owner: "enemy" }))).toBe("the unit is an enemy unit");
    expect(describeCondition({ type: "has-keyword", parameters: { chosen_by: "chosen-mark" } })).toBe("the unit has the keyword selected for Chosen Mark");
    expect(describeCondition({ type: "owned-by", parameters: { owner: "enemy" } })).toBe("owned by");
    expect(describeCondition({ type: "has-ability", parameters: { ability: "stealth" } })).toBe("has ability");
  });

  it("retains conjunction and alternative filter semantics", () => {
    const filter = { all_of: ["INFANTRY"], state: "battle-shocked" };
    expect(describeCondition(not(matches(filter)))).toBe("the unit is not an INFANTRY unit that is Battle-shocked");
    expect(describeCondition(matches({ any_of_filters: [{ all_of: ["PSYKER"] }, { state: "battle-shocked" }] }))).toBe("the unit is a unit that is a PSYKER unit or a unit that is Battle-shocked");
    expect(conditionLeadIn({ operator: "and", operands: [matches({ all_of: ["INFANTRY"] }), matches({ all_of: ["CHARACTER"] })] })).toBe("if the unit is an INFANTRY CHARACTER unit");
  });

  it("names actual attachment membership and exact reference kinds", () => {
    const filter = { level: "model", attachment_role: "bodyguard", member_of: "this-unit", model_names: ["Guard"] };
    expect(unitFilterPhrase(filter)).toBe("a bodyguard model named Guard in the unit");
    expect(describeCondition(matches(filter, "this-model"))).toBe("this model is a bodyguard model named Guard in the unit");
    expect(unitFilterPhrase({ visible: { to: { selection_var: "observer" } }, engaged_with: "this-model" })).toBe("a unit within Engagement Range of this model that is visible to the bound observer");
    expect(unitFilterPhrase({ not_engaged_with: { selection_var: "target" } })).toBe("a unit not within Engagement Range of the bound target");
    expect(placeRefPhrase({ objective: { selection_var: "marker" } })).toBe("that objective marker");
    expect(describeCondition(matches({ within: { range: { inches: 6 }, of: "battlefield-centre", wholly: true } }))).toBe('the unit is wholly within 6" of the centre of the battlefield');
    expect(describeCondition(matches({ visible: { to: "attacker" } }, "defender"))).toBe("the target is visible to the attacking model");
  });

  it("retains differentiated visibility, historical state and per-model position", () => {
    expect(describeCondition({ type: "visible", parameters: { subject: "defender", fully: true, blocked_by: "this-unit" } })).toBe("the target is not fully visible to the attacking model because of this unit");
    expect(describeCondition({ type: "unit-state", parameters: { state: "engaged", at: "turn-start" } })).toBe("the unit was engaged at the start of the turn");
    expect(describeCondition({ type: "within", parameters: { models: "every", of: "battlefield-edge", range: { inches: 6 }, wholly: true } })).toBe('every model in the unit is wholly within 6" of a battlefield edge');
    expect(describeCondition({ type: "within", parameters: { count: { min: 2, max: 3 }, of: { objective: { role: "central" } }, range: "objective-control", at: "phase-start" } })).toBe("2-3 models in the unit were within range of a central objective marker at the start of the phase");
  });

  it("renders all count bounds and persistent range tiers", () => {
    expect(countPhrase({ min: 2, max: 2 })).toBe("exactly 2");
    expect(countPhrase({ min: 2, max: 4 })).toBe("2-4");
    expect(countPhrase({ max: 0 })).toBe("at most 0");
    expect(countPhrase({ max: { roll_var: "result" } })).toBe("at most the result of that roll");
    expect(countPhrase({ min: "D3" })).toBe("at least D3");
    expect(countPhrase({ min: 1, max: { count_of: "battle-round" } })).toBe("between 1 and the battle round number");
    expect(rangePhrase({ per_battle_round: [{ inches: 3 }, { inches: 6 }] })).toBe('3", 6" in battle rounds 1, 2 respectively (using the final range in later battle rounds)');
    expect(describeCondition({ type: "resource", parameters: { pool: "tokens", count: { max: 3 } } })).toBe("the unit has at most 3 tokens");
    expect(describeCondition({ type: "happened", parameters: { event: "destroyed", object: { owner: "enemy" }, count: { min: 2, max: 4 }, window: "turn" } })).toBe("2-4 enemy units destroyed this turn");
  });

  it("preserves controls comparison, proportion and mission correlation", () => {
    expect(describeCondition({ type: "controls", parameters: { compare: { owner: "enemy", comparison: "gt" } } })).toBe("you hold more objectives than the opponent");
    expect(describeCondition({ type: "controls", parameters: { by: "enemy", objective: { role: "central" }, count: { min: 1 }, proportion: { comparison: "gt", fraction: 0.5 } } })).toBe("your opponent controls 1+ central objectives and your opponent controls more than half of the central objectives");
    expect(describeCondition({ type: "operation-markers", parameters: { count: { min: 2, max: 2 }, within: { range: "objective-control", of: { objective: { role: "central" } } }, friendly_unit_in_same_terrain_area: true, no_enemy_in_terrain_area: true } })).toBe("exactly 2 operation markers on the battlefield within range of a central objective marker with a friendly unit in the same terrain area and no enemy units in that terrain area");
    expect(describeCondition({ type: "destroyed-while-on-objective", parameters: { count: { max: 2 }, objective_role: "central", destroyer_on_objective: true, victim_started_turn_on_objective: true } })).toBe("at most 2 enemy units destroyed by a unit on a central objective that started the turn on a central objective");
    expect(objectivePhrase({ controlled_by: "friendly", within: { range: "objective-control", of: "this-unit" } })).toBe("objective your unit controls");
    expect(describeCondition(not({ type: "controls", parameters: { count: { min: 1 }, compare: { owner: "enemy", comparison: "gt" } } }))).toBe("not (you control 1+ objectives and you hold more objectives than the opponent)");
  });

  it("names immutable stance options rather than treating them as global rules", () => {
    const condition: Condition = { type: "rule-active", parameters: { rule: { ability_id: "battle-stance", option_id: "guard" } } };
    expect(describeCondition(condition)).toBe("the Guard option of Battle Stance is active");
    expect(conditionLeadIn(condition)).toBe("while the Guard option of Battle Stance is active");
    expect(describeCondition(not(condition))).toBe("the Guard option of Battle Stance is not active");
  });
});

describe("canonical triggers and durations", () => {
  it("renders army selection and bound observers without collapsing references", () => {
    expect(describeTrigger({ event: "army-selected" })).toBe("when selecting your army");
    expect(describeTrigger({ event: "move-ended", subject: { owner: "enemy", visible: { to: "this-model" } }, proximity: { of: { objective: { selection_var: "marker" } }, range: { inches: 6 } } })).toBe('each time an enemy unit that is visible to this model ends a move within 6" of that objective marker');
  });

  it("renders structured weapon keyword parameters", () => {
    const weapons = { keyword: { keyword_id: "anti", parameters: { target_keyword: "VEHICLE", threshold: 4 } } };
    expect(describeTrigger({ event: "destroyed", filter: { weapons } })).toBe("when the unit is destroyed with a [ANTI-VEHICLE 4+] weapon");
    expect(describeCondition({ type: "attack-is", parameters: { weapons } })).toBe("for attacks made with [ANTI-VEHICLE 4+] weapons");
    expect(describeCondition({ type: "happened", parameters: { event: "after-roll", filter: { roll: "hit", result: "success", weapons }, window: "phase" } })).toBe("the unit was hit by an attack made with a [ANTI-VEHICLE 4+] weapon this phase");
  });

  it("uses shared expiry phrases", () => {
    expect(expiryTrail("while-leading")).toBe("while this model is leading a unit");
    expect(expiryTrail("after-resolving")).toBe("after resolving this use");
    expect(expiryTrail("resolution")).toBe("when resolving this use");
    expect(expiryTrail("permanent")).toBe("");
  });
});

it("does not flatten a negated keyword conjunction into two exclusions", () => {
  const condition = not(matches({ all_of: ["MONSTER", "CHARACTER"] }, "defender"));
  expect(describeCondition(condition)).toBe('the target does not have all of "MONSTER" and "CHARACTER"');
  expect(conditionLeadIn(condition)).toBe("against a unit that does not have all of MONSTER and CHARACTER");
});

it("retains full attachment filters and weapon scopes on non-destruction events", () => {
  expect(conditionLeadIn({ type: "attachment", parameters: { role: "leading", with: { owner: "friendly", none_of: ["MONSTER"] } } })).toBe("while this model is leading a friendly unit (excluding MONSTER units)");
  expect(describeTrigger({ event: "before-roll", filter: { roll: "hit", weapons: { type: "ranged", exclude_name: "Sidearm" } } })).toBe('before a Hit roll is made for an attack made by a model in this unit with ranged weapons other than "Sidearm"');
});

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

/**
 * Describer pins for the move-end nearest shapes: a make-move's ends_nearest, a bonus's waiver
 * (either end legal), a bonus's ends_when proviso, and the engaged permission bound to the
 * nearest-end unit. Each phrase pins one branch so a wording change is a visible diff.
 */
function render(effect: Effect): string {
  return describeAbility({ effect, scope: { duration: "permanent" } } as Parameters<typeof describeAbility>[0]);
}

const nearest = { of: { owner: "enemy" } };

describe("move-end nearest describer", () => {
  it("says a make-move must end as close as possible to the closest unit it names", () => {
    const text = render({ type: "move", target: "this-unit", modifier: { move_type: "normal", distance: "D6", ends_nearest: nearest } } as Effect);
    expect(text).toContain("it must end that move as close as possible to the closest enemy unit");
  });

  it("says either end is legal when the waiver applies", () => {
    const text = render({
      type: "move-modifier", target: "this-unit",
      modifier: { applies_to_moves: ["pile-in", "consolidation"], ends_nearest: { ...nearest, waives: "closest-enemy-model" } },
    } as Effect);
    expect(text).toContain("either closer to the closest enemy model or as close as possible to the closest enemy unit");
  });

  it("states the bonus proviso and the end the bonus move must take", () => {
    const text = render({
      type: "move-modifier", target: "this-unit",
      modifier: {
        applies_to_moves: ["consolidation"], distance_bonus: 3,
        ends_when: { type: "unit-state", parameters: { state: "engaged", subject: "this-unit" } },
      },
    } as Effect);
    expect(text).toContain("the extra distance applies only if");
    expect(text).toContain("and must end it there");
  });

  it("binds a make-move's engagement to the enemy unit its move ends nearest", () => {
    const text = render({
      type: "move", target: "this-unit",
      modifier: { move_type: "normal", distance: 6, ends_nearest: { of: { owner: "enemy" } }, allow_engagement: true, engaged_with: "nearest-move-end" },
    } as Effect);
    expect(text).toContain("it can end that move within Engagement Range of that enemy unit");
    expect(text).not.toContain("enemy units");
  });

  it("keeps the untargeted engagement wording when the move has no engaged_with binding", () => {
    const text = render({
      type: "move", target: "this-unit",
      modifier: { move_type: "normal", distance: 6, allow_engagement: true },
    } as Effect);
    expect(text).toContain("it can end that move within Engagement Range of enemy units");
  });
});
