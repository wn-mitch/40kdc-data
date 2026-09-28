import { describe, expect, it } from "vitest";

import type { BuffSource, EngineContext } from "../src/cruncher/buffs.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { usageGated } from "../src/data/entities.js";
import { describeAbility, describeCondition, type Effect } from "../src/translate/index.js";
import { describeTrigger } from "../src/translate/trigger.js";

/**
 * Describer and cruncher pins for the phase-4 shapes. Each render is the sentence a player
 * reads; each cruncher case pins whether the shape may become a buff (and why not).
 */
function render(effect: unknown, extra: Record<string, unknown> = {}): string {
  return describeAbility({ effect, scope: { duration: "permanent" }, ...extra } as Parameters<typeof describeAbility>[0]);
}
const leaf = (type: string, modifier: Record<string, unknown>, target: unknown = "this-unit", extra: Record<string, unknown> = {}) => ({ type, target, modifier, ...extra });
const BATTLE_SIZE = { incursion: 1, "strike-force": 2, onslaught: 3 };

describe("describer: geometry and relations", () => {
  it("says wholly within for a wholly aura filter and a wholly selection", () => {
    expect(render(leaf("feel-no-pain", { threshold: 6, against: "mortal" }, { owner: "friendly", all_of: ["GREY KNIGHTS"], within: { range: { inches: 6 }, wholly: true } }))).toBe(
      'Friendly GREY KNIGHTS units wholly within 6" have the Feel No Pain 6+ ability against mortal wounds.',
    );
    expect(render({ type: "select-units", selector: { owner: "friendly", count: 1, keywords: ["YNNARI", "INFANTRY"], within_inches: 6, wholly: true }, effect: leaf("move", { move_type: "embark" }, "selected-unit") })).toBe(
      'Select one friendly YNNARI INFANTRY unit wholly within 6": that unit can embark.',
    );
  });

  it("reads engagement relations after the range, with 'other' for the unit's own exclusion", () => {
    const target = { owner: "enemy", within: { range: "engagement", of: "this-model" }, not_engaged_with: { owner: "friendly", excluding: "this-unit" } };
    expect(render(leaf("targeting", { by: "this-model", may: "target", target }, "this-model"))).toBe(
      "This model can target enemy units within Engagement Range of this model that are not within Engagement Range of any other friendly unit.",
    );
  });

  it("names passengers, the bearer's Transport, the centre of the battlefield and abilities a unit lacks", () => {
    expect(render(leaf("move", { move_type: "disembark", mode: "assault" }, { owner: "friendly", embarked_in: "this-unit" }))).toBe(
      "Friendly units embarked within the unit can disembark using the Assault Disembarkation rules.",
    );
    expect(render(leaf("ability-grant", { ability: "scouts", value: 9 }, "bearer-transport"))).toBe('The Transport this unit is embarked within gains the Scouts 9" ability.');
    expect(render({ type: "conditional", condition: { type: "within", parameters: { subject: "this-model", of: "battlefield-centre", range: { inches: 6 } } }, effect: leaf("feel-no-pain", { threshold: 4 }, "this-model") })).toBe(
      'While this model is within 6" of the centre of the battlefield, this model has the Feel No Pain 4+ ability.',
    );
    expect(describeCondition({ type: "within", parameters: { of: { owner: "friendly", all_of: ["INFANTRY"], lacks_ability: ["lone-operative"] }, range: { inches: 3 } } })).toBe(
      'the unit is within 3" of a friendly INFANTRY unit without the Lone Operative ability',
    );
  });

  it("joins placement limits with 'and' and reads a bare enemy filter as all enemy models", () => {
    expect(render(leaf("set-up", { to: "battlefield", from: "strategic-reserves", via: "deep-strike", in_region: { region: { rule_region: { region_id: "flow-of-magic" } }, wholly: true }, away_from: [{ of: { owner: "enemy" }, range: { inches: 6 } }] }))).toBe(
      'The unit can be set up on the battlefield from Strategic Reserves using the Deep Strike rules wholly within Flow of Magic and more than 6" away from all enemy models.',
    );
    expect(render(leaf("set-up", { to: "battlefield", from: "strategic-reserves", away_from: [{ of: { owner: "enemy", designated: "afflicted" }, range: { inches: 6 } }, { of: { owner: "enemy", not_designated: "afflicted" }, range: { inches: 8 } }] }))).toBe(
      'The unit can be set up on the battlefield from Strategic Reserves more than 6" away from enemy units that are Afflicted and 8" away from enemy units that are not Afflicted.',
    );
    expect(render(leaf("return-models", { count: 1, wounds_remaining: "D3", placement: ["closest-to-destruction", "unengaged"], detach: true, starting_strength: 1 }, "this-model"))).toBe(
      "This model is set up again as close as possible to where it was destroyed and not within Engagement Range of any enemy units with D3 wounds remaining, as a separate unit with a Starting Strength of 1 (it is no longer part of its attached unit).",
    );
  });
});

describe("describer: the ability's own unit inside a selection (ability-unit)", () => {
  const hitBy = (subject: string) => ({ type: "select-units", selector: { owner: "enemy", count: 1, eligibility: { type: "happened", parameters: { event: "after-roll", subject, object: "this-unit", filter: { roll: "hit", result: "success" }, window: "phase" } } }, effect: leaf("test", { test: "battle-shock" }, "selected-unit") });

  it("names the attacking unit when it is the ability's unit, not the candidate", () => {
    expect(render(hitBy("ability-unit"))).toBe("Select one enemy unit that was hit by an attack made by this unit this phase: that unit must take a Battle-shock test.");
    // this-unit inside eligibility is the candidate itself: no attacker is named.
    expect(render(hitBy("this-unit"))).toBe("Select one enemy unit that was hit by an attack this phase: that unit must take a Battle-shock test.");
  });

  it("is the buffed unit for the cruncher", () => {
    const result = effectToBuffs(leaf("re-roll", { roll: "hit", subset: "ones" }, "ability-unit"), { kind: "ability", abilityId: "x", abilityKind: "unit" }, { phase: "shooting" });
    expect(result.applied.map((b) => b.contribution)).toEqual([{ type: "reroll", roll: "hit", subset: "ones" }]);
  });
});

describe("describer: movement", () => {
  it("renders counts-as moves, engagement, mandatory and next-phase arrivals", () => {
    expect(render(leaf("permission", { activity: "disembark", allow: true, after: ["advance"], counts_as_move: "normal" }, "stratagem-target"))).toBe(
      "That unit is eligible to disembark in a turn in which it Advanced; if it does, it counts as having made a Normal move this turn.",
    );
    expect(render(leaf("move", { move_type: "disembark", ends_within: { range: { inches: 6 }, of: "this-unit", wholly: true }, allow_engagement: true }, "selected-unit"))).toBe(
      'The selected unit can disembark, ending that move wholly within 6" of the unit; it can end that move within Engagement Range of enemy units.',
    );
    expect(render(leaf("set-up", { to: "strategic-reserves", mandatory: true }, "this-model"))).toBe("This model must be placed into Strategic Reserves.");
    expect(render(leaf("set-up", { to: "battlefield", from: "strategic-reserves", arrives: "next-movement-phase", allow_first_round: true }))).toBe(
      "The unit can be set up on the battlefield from Strategic Reserves in the Reinforcements step of your next Movement phase (even in the first battle round).",
    );
  });

  it("renders typed pass-through items and the moved-over predicate", () => {
    expect(render(leaf("move-modifier", { applies_to_moves: ["charge"], passthrough: [{ kind: "models", excluding: ["MONSTER", "VEHICLE"] }, { kind: "terrain", height: "up-to-4" }] }))).toBe(
      'The unit can move over models (excluding MONSTER and VEHICLE models) and terrain features 4" or lower as though they were not there, during its Charge moves.',
    );
    expect(describeCondition({ type: "moved-over", parameters: { by: "this-model" } })).toBe("the unit was moved over by this model during that move");
  });
});

describe("describer: dice", () => {
  it("shares one bound roll between consumers", () => {
    const effect = { type: "roll", dice: "D3", roll_var: "absorbed", effect: { type: "sequence", steps: [
      leaf("mortal-wounds", { count: { roll_var: "absorbed" } }, "selected-unit"), leaf("heal", { amount: { roll_var: "absorbed" } }, "this-model")] } };
    expect(render(effect)).toBe(
      "Roll D3, then:\n  -> The selected unit suffers a number of mortal wounds equal to the result of that roll.\n  -> This model regains up to a number of lost wounds equal to the result of that roll.",
    );
  });

  it("renders Blessings of Khorne as a variable-count roll allocated to named options", () => {
    const effect = { type: "roll", dice: "8D6", extra_dice_pool: "blessings-of-khorne-pool", kind: "blessings-of-khorne", roll_var: "bok",
      effect: { type: "choice", min_choices: 0, max_choices: 2, options: [
        { type: "ability-part", name: "Unbridled Bloodlust", effect: { type: "dice-gated", from: { roll_var: "bok" }, requirement: { type: "pair", min_value: 1 }, on_success: leaf("roll-modifier", { roll: "charge", operation: "add", value: 1 }, { owner: "friendly" }) } },
        { type: "ability-part", name: "Total Carnage", effect: { type: "dice-gated", from: { roll_var: "bok" }, requirement: { any_of: [{ type: "pair", min_value: 6 }, { type: "triple", min_value: 3 }] }, on_success: { type: "no-effect" } } }] } };
    const text = render(effect);
    expect(text).toContain("Roll 8D6, plus one D6 for each die in your Blessings of Khorne pool (a Blessings of Khorne roll), then:");
    expect(text).toContain("Use Unbridled Bloodlust: using a pair of 1+ from that roll's unused dice, all friendly units get +1 to Charge rolls.");
    expect(text).toContain("using a pair of 6+ or triple of 3+ from that roll's unused dice");
  });

  it("names a dice gate's roll kind and drops the article from a counted dice expression", () => {
    expect(render({ type: "dice-gated", dice: "2D6", kind: "psychic", threshold: 5, on_success: leaf("mortal-wounds", { count: "D3" }, "selected-unit") })).toBe(
      "Roll 2D6 (a Psychic test): on a 5+, the selected unit suffers D3 mortal wounds.",
    );
  });

  it("renders an ability's own roll, unmodified results, fail thresholds and mandatory re-rolls", () => {
    expect(render(leaf("roll-modifier", { roll: { of_ability: "reanimation-protocols" }, operation: "add", value: 1 }))).toBe("The unit gets +1 to Reanimation Protocols rolls.");
    expect(render(leaf("roll-result", { roll: "hit", result: 6, unmodified: true }))).toBe("The unit's Hit rolls count as an unmodified 6.");
    expect(render(leaf("roll-result", { roll: "hit", fails_on: 3, weapon_type: "ranged", incoming: true }))).toBe(
      "Each time a ranged attack targets the unit, an unmodified Hit roll of 1-3 for that attack always fails.",
    );
    expect(render(leaf("re-roll", { roll: "hit", subset: "ones", mandatory: true }, "event-subject"))).toBe("You must re-roll a Hit roll of 1 for attacks made by the triggering unit.");
    expect(render(leaf("resource-spend", { pool: "blessings-of-khorne-pool", amount: 3, requirement: { type: "triple", min_value: 6 } }))).toBe("Spend 3 Blessings of Khorne dice forming a triple of 6+.");
    expect(render(leaf("resource-spend", { pool: "fate-dice-pool", amount: 1, face: 4 }))).toBe("Spend 1 Fate die showing a 4.");
  });
});

describe("describer: battle size and counts", () => {
  it("prints one value per battle size", () => {
    expect(render(leaf("resource-gain", { pool: "battle-focus-pool", amount: { incursion: 2, "strike-force": 4, onslaught: 6 }, label: "Battle Focus token" }, "this-model"))).toBe(
      "You gain 2/4/6 Battle Focus tokens (Incursion/Strike Force/Onslaught).",
    );
    expect(render({ type: "select-units", selector: { owner: "enemy", max_count: BATTLE_SIZE }, effect: leaf("designate", { subject: "selected-unit", tag: "afflicted" }, "selected-unit") })).toBe(
      "Select up to 1/2/3 enemy units (Incursion/Strike Force/Onslaught): that unit is Afflicted.",
    );
    expect(render({ type: "conditional", condition: { type: "battle-size", parameters: { size: "incursion" } }, effect: leaf("add-unit", { datasheet: "poxwalkers", count: 1, starting_strength: 10, placement: "strategic-reserves" }) })).toBe(
      "If the battle size is Incursion, add a Poxwalkers unit with a Starting Strength of 10 to your army in Strategic Reserves.",
    );
  });

  it("prints counts and board scaling sources", () => {
    expect(render({ type: "select-units", selector: { owner: "friendly", keywords: ["ORKS"], max_count: { count_of: "battle-round" } }, effect: { type: "no-effect" } })).toBe(
      "Select any number of friendly ORKS units (at most the battle round number): nothing happens.",
    );
    expect(render(leaf("return-models", { count: { count_of: "models-in-bearer-unit", keyword: "SPYDER" } }, "selected-unit"))).toBe(
      "Return a number of destroyed models equal to the number of SPYDER models in this unit to the selected unit, each with its full wounds remaining.",
    );
    expect(render(leaf("stat-modifier", { stat: "OC", operation: "add", value: 1 }, "this-model", { scaling: { per: 1, of: "embarked-models-oc" } }))).toBe(
      "Add 1 to this model's Objective Control characteristic for every point of Objective Control of the models embarked within this model.",
    );
  });
});

describe("describer: abilities, rules and army", () => {
  it("renders the ability-modifier limits and ability-activate selection", () => {
    expect(render(leaf("ability-modifier", { ability: "killing-blow", aspect: "end-round", operation: "set", value: 4 }))).toBe("The last battle round of the unit's Killing Blow ability is 4.");
    expect(render(leaf("ability-modifier", { ability: "overkill", aspect: "uses", operation: "set", value: 2, cap_per: { count: 1, period: "battle-round" } }, "this-model"))).toBe(
      "The number of uses of this model's Overkill ability is 2, but it can be used at most once per battle round.",
    );
    expect(render(leaf("ability-modifier", { ability: { event: "used" }, aspect: "uses", operation: "add", value: 1, not_same: "phase" }, "stratagem-target"))).toBe(
      "Increase the number of uses of that ability by 1, but not in the same phase as the use that triggered this.",
    );
    expect(render(leaf("ability-activate", { ability: "blessings-of-khorne", select: { by: "roll" } }))).toBe(
      "Make a new Blessings of Khorne roll and activate one result it allows for the unit, in addition to any already active.",
    );
    expect(render(leaf("ability-activate", { ability: "reanimation-protocols", override: { amount: "D6" } }))).toBe("The unit resolves the Reanimation Protocols ability now, using D6 in place of its usual amount.");
  });

  it("joins a usage list into one lead", () => {
    expect(render(leaf("mortal-wounds", { count: "D3+3" }, "event-subject"), { usage: [{ frequency: "n-per-battle", count: 1, per: "model" }, { frequency: "once-per-battle-round", per: "army" }] })).toBe(
      "Once per battle per model and once per battle round per army, the triggering unit suffers D3+3 mortal wounds.",
    );
  });

  it("renders the new core-rule slugs, expiries and test exemption", () => {
    expect(render(leaf("rule-state", { direction: "suppressed", rule_kind: "core-rule", rule: "engaged-shooting-hit-penalty" }, "this-model"))).toBe(
      "This model does not suffer the -1 to Hit for shooting while within Engagement Range.",
    );
    expect(render(leaf("rule-state", { direction: "suppressed", rule_kind: "core-rule", rule: "orders-end-on-battle-shock" }))).toBe("The unit keeps its Orders when it becomes Battle-shocked.");
    expect(render(leaf("stat-modifier", { stat: "Ld", operation: "subtract", value: 1 }, "selected-unit"), { scope: { duration: "until-next-shooting-phase" } })).toBe(
      "Until the start of your next Shooting phase, subtract 1 from the selected unit's Leadership characteristic.",
    );
    expect(render(leaf("designate", { subject: "selected-unit", tag: "assailed", clears_on: "until-end-of-opponent-next-turn" }))).toBe(
      "The selected unit is marked as assailed until the end of your opponent's next turn.",
    );
    expect(render(leaf("test-exemption", { test: "battle-shock", window: "phase" }))).toBe("The unit does not need to take any further Battle-shock tests this phase.");
  });

  it("renders the army rules and composition limits", () => {
    expect(render(leaf("army-rule", { rule: "composition", with: { all_of: ["INQUISITORIAL AGENTS"] }, max: 1, per: { all_of: ["INQUISITOR"] }, exempt_from: ["retinue-limit"] }))).toBe(
      "Your army can include at most 1 INQUISITORIAL AGENTS unit for each INQUISITOR unit in your army; they do not count toward the Retinue limit.",
    );
    expect(render(leaf("army-rule", { rule: "detachment-forbidden", detachment: "1st-company-task-force" }))).toBe("You cannot select the 1st Company Task Force Detachment.");
    expect(render(leaf("army-rule", { rule: "attachment", attach_as: { all_of: ["BATTLE SISTERS SQUAD"] } }))).toBe(
      "A Leader that can be attached to BATTLE SISTERS SQUAD units can also be attached to the unit.",
    );
    expect(describeCondition({ type: "army-faction", parameters: { faction: "necrons" } })).toBe("your Army Faction is NECRONS");
  });

  it("renders the D18 shapes", () => {
    expect(render(leaf("datasheet-swap", { datasheet: "blue-horrors" }))).toBe("The unit uses the Blue Horrors datasheet from now on, keeping its lost wounds and its position.");
    expect(render(leaf("characteristic-resolution", { stat: "T", rule: "majority", tie: "highest", applies_to: "wound-roll", incoming: true }))).toBe(
      "Each time an attack targets the unit, use the Toughness characteristic of the majority of its models (if tied, the highest) to determine the Wound roll.",
    );
    expect(render(leaf("borrow-weapons", { from: { embarked_in: "this-unit" }, max_models: 2, weapon_type: "ranged", exclude_weapon_keyword: ["ONE SHOT"], until: "attack-sequence" }))).toBe(
      "The unit can use one ranged weapon (excluding [ONE SHOT] weapons) from each of up to 2 models embarked within the unit until that unit finishes resolving its attacks; those models cannot shoot.",
    );
    expect(render(leaf("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_type: "ranged", weapon_ref: { selected_by: { ability: "firing-deck" } } }))).toBe(
      "The unit gets +1 to Hit rolls with the ranged weapons selected for Firing Deck.",
    );
    expect(render(leaf("targeting", { by: "event-subject", may: "redirect", target: { owner: "friendly", all_of: ["ANATHEMA PSYKANA"] }, to: "this-unit", if_eligible: true, kind: "attack" }, "attacker"))).toBe(
      "Attacks made by the triggering unit that target a friendly ANATHEMA PSYKANA unit must target the unit instead, if the unit is an eligible target.",
    );
    expect(render(leaf("targeting", { by: { owner: "friendly" }, may: "cannot-target", target: "this-model", kind: "stratagem", except: "core-stratagems" }, "this-model"))).toBe(
      "Friendly units cannot target this model with Stratagems (Core Stratagems can still target it).",
    );
    expect(render(leaf("counts-as", { within: "aura", of: { stratagem_target: "abhorrent" } }, { stratagem_target: "war-dogs" }))).toBe(
      "The war dogs target counts as being within its aura range of the abhorrent target.",
    );
    expect(render({ type: "select-objective", selector: { count: 1, range: "objective-control", origin: "bearer-unit", controlled_by: "your-army", bind_as: "m" }, effect: leaf("designate", { subject: { objective: { selection_var: "m" } }, tag: "mutated", clears_on: "control-lost" }) })).toBe(
      "Select one objective marker you control that the bearer's unit is within range of: that objective marker is marked as mutated until you no longer control it.",
    );
    expect(render({ type: "aura", target: "enemy-within-aura", modifier: { range: 3, range_cap: 12, emitter_filter: { required_keywords: ["DEATH GUARD"] }, effect: leaf("designate", { subject: "recipient", tag: "afflicted" }, "recipient") } })).toBe(
      'While an enemy unit is within 3" (to a maximum of 12", extensions included) of this model with DEATH GUARD, that unit is Afflicted.',
    );
  });

  it("prints the rules' term for registered designations and the designator (D5, D14)", () => {
    expect(render(leaf("designate", { subject: "selected-unit", tag: "spotted", by: "this-unit", clears_on: "phase" }))).toBe("The selected unit is Spotted by the unit until the end of the phase.");
    expect(describeCondition({ type: "guided", parameters: {} })).toBe("the unit is Guided");
    expect(describeCondition({ type: "designated", parameters: { subject: "defender", tag: "spotted", by: { designated: "observer", all_of: ["MARKERLIGHT"] } } })).toBe(
      "the target unit is Spotted by a MARKERLIGHT unit that is an Observer",
    );
  });

  it("names a Bondsman-keyword use, the same rule as a bound use, and the Reinforcements step", () => {
    expect(describeTrigger({ event: "used", subject: { owner: "friendly" }, filter: { kind: "ability", ability_keyword: "BONDSMAN" } } as never)).toBe("each time a friendly unit uses a Bondsman ability");
    expect(describeCondition({ type: "happened", parameters: { event: "used", filter: { kind: "ability", same_rule_as: { event_var: "b" } }, window: "turn" } })).toBe("the unit used that same ability this turn");
    expect(describeTrigger({ event: "step-started", filter: { step: "reinforcements" } } as never)).toBe("at the start of the Reinforcements step");
  });
});

const source: BuffSource = { kind: "ability", abilityId: "blessings-of-khorne", abilityKind: "army" };
const ctx: EngineContext = { phase: "fight", attackerStationary: false };

describe("cruncher: phase-4 shapes", () => {
  const option = (name: string, requirement: unknown, effect: unknown) => ({ name, requirement, effect });
  const wrap = (name: string, requirement: unknown, effect: unknown) => ({ type: "ability-part", name, effect: { type: "dice-gated", from: { roll_var: "bok" }, requirement, on_success: effect } });
  const warpBlades = leaf("weapon-ability-grant", { abilities: ["Lethal Hits"], weapon_type: "melee" }, { owner: "friendly" });
  const bloodlust = leaf("roll-modifier", { roll: "wound", operation: "add", value: 1, weapon_type: "melee" }, { owner: "friendly" });

  it("keeps the Blessings of Khorne levers when the dice pool is re-encoded as a roll (D3)", () => {
    const pool = { type: "dice-pool-allocation", pool: { count: 8, die: "D6" }, max_activations: 2, options: [option("Warp Blades", { type: "pair", min_value: 4 }, warpBlades), option("Wrathful Devotion", { type: "pair", min_value: 5 }, bloodlust)] };
    const roll = { type: "roll", dice: "8D6", extra_dice_pool: "blessings-of-khorne-pool", roll_var: "bok", effect: { type: "choice", min_choices: 0, max_choices: 2, options: [wrap("Warp Blades", { type: "pair", min_value: 4 }, warpBlades), wrap("Wrathful Devotion", { type: "pair", min_value: 5 }, bloodlust)] } };
    const before = effectToBuffs(pool, source, ctx);
    const after = effectToBuffs(roll, source, ctx);
    expect(after.activatable.map((a) => [a.id, a.label, a.group])).toEqual(before.activatable.map((a) => [a.id, a.label, a.group]));
    expect(after.activatable.map((a) => a.buffs.map((b) => b.contribution))).toEqual(before.activatable.map((a) => a.buffs.map((b) => b.contribution)));
    expect(after.activatable).toHaveLength(2);
    expect(after.applied).toEqual([]);
  });

  it("does not apply a value it cannot size: a bound roll, a battle-size value, a count or a scaling", () => {
    const cases: [unknown, RegExp][] = [
      [{ type: "roll", dice: "D3", roll_var: "r", effect: leaf("stat-modifier", { stat: "A", operation: "add", value: { roll_var: "r" } }) }, /value is set by a bound roll/],
      [leaf("stat-modifier", { stat: "A", operation: "add", value: BATTLE_SIZE }), /value is set by the battle size/],
      [leaf("stat-modifier", { stat: "A", operation: "add", value: { count_of: "battle-round" } }), /value is set by the number of battle-round/],
      [leaf("stat-modifier", { stat: "A", operation: "add", value: 2 }, "this-unit", { scaling: { per: 1, of: "models-embarked-in-bearer", max_value: 22 } }), /scales with models-embarked-in-bearer/],
    ];
    for (const [effect, reason] of cases) {
      const result = effectToBuffs(effect, source, ctx);
      expect(result.applied).toEqual([]);
      expect(result.unsupported.map((u) => u.reason).join("\n")).toMatch(reason);
    }
  });

  it("does not widen a bound-weapon buff to every weapon", () => {
    const result = effectToBuffs(leaf("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_ref: { weapon_var: "blade" } }), source, ctx);
    expect(result.applied).toEqual([]);
    expect(result.unsupported[0]!.reason).toMatch(/weapon_ref/);
  });

  it("gates an ability with a usage list like one with a single limit", () => {
    const effect = leaf("roll-modifier", { roll: "hit", operation: "add", value: 1 });
    const list = usageGated("unit", [{ frequency: "n-per-battle", count: 1, per: "model" }, { frequency: "once-per-battle-round", per: "army" }], effect);
    expect(list).toEqual(usageGated("unit", { frequency: "n-per-battle", count: 1 }, effect));
    expect(list).not.toEqual(effect);
  });

  it("keeps a mandatory re-roll of 1s as the same re-roll buff", () => {
    const result = effectToBuffs(leaf("re-roll", { roll: "hit", subset: "ones", mandatory: true }), source, ctx);
    expect(result.applied.map((b) => b.contribution)).toEqual([{ type: "reroll", roll: "hit", subset: "ones" }]);
  });

  it("evaluates army-faction, battle-size and guided from the context, else reports them", () => {
    const gated = (condition: unknown) => ({ type: "conditional", condition, effect: leaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }) });
    const faction = gated({ type: "army-faction", parameters: { faction: "tau-empire" } });
    expect(effectToBuffs(faction, source, { ...ctx, armyFaction: "tau-empire" }).applied).toHaveLength(1);
    expect(effectToBuffs(faction, source, { ...ctx, armyFaction: "necrons" }).applied).toHaveLength(0);
    expect(effectToBuffs(faction, source, ctx).unsupported[0]!.reason).toMatch(/army-faction/);
    const size = gated({ type: "battle-size", parameters: { size: "onslaught" } });
    expect(effectToBuffs(size, source, { ...ctx, battleSize: "onslaught" }).applied).toHaveLength(1);
    expect(effectToBuffs(size, source, { ...ctx, battleSize: "incursion" }).applied).toHaveLength(0);
    const guided = gated({ type: "guided", parameters: {} });
    expect(effectToBuffs(guided, source, { ...ctx, attackerGuided: true }).applied).toHaveLength(1);
    expect(effectToBuffs(guided, source, { ...ctx, attackerGuided: false }).applied).toHaveLength(0);
    expect(effectToBuffs(guided, source, ctx).unsupported[0]!.reason).toMatch(/guided/);
  });

  it("names an ability's own roll in its diagnostic and reports the D18 leaves", () => {
    const own = effectToBuffs(leaf("roll-modifier", { roll: { of_ability: "reanimation-protocols" }, operation: "add", value: 1 }), source, ctx);
    expect(own.unsupported[0]!.reason).toBe('roll-modifier on "reanimation-protocols roll" is outside the damage path');
    for (const type of ["characteristic-resolution", "borrow-weapons", "select-weapon"]) {
      const result = effectToBuffs(leaf(type, { stat: "T", rule: "highest", max_models: 2, bind_as: "b" }), source, ctx);
      expect(result.applied).toEqual([]);
      expect(result.unsupported[0]!.reason.startsWith(`${type}:`)).toBe(true);
    }
    const objective = effectToBuffs({ type: "select-objective", selector: { count: 1, bind_as: "o" }, effect: leaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }) }, source, ctx);
    expect(objective.applied).toEqual([]);
    expect(objective.unsupported[0]!.reason).toMatch(/^select-objective:/);
  });
});

// Type-level guard: the Effect view accepts the new container fields.
const _roll: Effect = { type: "roll", dice: "D3", roll_var: "r", effect: { type: "no-effect" } };
void _roll;
