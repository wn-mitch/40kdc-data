import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { dropOwnSideRestatements } from "../src/semantic-authoring/compile-owner-restatement.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// Fabricated wording in the shape of "Once per battle round, one unit from your army with this ability can use it …".
const OWN_SIDE = { type: "matches", parameters: { filter: { owner: "friendly" } } };
const KEYWORD = { type: "matches", parameters: { subject: "this-unit", filter: { all_of: ["INFANTRY"] } } };
const EFFECT = { type: "cost-modifier", target: "this-unit", modifier: { of: "stratagem", operation: "decrease", amount: 1 } };

describe("a 'from your army' that restates the holder's side", () => {
  it("drops the subjectless owner operand and keeps the other gates", () => {
    const tree = { type: "conditional", condition: { operator: "and", operands: [OWN_SIDE, KEYWORD] }, effect: EFFECT };
    expect(dropOwnSideRestatements(tree)).toEqual({ type: "conditional", condition: KEYWORD, effect: EFFECT });
  });

  it("unwraps a conditional the restatement alone gated", () => {
    expect(dropOwnSideRestatements({ type: "sequence", steps: [{ type: "conditional", condition: OWN_SIDE, effect: EFFECT }] }))
      .toEqual({ type: "sequence", steps: [EFFECT] });
  });

  it("keeps an enemy owner, a subject, and anything inside a for-each body or a selector", () => {
    const enemy = { type: "conditional", condition: { type: "matches", parameters: { filter: { owner: "enemy" } } }, effect: EFFECT };
    const subject = { type: "conditional", condition: { type: "matches", parameters: { subject: "defender", filter: { owner: "friendly" } } }, effect: EFFECT };
    const loop = { type: "for-each-unit", selector: { filter: { owner: "enemy" } }, effect: { type: "conditional", condition: OWN_SIDE, effect: EFFECT } };
    const selector = { type: "select-units", selector: { filter: { owner: "friendly" }, eligibility: OWN_SIDE }, effect: EFFECT };
    for (const tree of [enemy, subject, loop, selector]) expect(dropOwnSideRestatements(tree)).toEqual(tree);
  });

  it("compiles 'one unit from your army with this ability can use it' with no owner gate", () => {
    const text = "Once per battle round, one unit from your army with this ability can use it when it is targeted with a Stratagem. If it does, reduce the CP cost of that use of that Stratagem by 1CP.";
    const result = compileLeaves(placed(text,
      ["Once per battle round", "usage-limit", { frequency: "once-per-battle-round" }],
      ["one unit", "usage-scope", { per: "army" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["can use it", "optional-use", { who: "this-unit" }],
      ["when it is targeted with a Stratagem", "event", { kind: "targets-selected", owner: "friendly", action_kind: "stratagem", object: "this-unit" }],
      ["reduce the CP cost of that use of that Stratagem by 1CP", "stratagem-cost", { of: "stratagem", operation: "decrease", amount: 1, applies_to: "the-triggering-use" }],
    ), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics.effect)).not.toContain('"owner":"friendly"');
    expect((result.mechanics.effect as { type: string }).type).toBe("cost-modifier");
  });
});
