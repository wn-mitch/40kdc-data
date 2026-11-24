import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { resolveOrderShareTargets } from "../src/semantic-authoring/compile-orders.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/effect.js";
import { placed, type Item } from "./semantic-authoring-connective-fixture.js";

// How Orders are issued beyond an officer's own menu: as if in another phase, the same Order again,
// to more units or from further away, and Orders shared between a Stratagem's two targets. Wording
// is fabricated; Order names are the faction's own menu.

const ARMY = { units: { faction_id: "astra-militarum" } };
const MENU = "voice-of-command-astra-militarum";
const effectOk = () => createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

function compiled(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text, ARMY);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, any>;
}

function refused(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text, ARMY);
  if (result.ok) throw new Error(`compiled, but should refuse: ${JSON.stringify(result.mechanics)}`);
  return result.errors.join("; ");
}

const render = (mechanics: Record<string, unknown>) => describeAbility({ ability_id: "fabricated-orders", ...mechanics } as never);

describe("orders-modifier and order-share family checks", () => {
  const modifier = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("orders-modifier", parameters, currentFamilyVersion("orders-modifier"));
  const share = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("order-share", parameters, currentFamilyVersion("order-share"));
  const opener = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("issue-orders-open", parameters, currentFamilyVersion("issue-orders-open"));

  it("refuses an orders-modifier that changes nothing, or whose parts lack what they narrow", () => {
    expect(() => modifier({ subject: "this-unit" })).toThrow(/changes at least one of/u);
    expect(() => modifier({ subject: "this-unit", orders: ["Take Aim!"] })).toThrow(/changes at least one of/u);
    expect(() => modifier({ subject: "friendly-units", count: "any" })).toThrow(/issuer_keywords/u);
    expect(() => modifier({ subject: "this-unit", issuer_keywords: ["OFFICER"], count: "any" })).toThrow(/only when subject is friendly-units/u);
    expect(() => modifier({ subject: "this-unit", recipient_excluded: ["TITANIC"], count: "any" })).toThrow(/narrows recipient_keywords/u);
    expect(() => modifier({ subject: "this-unit", adds_recipients: true })).toThrow(/name them/u);
    expect(() => modifier({ subject: "this-unit", recipient_keywords: ["ALPHA"], range: "unlimited", range_proxy: { marker: "beacon", inches: 6 } })).toThrow(/not both/u);
    expect(() => modifier({ subject: "this-unit", range_proxy: { marker: "beacon", inches: 6 } })).toThrow(/recipient_keywords/u);
    expect(() => modifier({ subject: "this-unit", recipient_keywords: ["ALPHA"], range_proxy: { marker: "beacon", inches: 0 } })).toThrow();
    expect(() => modifier({ subject: "this-unit", recipient_keywords: ["ALPHA", "ALPHA"], count: "any" })).toThrow(/twice/u);
    expect(() => modifier({ subject: "this-unit", count: "all" })).toThrow();
    expect(modifier({ subject: "this-unit", off_battlefield: true })).toEqual({ subject: "this-unit", off_battlefield: true });
  });

  it("refuses an order-share between anything but a Stratagem's targets, and a false mutual", () => {
    expect(() => share({ units: "this-unit-and-bodyguard" })).toThrow();
    expect(() => share({ units: "stratagem-targets", mutual: false })).toThrow();
    expect(share({ units: "stratagem-targets", mutual: true })).toEqual({ units: "stratagem-targets", mutual: true });
  });

  it("refuses an issue-orders-open repeat of the Order with its own recipient, and a phase other than Command", () => {
    expect(() => opener({ count: 1, same_order: true, recipient: "antecedent" })).toThrow();
    expect(() => opener({ count: 1, as_if_phase: "shooting" })).toThrow();
    expect(() => opener({ count: 1, same_order: false })).toThrow();
  });
});

describe("an officer that issues an Order as if it were the Command phase", () => {
  const text = "Your unit's OFFICER model can issue 1 Order as if it were your Command phase.";
  const mechanics = () => compiled(text, ["Your unit's OFFICER model can issue 1 Order as if it were your Command phase", "issue-orders-open", { count: 1, issuer_keywords: ["OFFICER"], as_if_phase: "command" }]);

  it("issues one Order from the faction's menu, by the OFFICER model, as the Command phase", () => {
    const effect = mechanics().effect;
    expect(effect).toEqual({ type: "issue-orders", menu_from: MENU, count: 1, issuer: { all_of: ["OFFICER"] }, as_if_phase: "command" });
    expect(effectOk()(effect)).toBe(true);
    expect(render(mechanics())).toContain("OFFICER models can issue up to 1 Order from Voice of Command to eligible friendly units as if it were your Command phase.");
  });

  it("refuses issuer keywords alongside an issuer order-rule", () => {
    const both = "OFFICER models only. Your unit's OFFICER model can issue 1 Order as if it were your Command phase.";
    expect(refused(both,
      ["OFFICER models only", "order-rule", { rule: "issuer", keywords: ["OFFICER"] }],
      ["Your unit's OFFICER model can issue 1 Order as if it were your Command phase", "issue-orders-open", { count: 1, issuer_keywords: ["OFFICER"] }],
    )).toMatch(/issuer/u);
  });
});

describe("the same Order again, to another unit", () => {
  const text = "Each time this model issues an Order to a friendly ALPHA unit, it can issue the same Order to another ALPHA unit.";
  const moment: Item = ["Each time this model issues an Order", "event", { kind: "used", activity: "order", subject: "this-model" }];
  const alpha: Item = ["a friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];
  const again: Item = ["it can issue the same Order to another ALPHA unit", "issue-orders-open", { count: 1, eligible_keyword: "ALPHA", same_order: true }];

  it("folds the unit the Order went to into the moment, and repeats that Order to one other eligible unit", () => {
    const mechanics = compiled(text, moment, alpha, again);
    expect(mechanics.trigger).toEqual({ event: "used", subject: "this-model", filter: { kind: "order" }, object: { owner: "friendly", all_of: ["ALPHA"] } });
    expect(mechanics.effect).toEqual({ type: "issue-orders", count: 1, eligible: { all_of: ["ALPHA"] }, same_order: true, exclude: "event-object" });
    expect(effectOk()(mechanics.effect)).toBe(true);
    const english = render(mechanics);
    expect(english).toContain("Each time this model issues an Order to a friendly ALPHA unit");
    expect(english).toContain("Issue the same Order to one other of the eligible friendly ALPHA units.");
  });

  it("refuses a repeat that also names its own Orders", () => {
    const named = `${text} Hold Fast!: this model has the Feel No Pain 6+ ability.`;
    expect(refused(named, moment, alpha, again,
      ["Hold Fast!", "named-option", { label: "Hold Fast!", option_id: "hold-fast" }],
      ["this model has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "this-model", threshold: 6, against: "all" }],
    )).toMatch(/same Order|options/u);
  });

  it("is rejected by the schema with options, or an exclude without same_order", () => {
    const validate = effectOk();
    expect(validate({ type: "issue-orders", count: 1, same_order: true, exclude: "event-object", options: [{ name: "A", effect: { type: "no-effect" } }] })).toBe(false);
    expect(validate({ type: "issue-orders", count: 1, menu_from: MENU, exclude: "event-object" })).toBe(false);
  });
});

describe("an Order a menu issues only to some units", () => {
  const text = "Issue 1 Order to an INFANTRY unit, one of: Steady!: this unit has the Feel No Pain 6+ ability. Gun Run!: only to BETA units; this unit has the Feel No Pain 5+ ability.";
  const head: Item = ["Issue 1 Order to an INFANTRY unit", "issue-orders-open", { count: 1, eligible_keyword: "INFANTRY" }];
  const steady: Item[] = [
    ["Steady!", "named-option", { label: "Steady!", option_id: "steady" }],
    ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "this-unit", threshold: 6, against: "all" }],
  ];
  const gunRun: Item[] = [
    ["Gun Run!", "named-option", { label: "Gun Run!", option_id: "gun-run" }],
    ["only to BETA units", "order-rule", { rule: "recipient-keywords", keywords: ["BETA"] }],
    ["this unit has the Feel No Pain 5+ ability", "feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }],
  ];

  it("puts the recipient keywords on that Order alone", () => {
    const effect = compiled(text, head, ...steady, ...gunRun).effect;
    expect(effect.options.map((option: Record<string, unknown>) => option.eligible ?? null)).toEqual([null, { all_of: ["BETA"] }]);
    expect(effect.eligible).toEqual({ all_of: ["INFANTRY"] });
    expect(effectOk()(effect)).toBe(true);
    expect(render({ effect, scope: { duration: "permanent" } })).toContain("- Gun Run! (only to friendly BETA units): ");
  });

});

describe("a record that defines one Order", () => {
  const text = "Gun Run!\nThis Order can only be issued to BETA GAMMA units. Each time an enemy unit ends a Normal move within 8\" of this unit, this unit can make a Normal move of up to D6\".";
  const name: Item = ["Gun Run!", "named-option", { label: "Gun Run!", option_id: "gun-run" }];
  const rule: Item = ["This Order can only be issued to BETA GAMMA units", "order-rule", { rule: "recipient-keywords", keywords: ["BETA", "GAMMA"] }];
  const body: Item[] = [
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["ends a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
    ["within 8\" of this unit", "unit-position", { kind: "within", subject: "event-subject", negated: false, inches: 8, of: "this-unit" }],
    ["this unit can make a Normal move of up to D6", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
  ];

  it("joins the army's Orders menu by its option id, with its own recipients and its moment inside the Order", () => {
    const mechanics = compiled(text, name, rule, ...body);
    const effect = mechanics.effect;
    expect(effect).toMatchObject({
      type: "ability-modifier", target: { owner: "friendly" },
      modifier: { ability: MENU, aspect: "options", operation: "add", add_option: { id: "gun-run", name: "Gun Run!", eligible: { all_of: ["BETA", "GAMMA"] } } },
    });
    expect(effect.modifier.add_option.effect).toMatchObject({ type: "ability-part", trigger: { event: "move-ended", subject: { owner: "enemy" } } });
    expect(mechanics.trigger ?? null).toBeNull();
    expect(effectOk()(effect)).toBe(true);
    expect(render(mechanics)).toContain("gains the option Gun Run! (only to friendly BETA GAMMA units: each time an enemy unit ends a Normal move");
  });

  it("refuses a definition without its Order's name first, with a second Order, or with an issue-orders rule", () => {
    expect(refused(text, rule, ...body)).toMatch(/opens with that Order's named-option/u);
    const two = `${text} Hop!`;
    expect(refused(two, name, rule, ...body, ["Hop!", "named-option", { label: "Hop!", option_id: "hop" }])).toMatch(/names only that Order/u);
    const once = `${text} A unit holds one Order at a time.`;
    expect(refused(once, name, rule, ...body, ["A unit holds one Order at a time", "order-rule", { rule: "one-at-a-time" }])).toMatch(/one-at-a-time belongs to an issue-orders|exactly one issue-orders-open/u);
  });

  it("refuses a definition in a faction with no Orders menu", () => {
    const result = compileLeaves(placed(text, name, rule, ...body), text, { units: { faction_id: "aeldari" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/army rule that lists Orders/u);
  });

  it("is rejected by the schema with non-keyword recipients", () => {
    const added = (eligible: unknown) => ({ type: "ability-modifier", target: { owner: "friendly" }, modifier: { ability: MENU, aspect: "options", operation: "add", add_option: { id: "gun-run", name: "Gun Run!", eligible, effect: { type: "no-effect" } } } });
    expect(effectOk()(added({ all_of: ["BETA"] }))).toBe(true);
    expect(effectOk()(added({ owner: "enemy" }))).toBe(false);
  });
});

describe("a Stratagem that can target an embarked unit", () => {
  const permission = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("eligibility-permission", parameters, currentFamilyVersion("eligibility-permission"));

  it("takes despite embarked, and reads it as the unit's state", () => {
    expect(permission({ subject: "this-unit", activity: "use-stratagem", allow: true, despite: ["embarked"] })).toMatchObject({ despite: ["embarked"] });
    expect(() => permission({ subject: "this-unit", activity: "use-stratagem", allow: true, despite: ["inside"] })).toThrow();
    const effect = { type: "permission", target: "this-unit", modifier: { activity: "use-stratagem", allow: true, despite: ["embarked"] } };
    expect(effectOk()(effect)).toBe(true);
    expect(render({ effect, scope: { duration: "phase" } })).toContain("eligible to be targeted with Stratagems even if it is embarked within a Transport");
  });
});

describe("a change to how a unit issues Orders", () => {
  const text = "When this model issues the Move! Move! Move! Order, it can issue it to any number of friendly INFANTRY units, regardless of range.";
  const leafFor = (orders: string[]): Item => ["it can issue it to any number of friendly INFANTRY units, regardless of range", "orders-modifier",
    { subject: "this-model", orders, recipient_keywords: ["INFANTRY"], count: "any", range: "unlimited" }];

  it("names the Order by its menu option, and reaches any number of units at any range", () => {
    const mechanics = compiled(text, leafFor(["Move! Move! Move!"]));
    expect(mechanics.effect).toEqual({
      type: "orders-modifier", target: "this-model",
      modifier: { only_options: [{ ability_id: MENU, option_id: "move-move-move" }], recipients: { all_of: ["INFANTRY"] }, count: "any", range: "unlimited" },
    });
    expect(effectOk()(mechanics.effect)).toBe(true);
    expect(render(mechanics)).toContain("This model can issue the Move Move Move Order to any number of eligible friendly INFANTRY units, regardless of range");
  });

  it("refuses an Order the faction's menu does not have", () => {
    expect(refused(text, leafFor(["Dance! Dance!"]))).toMatch(/not all Orders|Dance/u);
  });

  it("measures from a marker for friendly issuers, and the schema needs recipients for it", () => {
    const beacon = "OFFICER units from your army can issue Orders to REGIMENT units within 6\" of the beacon.";
    const mechanics = compiled(beacon, ["OFFICER units from your army can issue Orders to REGIMENT units within 6\" of the beacon", "orders-modifier",
      { subject: "friendly-units", issuer_keywords: ["OFFICER"], recipient_keywords: ["REGIMENT"], range_proxy: { marker: "fabricated-beacon", inches: 6 } }]);
    expect(mechanics.effect).toEqual({
      type: "orders-modifier", target: { owner: "friendly", all_of: ["OFFICER"] },
      modifier: { recipients: { all_of: ["REGIMENT"] }, range_proxy: { marker: "fabricated-beacon", inches: 6 } },
    });
    expect(effectOk()(mechanics.effect)).toBe(true);
    expect(effectOk()({ type: "orders-modifier", target: "this-unit", modifier: { range_proxy: { marker: "fabricated-beacon", inches: 6 } } })).toBe(false);
    expect(effectOk()({ type: "orders-modifier", target: "this-unit", modifier: {} })).toBe(false);
  });
});

describe("Orders shared between a Stratagem's two targets", () => {
  const text = "Command phase. One ALPHA unit and one BETA unit. Orders affecting one of them affect the other, and vice versa.";
  const window: Item = ["Command phase", "use-window", { your_phases: ["command"], opponent_phases: [], either_phases: [] }, "WHEN"];
  const share: Item = ["Orders affecting one of them affect the other, and vice versa", "order-share", { units: "stratagem-targets", mutual: true }, "EFFECT"];

  it("shares the first target's Orders with the second, both ways", () => {
    const mechanics = compiled(text, window,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      share);
    expect(mechanics.effect).toEqual({ type: "order-share", target: { stratagem_target: "first" }, modifier: { with: { stratagem_target: "second" }, mutual: true } });
    expect(effectOk()(mechanics.effect)).toBe(true);
    expect(render(mechanics)).toContain("Orders affecting the first target also affect the second target, and vice versa");
  });

  it("refuses a record without exactly two named targets", () => {
    const one = "Command phase. One ALPHA unit. Orders affecting one of them affect the other, and vice versa.";
    expect(refused(one, window,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      share)).toMatch(/two targets/u);
    expect(() => resolveOrderShareTargets({ target: "__order-share-first-target" }, [{ name: "first" }, { name: "second" }, { name: "third" }])).toThrow(/names 3/u);
    expect(resolveOrderShareTargets({ type: "no-effect" }, null)).toEqual({ type: "no-effect" });
  });
});
