import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { guardNamedAbilityPayments } from "../src/semantic-authoring/compile-named-ability-states.js";
import { checkSpentReferences } from "../src/semantic-authoring/compile-spent.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import { expectCompiled, expectRefused, placed } from "./semantic-authoring-connective-fixture.js";

// Spent amounts, this turn's gains, additional dice and counts of units hit. Wording is fabricated.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters);
const steps = (effect: unknown) => (effect as { steps: Array<Record<string, any>> }).steps;

describe("a spend that binds the amount it spent", () => {
  const text = "When this unit is selected to fight, spend up to 3 Glim and add the number of Glim you just spent to the Damage characteristic of the bearer's melee weapons.";
  const spend = (parameters: Record<string, unknown>) => ["spend up to 3 Glim", "resource-spend", { pool: "glim-pool", ...parameters }] as const;
  const change = (value: unknown) => ["add the number of Glim you just spent to the Damage characteristic of the bearer's melee weapons", "characteristic-modifier",
    { characteristics: ["D"], operation: "add", value, subject: "this-model", weapon_type: "melee" }] as const;
  const event = ["When this unit is selected to fight", "event", { kind: "selected", to: "fight" }] as const;

  it("lowers the spend's {up_to} amount and bind_as, and the change's value as the spent reference", () => {
    const result = compileLeaves(placed(text, event, spend({ amount: { up_to: 3 }, bind_as: "glim-spent" }), change({ spent: "glim-spent" })), text);
    expectCompiled(result);
    const [paid, added] = steps(result.mechanics.effect);
    expect(paid).toMatchObject({ type: "resource-spend", modifier: { pool: "glim-pool", amount: { up_to: 3 }, bind_as: "glim-spent" } });
    expect(added).toMatchObject({ type: "stat-modifier", modifier: { stat: "D", operation: "add", value: { spent: "glim-spent" } } });
  });

  it("refuses a read of a name no spend before it binds", () => {
    const result = compileLeaves(placed(text, event, spend({ amount: { up_to: 3 }, bind_as: "glim-spent" }), change({ spent: "other" })), text);
    expectRefused(result);
    expect(result.errors.join(" ")).toMatch(/no resource spend before it binds/u);
  });

  it("refuses a bound amount nothing reads", () => {
    const result = compileLeaves(placed(text, event, spend({ amount: { up_to: 3 }, bind_as: "glim-spent" }), change(1)), text);
    expectRefused(result);
    expect(result.errors.join(" ")).toMatch(/no amount reads it/u);
  });

  it("refuses a read that comes before its spend", () => {
    expect(() => checkSpentReferences({ type: "sequence", steps: [
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "M", operation: "add", value: { spent: "x" } } },
      { type: "resource-spend", target: "this-model", modifier: { pool: "glim-pool", amount: "any", bind_as: "x" } },
    ] })).toThrow(/no resource spend before it binds/u);
  });

  it("refuses two spends binding one name", () => {
    const spendAny = { type: "resource-spend", target: "this-model", modifier: { pool: "glim-pool", amount: "any", bind_as: "x" } };
    expect(() => checkSpentReferences({ type: "sequence", steps: [spendAny, spendAny,
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "M", operation: "add", value: { spent: "x" } } }] })).toThrow(/Two resource spends/u);
  });
});

describe("spent amounts in the families", () => {
  it("binds only an amount the player chooses", () => {
    expect(normalize("resource-spend", { pool: "glim-pool", amount: "any", bind_as: "glim-spent" })).toEqual({ pool: "glim-pool", amount: "any", bind_as: "glim-spent" });
    expect(() => normalize("resource-spend", { pool: "glim-pool", amount: 2, bind_as: "glim-spent" })).toThrow(/amount the player chooses/u);
    expect(() => normalize("resource-spend", { pool: "glim-pool", amount: { up_to: 0 } })).toThrow();
    expect(() => normalize("resource-spend", { pool: "glim-pool", amount: { up_to: 2, extra: 1 } })).toThrow();
  });

  it("takes a spent amount only where an amount is added or subtracted", () => {
    expect(normalize("characteristic-amount", { value: { spent: "glim-spent", per: 2 } })).toEqual({ value: { spent: "glim-spent", per: 2 } });
    expect(() => normalize("characteristic-modifier", { characteristics: ["M"], operation: "multiply", value: { spent: "glim-spent" }, subject: "this-unit" })).toThrow();
    expect(() => normalize("characteristic-amount", { value: { spent: "glim-spent", per: 1 } })).toThrow(/per/u);
    expect(normalize("return-models", { subject: "this-unit", count: { spent: "glim-spent", per: 2 } })).toMatchObject({ count: { spent: "glim-spent", per: 2 } });
    expect(() => normalize("return-models", { subject: "this-unit", count: { spent: "Glim" } })).toThrow(/kebab-case/u);
  });

  it("bounds this turn's gains alone, and a difference takes no set", () => {
    expect(normalize("resource", { pool: "glim-pool", at_most: 2, gained_this_turn: true })).toEqual({ pool: "glim-pool", at_most: 2, gained_this_turn: true });
    expect(() => normalize("resource", { pool: "glim-pool", below_max: true, gained_this_turn: true })).toThrow(/gained_this_turn/u);
    expect(normalize("resource-gain", { pool: "glim-pool", amount: { difference_to: 3 } })).toEqual({ pool: "glim-pool", amount: { difference_to: 3 } });
    expect(() => normalize("resource-gain", { pool: "glim-pool", amount: { difference_to: 3 }, set: true })).toThrow(/set/u);
  });

  it("adds dice under a condition only to the roll before", () => {
    expect(normalize("dice-roll", { dice: "D6", count: 2, plus_if: true })).toEqual({ dice: "D6", count: 2, plus_if: true });
    expect(() => normalize("dice-roll", { dice: "D6", per_model: "this-unit", plus_if: true })).toThrow(/plus_if/u);
  });

  it("maps every earlier leaf of a bumped family unchanged", () => {
    for (const [family, from] of [["resource-spend", 4], ["resource-gain", 6], ["resource", 1], ["characteristic-modifier", 21], ["characteristic-amount", 1],
      ["return-models", 7], ["dice-roll", 10], ["bearer-eligibility", 8]] as const) {
      const parameters = { probe: family };
      expect(mapToLatest(family, from, parameters)).toMatchObject({ family, parameters });
    }
  });
});

describe("a spent amount read after the change's recipient", () => {
  const text = "Each time you use this Stratagem, you can spend up to 2 Glim. Until the end of the turn, add X\" to the Move characteristic of models in your unit, where X is the number of Glim you spent.";
  it("gives the change the spent amount", () => {
    const result = compileLeaves(placed(text,
      ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
      ["you can", "optional-use", { who: "you" }],
      ["spend up to 2 Glim", "resource-spend", { pool: "glim-pool", amount: { up_to: 2 }, bind_as: "glim-spent" }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["add X\" to the Move characteristic of models in your unit", "characteristic-modifier", { characteristics: ["M"], operation: "add", subject: "this-unit" }],
      ["where X is the number of Glim you spent", "characteristic-amount", { value: { spent: "glim-spent" } }]), text);
    expectCompiled(result);
    expect(JSON.stringify(result.mechanics.effect)).toContain('"stat":"M","operation":"add","value":{"spent":"glim-spent"}');
  });
});

describe("additional dice under a condition", () => {
  const text = "Each time you use this Stratagem, you can spend 2 Glim. Roll one D6 for each model in your unit, rolling two additional D6 if you spent Glim during this use: for each 4+, that enemy unit suffers 1 mortal wound.";
  const leaves = (extra: Record<string, unknown>) => placed(text,
    ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
    ["you can", "optional-use", { who: "you" }],
    ["spend 2 Glim", "resource-spend", { pool: "yp-pool", amount: 2 }],
    ["Roll one D6 for each model in your unit", "dice-roll", { dice: "D6", per_model: "this-unit" }],
    ["rolling two additional D6", "dice-roll", { count: 2, plus_if: true, ...extra }],
    ["you spent Glim during this use", "optional-cost-paid", { pool: "yp-pool", window: "use", subject: "this-unit", tag: "yp-spent-this-use" }],
    ["for each 4+", "roll-result", { from: 4 }],
    ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]);

  it("folds the dice and the condition onto the per-model roll, and keeps the spend optional", () => {
    const result = compileLeaves(leaves({ dice: "D6" }), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics.effect);
    expect(json).toContain('"extra_dice":{"count":2,"condition":{"type":"matches","parameters":{"subject":"this-unit","filter":{"designated":"yp-spent-this-use"}}}}');
    expect(json).toContain('"type":"ability-part","optional":true');
    expect(json.match(/"type":"roll"|"per_model"/gu)?.length).toBe(1);
  });

  it("refuses additional dice of another die", () => {
    const result = compileLeaves(leaves({ dice: "D3" }), text);
    expectRefused(result);
    expect(result.errors.join(" ")).toMatch(/same die/u);
  });
});

describe("a count of the units those attacks hit", () => {
  const text = "In your Shooting phase, after this unit has shot, you gain 1 Glim for each marked enemy unit hit by one or more of those attacks (to a maximum of 3 Glim).";
  const leaves = (filter: Record<string, unknown>) => placed(text,
    ["after this unit has shot", "event", { kind: "after-shooting" }],
    ["you gain 1 Glim", "resource-gain", { pool: "yp-pool", amount: 1 }],
    ["for each", "count-scale", { per: 1 }],
    ["marked enemy unit", "unit-filter", { side: "enemy", ...filter }],
    ["hit by one or more of those attacks", "hit-by-attacks", { subject: "antecedent" }],
    ["(to a maximum of 3 Glim", "scale-cap", { max: 3 }]);

  it("scales the gain by the designated enemy units hit, capped", () => {
    const result = compileLeaves(leaves({ designated: "assailed" }), text);
    expectCompiled(result);
    expect(JSON.stringify(result.mechanics.effect)).toContain('"scaling":{"per":1,"of":"enemy-units-hit","designated":"assailed","max_value":3,"field":"amount"}');
  });

  it("refuses units hit narrowed by keywords, which the source cannot count", () => {
    const result = compileLeaves(leaves({ keywords: ["INFANTRY"] }), text);
    expectRefused(result);
    expect(result.errors.join(" ")).toMatch(/narrowed by keywords/u);
  });
});

describe("this turn's gains", () => {
  const text = "At the end of your turn, if you gained fewer than 3 Glim this turn, you gain an amount of Glim equal to the difference.";
  it("lowers the condition with gained turn and the gain's difference", () => {
    const result = compileLeaves(placed(text,
      ["At the end of your turn", "event", { kind: "turn-ended", turn: "your" }],
      ["you gained fewer than 3 Glim this turn", "resource", { pool: "yp-pool", at_most: 2, gained_this_turn: true }],
      ["you gain an amount of Glim equal to the difference", "resource-gain", { pool: "yp-pool", amount: { difference_to: 3 } }]), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics);
    expect(json).toContain('{"type":"resource","parameters":{"pool":"yp-pool","count":{"max":2},"gained":"turn"}}');
    expect(json).toContain('"amount":{"difference_to":3}');
  });
});

describe("a named ability exchange after a spend of any amount", () => {
  const exchange = { type: "rule-state", target: "this-unit", modifier: { direction: "exchanged" } };
  const spend = { type: "resource-spend", target: "this-model", modifier: { pool: "yp-pool", amount: "any" } };
  const checked = { type: "conditional", condition: { type: "resource", parameters: { pool: "yp-pool", count: { max: 6 } } }, effect: exchange };

  it("keeps an exchange its own check of the pool gates, with no payment guard", () => {
    const node = { type: "sequence", steps: [spend, checked] };
    expect(guardNamedAbilityPayments(node)).toEqual(node);
  });

  it("refuses an exchange no check of the pool gates", () => {
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [spend, exchange] })).toThrow(/gated by a check of that pool/u);
    const otherPool = { ...checked, condition: { type: "resource", parameters: { pool: "other-pool", count: { max: 6 } } } };
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [spend, otherPool] })).toThrow(/gated by a check of that pool/u);
  });
});

describe("wargear an enhancement's bearer must be equipped with", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function data(required: string[] | undefined): string {
    const base = mkdtempSync(join(tmpdir(), "semantic-authoring-wargear-"));
    roots.push(base);
    const root = join(base, "data");
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture record only.
    writeFileSync(join(root, "core", "alpha", "enhancements.json"), JSON.stringify([
      { id: "gun", keyword_restrictions: ["Alpha"], ...(required ? { required_wargear_ids: required } : {}) },
    ]));
    return root;
  }
  const check = (root: string, wargear?: string[]) => coreCheckErrors(root, "gun",
    [{ kind: "bearer-eligibility", parameters: { keywords: ["ALPHA"], match: "all", excluded_keywords: [], ...(wargear ? { wargear } : {}) } }]);

  it("accepts the wargear core requires, and none when core requires none", () => {
    expect(check(data(["fabricated-gun"]), ["fabricated-gun"]).filter((error) => /equipped|wargear/u.test(error))).toEqual([]);
    expect(check(data(undefined)).filter((error) => /equipped|wargear/u.test(error))).toEqual([]);
  });

  it("refuses wargear core does not require, or a leaf missing what core requires", () => {
    expect(check(data(["fabricated-gun"])).join(" ")).toMatch(/no wargear, but core requires fabricated-gun/u);
    expect(check(data(undefined), ["fabricated-gun"]).join(" ")).toMatch(/equipped with fabricated-gun, but core requires none/u);
  });
});
