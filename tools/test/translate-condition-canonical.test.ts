import { describe, expect, it } from "vitest";
import { describeCondition, type Condition } from "../src/translate/condition.js";
import { conditionLeadIn, describeSelectionEligibility } from "../src/translate/condition-leadin.js";
import { countPhrase, objectivePhrase, placeRefPhrase, rangePhrase, unitFilterPhrase } from "../src/translate/condition-refs.js";
import { describeTrigger } from "../src/translate/trigger.js";
import { expiryTrail } from "../src/translate/expiry.js";

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
    expect(objectivePhrase({ controlled_by: "friendly", within: { range: "objective-control", of: "this-unit" } })).toBe("objective you control within range of the unit");
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
