import { describe, expect, it } from "vitest";

import { describerGaps, leafDescriberAudit } from "../src/round5c/leaf-describer-audit.js";
import { describeCondition } from "../src/translate/condition.js";

describe("Round 5C leaf describer audit", () => {
  const summary = () => Object.fromEntries(leafDescriberAudit()
    .filter((family) => family.unrendered.length || family.collisions.length || family.problems.length)
    .map((family) => [family.family_id, {
      unrendered: family.unrendered,
      colliding: [...new Set(family.collisions.map((item) => item.parameter))],
      problems: family.problems.length,
    }]));

  it("pins every leaf whose English hides a parameter, so fixing or adding one shows up here", () => {
    expect(summary()).toEqual({
      // Only gains compile; losing, spending and setting a resource have no DSL fragment.
      "resource-action": { unrendered: [], colliding: [], problems: 32 },
      // It folds into the used-manoeuvre moment before it, so on its own it has no DSL fragment.
      "manoeuvre-own-roll": { unrendered: [], colliding: [], problems: 1 },
      // It folds into the windowed destruction or set-up activity before it (compile-history-window.ts), so on its own it has no DSL fragment.
      "history-window": { unrendered: [], colliding: [], problems: 3 },
      // "but if it does" folds into the move-ended moment after it (compile-passthrough-used.ts), so on its own it has no DSL fragment.
      "move-passthrough-used": { unrendered: [], colliding: [], problems: 1 },
      // Phase-edge durations compile only for the five scope.duration values; the other six
      // end-of-next-phase phase/turn pairs have no DSL scope yet.
      duration: { unrendered: [], colliding: [], problems: 6 },
      // A Leader is a model, so leading never shows the subject. Supporting compiles only for this
      // model, as part of an attached unit, which is also what attached in any role reads as; a
      // supporting unit or bearer's unit has no DSL condition. Supporting a named unit, or another
      // unit supporting, has no DSL condition (negated or not). attached_to_keywords: a led unit's
      // Leader keywords and the attached unit's keywords both read as "with".
      "leading-unit": { unrendered: [], colliding: ["subject", "attachment", "attached_to_keywords"], problems: 22 },
      // Who attacks and which way only show in the effect's target, not in text of their own.
      attack: { unrendered: ["direction", "unit"], colliding: [], problems: 0 },
      // On its own, "the attack" has no attack leaf to belong to, so it reads as the unit. weapon:
      // earlier-named reads as the weapons it changes; the English does not say they were named earlier.
      "characteristic-modifier": { unrendered: ["weapon"], colliding: ["subject"], problems: 0 },
      // "change the Damage characteristic of that attack to 1": the attack reads as the unit on its own, as above.
      "characteristic-set": { unrendered: [], colliding: ["subject"], problems: 0 },
      // A roll change's unit renders as "the unit" for every unit-ref, so a named subject reads like this unit's.
      "roll-modifier": { unrendered: [], colliding: ["subject"], problems: 0 },
      // A removal takes its recipient and weapons from the weapon-property scope before it, so alone every keyword has no recipient.
      "weapon-ability-removal": { unrendered: [], colliding: [], problems: 17 },
      // "any" and "all" rolls both read as bare "rolls"; the describer does not tell them apart.
      "ignore-modifiers": { unrendered: [], colliding: ["rolls"], problems: 0 },
      // "from" and the placement-limit fields (placement included) only render when "to" is not strategic-reserves.
      "set-up": { unrendered: [], colliding: ["from", "min_enemy_distance", "within_edge", "round_offset", "placement", "marker_inches"], problems: 0 },
      // The marker's subject (who places it) never appears in the English; distance only shows on a relocate.
      "battlefield-marker": { unrendered: ["subject"], colliding: ["distance"], problems: 0 },
      // value and rolls only render for a substitute; an add ignores both.
      "resource-die": { unrendered: [], colliding: ["value", "rolls"], problems: 0 },
      // A Stratagem's id only shows for the triggering-use wording, so other applies_to values hide it.
      "stratagem-cost": { unrendered: [], colliding: ["id"], problems: 0 },
      // with_keywords and max render only for the composition and enhancement-slot rules. A
      // detachment-tag-exclusive rule needs exactly one keyword, its tag; with none or two it refuses.
      // A faction-forbidden rule names one Army Faction; two keywords are two rules, so it refuses.
      "army-construction": { unrendered: [], colliding: ["with_keywords", "max"], problems: 4 },
      // Models that join an existing unit are not a copy, so a join carrying copy fields (excluded
      // keywords, Starting Strength, a [One Shot] reset) refuses to compile.
      "add-unit": { unrendered: [], colliding: [], problems: 165 },
      // A named weapon type takes over the phrase ("with ranged weapons"), so kind stops showing.
      // target matched-units names the set an earlier unit-position of matching-unit introduces; alone the leaf has no set, so every combination with it has no text (567).
      "targeting-restriction": { unrendered: [], colliding: ["kind"], problems: 567 },
      // Batch 6 predicates: an omitted subject defaults to "this-unit"/"the unit", which reads
      // the same as naming it explicitly, and "recipient" reads as "the unit" too.
      "unit-owner": { unrendered: [], colliding: ["subject"], problems: 0 },
      // Version 3's own ("this ability") gives the audit a value to try, which earlier versions'
      // open ability id did not; its subject collides as unit-owner's does.
      "unit-has-ability": { unrendered: [], colliding: ["subject"], problems: 0 },
      "same-unit": { unrendered: [], colliding: ["subject"], problems: 0 },
      // A mark on the selected objective marker needs the select leaf that binds the marker, so alone it
      // has no text (555 combinations); a clear reads as "no longer" and does not name its applier.
      "apply-mark": { unrendered: ["by"], colliding: [], problems: 555 },
      "wounds-state": { unrendered: [], colliding: ["subject"], problems: 0 },
      "in-region": { unrendered: [], colliding: ["subject"], problems: 0 },
      guided: { unrendered: [], colliding: ["subject"], problems: 0 },
      "moved-over": { unrendered: [], colliding: ["subject", "by"], problems: 0 },
      // "to" omitted defaults to the attacker, which reads the same as naming it explicitly.
      visible: { unrendered: [], colliding: ["subject", "to", "blocked_by"], problems: 0 },
      // Version 2/4/3 (batch 6) widen subject to also include "recipient", which reads as "the
      // unit" too — the same collision the omitted default already had with "this-unit".
      "unit-keyword": { unrendered: [], colliding: ["subject"], problems: 0 },
      // states: "in Reserves" lowers to Strategic Reserves. with: this unit and an aura's recipient both read as "the unit".
      "unit-state": { unrendered: [], colliding: ["states", "subject", "with"], problems: 0 },
      "hit-by-attacks": { unrendered: [], colliding: ["subject"], problems: 0 },
      "unit-activity": { unrendered: [], colliding: ["subject"], problems: 0 },
      // closest-eligible's "to" (default the attacker) has the same "this-unit"/"recipient" collision.
      // Version 4's `of`: "of this unit" and "of the recipient" both read "of the unit".
      "unit-position": { unrendered: [], colliding: ["subject", "to", "of"], problems: 0 },
      // Batch 7a: be-selected always reads "at the end of the opponent's previous turn", so `at`
      // never shows; the omitted-subject collision is the same one every widened predicate has.
      // into names the Transport a record's other leaves give (an antecedent, a following filter, a bound selection), or this unit;
      // a leaf alone has no unit to name for the first three, so each of those combinations is a problem on its own.
      // The event-subject subject (family-extensions-16-stratagem-target-alternatives-followup.ts) adds 132 problem
      // combinations: the same count the this-unit and this-model subjects give together (264) before it.
      // The filtered-units subject (family-extensions-20-embarked-units-state-subject-and-moves.ts) names the units of the
      // unit-filter before the leaf, so a leaf alone has no unit to name: each combination with it is a problem on its own.
      "eligibility-permission": { unrendered: [], colliding: [], problems: 1518 },
      // The filtered-units subject and the disembark mode: as above, a move alone has no filter to take its units from.
      "make-move": { unrendered: [], colliding: [], problems: 1326 },
      eligible: { unrendered: ["at"], colliding: ["subject"], problems: 0 },
      // embarked-permission takes only this-unit and gates nothing; its one leaf reads the same as none.
      "embarked-permission": { unrendered: [], colliding: [], problems: 1 },
      // count_min stops mattering once count_max is 0 ("no operation markers"), same text either way.
      "operation-markers": { unrendered: [], colliding: ["count_min"], problems: 0 },
      // Batch 7b follow-up (x-leaf-5): the schema lets move_types/action_kind pair with a `to`
      // (kind: selected) that has nothing to do with a move or an attack ("selected to shoot"
      // with a move_types filter); the describer only renders move/attack wording for the kinds
      // that call for it, so those combinations read the same regardless of the filter's value.
      // owner and subject still collide on kinds whose wording names neither. A targeting with
      // action_kind ability refuses on its own: it needs a by-ability leaf naming the selecting ability.
      // Version 19: an object antecedent (a targeted unit an aura named) and owner any refuse on a
      // targeting without that aura, or without its selecting ability, as the ability values do.
      // 80 of these are a single roll of any / attacks / all / surge / resource-die on a before-roll or after-roll
      // moment: valid stored leaves (the roll-list widening keeps the previous enum) that a DSL trigger cannot name,
      // so the compiler refuses them with "name the roll kinds it covers".
      event: { unrendered: [], colliding: ["object", "owner", "subject", "move_types", "action_kind"], problems: 104 },
      // An aura's recipient and this unit both read "the unit".
      "ability-used": { unrendered: [], colliding: ["subject"], problems: 0 },
      // test-exemption@2's target enum: "this-unit"/"recipient" both read "the unit", and
      // "event-object"/"stratagem-target" both read "that unit" — the same "this-unit"/
      // "recipient" collision every widened subject-like enum in this file already has.
      "test-exemption": { unrendered: [], colliding: ["target"], problems: 0 },
    });
  });

  it("tells the attack's target apart from this unit for every predicate", () => {
    for (const family of ["unit-mark"]) {
      expect(leafDescriberAudit().find((item) => item.family_id === family)).toMatchObject({ unrendered: [], collisions: [], problems: [] });
    }
    expect(describeCondition({ type: "strength", parameters: { subject: "defender", below: "starting" } } as never)).toBe("the target unit is below starting strength");
    expect(describeCondition({ type: "unit-state", parameters: { subject: "attacker", state: "battle-shocked" } } as never)).toBe("the attacking unit is Battle-shocked");
    // Engagement Range names the target too, not only this unit.
    expect(describeCondition({ type: "unit-state", parameters: { subject: "defender", state: "engaged" } } as never)).toBe("the target unit is engaged");
    expect(describeCondition({ type: "strength", parameters: { below: "starting" } } as never)).toBe("the unit is below starting strength");
  });

  it("names the hidden values of one leaf for the Leaves page", () => {
    expect(describerGaps("reroll", { roll: "hit", subset: "failed" })).toEqual([]);
    expect(describerGaps("characteristic-modifier", { subject: "attack", characteristics: ["M"], operation: "add", value: 1, weapon_type: "all" }))
      .toEqual(["The English reads the same for subject \"this-unit\" and \"attack\"."]);
    expect(describerGaps("attack", { direction: "makes", unit: "this-model", attack_type: "melee" })).toEqual([
      "The English never shows direction.", "The English never shows unit.",
    ]);
  });
});
