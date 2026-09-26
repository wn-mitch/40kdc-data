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
      // The compiler writes every attachment as is-attached, which names neither.
      "leading-unit": { unrendered: ["subject", "attachment"], colliding: [], problems: 0 },
      // Who attacks and which way only show in the effect's target, not in text of their own.
      attack: { unrendered: ["direction", "unit"], colliding: [], problems: 0 },
      // Engagement Range ignores subject: target in the describer (all four ports).
      "unit-state": { unrendered: [], colliding: ["subject"], problems: 0 },
      // On its own, "the attack" has no attack leaf to belong to, so it reads as the unit.
      "characteristic-modifier": { unrendered: [], colliding: ["subject"], problems: 0 },
    });
  });

  it("tells the attack's target apart from this unit for every predicate", () => {
    for (const family of ["unit-keyword", "unit-mark", "unit-position", "unit-activity"]) {
      expect(leafDescriberAudit().find((item) => item.family_id === family)).toMatchObject({ unrendered: [], collisions: [], problems: [] });
    }
    expect(describeCondition({ type: "unit-below-starting-strength", parameters: { subject: "target" } } as never)).toBe("the target unit is below starting strength");
    expect(describeCondition({ type: "is-battle-shocked", parameters: { subject: "attacker" } } as never)).toBe("the attacking unit is battle-shocked");
    expect(describeCondition({ type: "unit-below-starting-strength" } as never)).toBe("the unit is below starting strength");
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
