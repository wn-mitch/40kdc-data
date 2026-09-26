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
      // "failed" and "all" both read "re-roll the Hit roll"; telling them apart moves conformance
      // goldens, so it waits for the four-port describer round.
      reroll: { unrendered: [], colliding: ["subset"], problems: 0 },
      // Only gains compile; losing, spending and setting a resource have no DSL fragment.
      "resource-action": { unrendered: [], colliding: [], problems: 32 },
      // The compiler writes every attachment as is-attached, which names neither.
      "leading-unit": { unrendered: ["subject", "attachment"], colliding: [], problems: 0 },
      // The bearer and this model both read "this model".
      "characteristic-set": { unrendered: [], colliding: ["subject"], problems: 0 },
      "weapon-ability-grant": { unrendered: [], colliding: ["subject"], problems: 0 },
      "feel-no-pain": { unrendered: [], colliding: ["subject"], problems: 0 },
      "invulnerable-save": { unrendered: [], colliding: ["subject"], problems: 0 },
      "fights-first": { unrendered: [], colliding: ["subject"], problems: 0 },
      // "worsen" reads as "subtract", which is wrong for AP, WS, BS, Save and Leadership.
      "characteristic-modifier": { unrendered: [], colliding: ["subject", "operation"], problems: 0 },
      "regain-wounds": { unrendered: [], colliding: ["subject"], problems: 0 },
      "act-after-move": { unrendered: [], colliding: ["subject"], problems: 0 },
      "no-advance-roll": { unrendered: [], colliding: ["subject"], problems: 0 },
      // The attack's target (defender) and the selected unit (target) both read "the target".
      "mortal-wounds": { unrendered: [], colliding: ["recipient"], problems: 0 },
      // Charged, Advanced and the other activity conditions ignore subject: target.
      "unit-activity": { unrendered: [], colliding: ["subject"], problems: 0 },
      // Who attacks and which way only show in the effect's target, not in text of their own.
      attack: { unrendered: ["direction", "unit"], colliding: [], problems: 0 },
      // Battle-shocked ignores subject: target; honouring it moves conformance goldens, so it waits
      // for the four-port describer round. Below starting and half strength already tell them apart.
      "unit-state": { unrendered: [], colliding: ["subject"], problems: 0 },
    });
  });

  it("tells the attack's target apart from this unit for every predicate but battle-shocked", () => {
    const state = leafDescriberAudit().find((item) => item.family_id === "unit-state")!;
    expect(state.collisions.every((item) => JSON.stringify(item.values) === JSON.stringify(["this-unit", "target"]) && /battle-shocked/u.test(item.text))).toBe(true);
    for (const family of ["unit-keyword", "unit-mark", "unit-position"]) {
      expect(leafDescriberAudit().find((item) => item.family_id === family)).toMatchObject({ unrendered: [], collisions: [], problems: [] });
    }
    expect(describeCondition({ type: "unit-below-starting-strength", parameters: { subject: "target" } } as never)).toBe("the target unit is below starting strength");
    expect(describeCondition({ type: "unit-below-starting-strength" } as never)).toBe("the unit is below starting strength");
  });

  it("names the hidden values of one leaf for the Leaves page", () => {
    expect(describerGaps("reroll", { roll: "hit", subset: "failed" })).toEqual(["The English reads the same for subset \"failed\" and \"all\"."]);
    expect(describerGaps("reroll", { roll: "hit", subset: "ones" })).toEqual([]);
    expect(describerGaps("attack", { direction: "makes", unit: "this-model", attack_type: "melee" })).toEqual([
      "The English never shows direction.", "The English never shows unit.",
    ]);
  });
});
