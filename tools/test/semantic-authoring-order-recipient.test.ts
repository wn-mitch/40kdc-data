import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/effect.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// Orders given outside an officer's usual pick: to the unit a moment names, beyond its limit, or
// added to the bearer's menu. Wording and option names are fabricated.

const ARMY = { units: { faction_id: "astra-militarum" } };
const validate = () => createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

const HOP = "Each time a friendly **REGIMENT** unit hops out of a **TRANSPORT** that is within 6\" of this model, after that unit has been set up, this model can issue 1 Order to that unit, even past its usual limit.";
const hop = (between = ", ") => {
  const text = HOP.replace("**TRANSPORT** that", `**TRANSPORT**${between === ", " ? " " : between}that`);
  return {
    text,
    leaves: placed(text,
      ["friendly **REGIMENT** unit", "unit-filter", { side: "friendly", keywords: ["REGIMENT"] }],
      ["hops out of a **TRANSPORT", "event", { kind: "disembarked" }],
      ["that is within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "disembarked-from", negated: false }],
      ["after that unit has been set up", "event", { kind: "set-up", subject: "antecedent" }],
      ["this model can issue 1 Order to that unit, even past its usual limit", "issue-orders-open", { count: 1, eligible_keyword: "REGIMENT", recipient: "antecedent", counts_toward_limit: false }],
    ),
  };
};

describe("an Order to the unit that disembarked, outside the officer's limit", () => {
  it("folds the Transport's position and the set-up into one disembarked trigger, and gives the Order to its unit", () => {
    const { text, leaves } = hop();
    const result = compileLeaves(leaves, text, ARMY);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.trigger).toEqual({
      event: "disembarked", subject: { owner: "friendly", all_of: ["REGIMENT"] },
      filter: { timing: "after-set-up", transport: { within: { of: "this-model", range: { inches: 6 } } } },
    });
    expect(result.mechanics.effect).toEqual({
      type: "issue-orders", menu_from: "voice-of-command-astra-militarum", count: 1, eligible: { all_of: ["REGIMENT"] },
      recipient: "event-subject", counts_toward_limit: false,
    });
    expect(validate()(result.mechanics.effect)).toBe(true);
    expect(describeAbility({ ability_id: "fabricated-hop", ...(result.mechanics as object) } as never)).toContain(
      "When a friendly unit disembarks from a Transport within 6\" of this model, after it has been set up");
    expect(describeAbility({ ability_id: "fabricated-hop", ...(result.mechanics as object) } as never)).toContain(
      "to the triggering unit (if it is one of the eligible friendly REGIMENT units), not counting toward the Orders it can issue this turn.");
  });

  it("refuses a Transport position that does not follow its disembarked moment directly", () => {
    const { text, leaves } = hop(" (any of them) ");
    const result = compileLeaves(leaves, text, ARMY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/disembarked-from position must follow its disembarked moment directly/u);
  });

  it("keeps the family checks: only antecedent and false, and a disembarked-from position of this unit or model", () => {
    const orders = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("issue-orders-open", parameters, currentFamilyVersion("issue-orders-open"));
    expect(() => orders({ count: 1, counts_toward_limit: true })).toThrow(/counts_toward_limit is false/u);
    expect(() => orders({ count: 1, recipient: "this-unit" })).toThrow();
    const position = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("unit-position", parameters, currentFamilyVersion("unit-position"));
    expect(() => position({ kind: "within", inches: 6, of: "matching-unit", subject: "disembarked-from", negated: false })).toThrow(/measured to this unit or model/u);
  });
});

describe("an Order added to the bearer's menu", () => {
  const text = "Each time you pick an Order for the bearer to issue, you can pick the Order below:\n**Steady Aim (Order):** Each time a model in this unit makes a ranged attack, improve the Armour Penetration characteristic of that attack by 1.";
  const order: Array<Parameters<typeof placed>[1]> = [
    ["Steady Aim (Order", "named-option", { label: "Steady Aim", option_id: "steady-aim" }],
    ["Each time a model in this unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
    ["improve the Armour Penetration characteristic of that attack by 1", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "all" }],
  ];
  const leaves = (moment: boolean): CompileLeaf[] => placed(text,
    ...(moment ? [["Each time you pick an Order for the bearer to issue", "event", { kind: "used", activity: "order" }] as Parameters<typeof placed>[1]] : []),
    ["you can", "optional-use", { who: "you" }],
    ["pick the Order below", "choice-open", { choice_label: "Steady Aim", min_choices: 0, max_choices: 1 }],
    ...order,
  );

  it("is one more option on the faction's Orders menu, with its own id", () => {
    const result = compileLeaves(leaves(true), text, ARMY);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect).toMatchObject({ type: "ability-modifier", target: "this-model", modifier: { ability: "voice-of-command-astra-militarum", aspect: "options", operation: "add", add_option: { id: "steady-aim", name: "Steady Aim" } } });
    // "this unit" in the Order is the ordered unit, as in the menu's own Orders.
    expect(effect.modifier.add_option.effect).toMatchObject({ type: "conditional", effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "AP", value: 1 } } });
    expect(result.mechanics.trigger ?? null).toBeNull();
    expect(validate()(effect), JSON.stringify(validate().errors)).toBe(true);
  });

  it("is still a refused one-option choice without the moment an Order is picked", () => {
    const result = compileLeaves(leaves(false), text, ARMY);
    expect(result.ok).toBe(false);
  });
});
