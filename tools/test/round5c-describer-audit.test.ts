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
      // A Leader is a model, so the subject never shows. Supporting compiles only for this model
      // (as part of an attached unit); a supporting unit or bearer's unit has no DSL condition.
      "leading-unit": { unrendered: ["subject"], colliding: [], problems: 2 },
      // Who attacks and which way only show in the effect's target, not in text of their own.
      attack: { unrendered: ["direction", "unit"], colliding: [], problems: 0 },
      // On its own, "the attack" has no attack leaf to belong to, so it reads as the unit.
      "characteristic-modifier": { unrendered: [], colliding: ["subject"], problems: 0 },
      // "any" and "all" rolls both read as bare "rolls"; the describer does not tell them apart.
      "ignore-modifiers": { unrendered: [], colliding: ["rolls"], problems: 0 },
      // "from" and the placement-limit fields only render when "to" is not strategic-reserves.
      "set-up": { unrendered: [], colliding: ["from", "min_enemy_distance", "within_edge", "round_offset"], problems: 0 },
      // The marker's subject (who places it) never appears in the English; distance only shows on a relocate.
      "battlefield-marker": { unrendered: ["subject"], colliding: ["distance"], problems: 0 },
      // value and rolls only render for a substitute; an add ignores both.
      "resource-die": { unrendered: [], colliding: ["value", "rolls"], problems: 0 },
      // A Stratagem's id only shows for the triggering-use wording, so other applies_to values hide it.
      "stratagem-cost": { unrendered: [], colliding: ["id"], problems: 0 },
      // with_keywords and max render only for the composition and enhancement-slot rules.
      "army-construction": { unrendered: [], colliding: ["with_keywords", "max"], problems: 0 },
      // A named weapon type takes over the phrase ("with ranged weapons"), so kind stops showing.
      "targeting-restriction": { unrendered: [], colliding: ["kind"], problems: 0 },
      // Batch 6 predicates: an omitted subject defaults to "this-unit"/"the unit", which reads
      // the same as naming it explicitly, and "recipient" reads as "the unit" too.
      "unit-owner": { unrendered: [], colliding: ["subject"], problems: 0 },
      "same-unit": { unrendered: [], colliding: ["subject"], problems: 0 },
      "wounds-state": { unrendered: [], colliding: ["subject"], problems: 0 },
      "in-region": { unrendered: [], colliding: ["subject"], problems: 0 },
      guided: { unrendered: [], colliding: ["subject"], problems: 0 },
      "moved-over": { unrendered: [], colliding: ["subject", "by"], problems: 0 },
      // "to" omitted defaults to the attacker, which reads the same as naming it explicitly.
      visible: { unrendered: [], colliding: ["subject", "to", "blocked_by"], problems: 0 },
      // Version 2/4/3 (batch 6) widen subject to also include "recipient", which reads as "the
      // unit" too — the same collision the omitted default already had with "this-unit".
      "unit-keyword": { unrendered: [], colliding: ["subject"], problems: 0 },
      "unit-state": { unrendered: [], colliding: ["subject"], problems: 0 },
      "unit-activity": { unrendered: [], colliding: ["subject"], problems: 0 },
      // closest-eligible's "to" (default the attacker) has the same "this-unit"/"recipient" collision.
      "unit-position": { unrendered: [], colliding: ["subject", "to"], problems: 0 },
      // Batch 7a: be-selected always reads "at the end of the opponent's previous turn", so `at`
      // never shows; the omitted-subject collision is the same one every widened predicate has.
      eligible: { unrendered: ["at"], colliding: ["subject"], problems: 0 },
      // count_min stops mattering once count_max is 0 ("no operation markers"), same text either way.
      "operation-markers": { unrendered: [], colliding: ["count_min"], problems: 0 },
      // Batch 7b follow-up (x-leaf-5): the schema lets move_types/action_kind pair with a `to`
      // (kind: selected) that has nothing to do with a move or an attack ("selected to shoot"
      // with a move_types filter); the describer only renders move/attack wording for the kinds
      // that call for it, so those combinations read the same regardless of the filter's value.
      event: { unrendered: [], colliding: ["move_types", "action_kind"], problems: 0 },
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
