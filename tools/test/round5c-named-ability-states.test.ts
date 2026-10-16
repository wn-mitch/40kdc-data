import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { bindNamedAbilityRecipients, guardNamedAbilityPayments, localizeNamedAbilityGrantDuration, namedAbilityStateEffect, orderResourceBeforeAbilities } from "../src/round5c/compile-named-ability-states.js";
import { normalizeNamedAbilityStateParameters } from "../src/round5c/named-ability-state-families.js";

// Fabricated identities and mechanic structures; no source prose.
const owner = "sample-resource-rule";
const ember = { ability_id: owner, definition_id: "ember" };
const frost = { ability_id: owner, definition_id: "frost" };
function leaf(family: string, parameters: Record<string, unknown>, at = 0): CompileLeaf {
  const version = currentFamilyVersion(family);
  return { family_id: family, family_version: version, role: familyRole(family, version), parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: at, end_byte: at + 1 };
}
const grant = { type: "ability-grant", target: "this-unit", modifier: { ability: ember } };
const exchange = { type: "rule-state", target: "this-unit", modifier: { direction: "exchanged", rule_kind: "ability", rule: ember, exchange_with: frost } };
const spend = { type: "resource-spend", target: "this-model", modifier: { pool: "sample-pool", amount: 2 } };
const phase = { type: "phase-is", parameters: { phase: "shooting" } };
const turn = { type: "player-turn-is", parameters: { turn: "your-turn" } };

describe("reviewed named ability definitions", () => {
  it("compiles a body once through the real compiler and leaves repeated grants as stable references", () => {
    const result = compileLeaves([
      leaf("named-ability-grant", { subject: "this-unit", ...ember }, 0),
      leaf("named-ability-grant", { subject: "this-model", ...ember }, 2),
      leaf("named-ability-definition", { definition_id: "ember", label: "Ember" }, 4),
      leaf("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 6),
      leaf("named-ability-definition-end", {}, 8),
    ], undefined, { abilityId: owner });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { ...grant, modifier: { ability: ember, definition: { type: "ability-part", name: "Ember", effect: { type: "ability-grant", target: "this-unit", modifier: { ability: "stealth" } } } } },
      { type: "ability-grant", target: "this-model", modifier: { ability: ember } },
    ] });
    expect(JSON.stringify(result.mechanics).match(/"definition":/g)).toHaveLength(1);
  });

  it("keeps independently printed definition sentences in their own condition scopes", () => {
    const result = compileLeaves([
      leaf("named-ability-grant", { subject: "this-unit", ...ember }, 0),
      leaf("named-ability-definition", { definition_id: "ember", label: "Ember" }, 2),
      leaf("unit-keyword", { keywords: ["VEHICLE"], subject: "this-unit", negated: false }, 4),
      leaf("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 6),
      leaf("core-ability-grant", { subject: "this-unit", ability: "fights-first" }, 9),
      leaf("named-ability-definition-end", {}, 11),
    ], "g h c e. s x", { abilityId: owner });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({
      type: "ability-grant",
      modifier: {
        definition: {
          effect: {
            type: "sequence",
            steps: [
              {
                type: "conditional",
                effect: { type: "ability-grant", modifier: { ability: "stealth" } },
              },
              { type: "ability-grant", modifier: { ability: "fights-first" } },
            ],
          },
        },
      },
    });
  });

  it("does not interpret exchange as simultaneous grants or as selectable stance options", () => {
    const result = namedAbilityStateEffect(leaf("named-ability-exchange", { subject: "this-unit", ...ember, exchange_with: "frost" }));
    expect(result).toEqual(exchange);
    expect(namedAbilityStateEffect(leaf("named-ability-suppression", { subject: "this-unit", ...ember, except_from: "this-ability" }))).toEqual({
      type: "rule-state", target: "this-unit", modifier: { direction: "suppressed", rule_kind: "ability", rule: ember, except_from: "this-ability" },
    });
  });

  it("widens suppression to an explicitly named set without reinterpreting version 1", () => {
    const parameters = { subject: "this-unit", ...ember, except_from: "this-ability", additional_definitions: ["frost"] };
    expect(namedAbilityStateEffect(leaf("named-ability-suppression", parameters))).toEqual({ type: "sequence", steps: [ember, frost].map((rule) => ({
      type: "rule-state", target: "this-unit", modifier: { direction: "suppressed", rule_kind: "ability", rule, except_from: "this-ability" },
    })) });
    expect(() => normalizeNamedAbilityStateParameters("named-ability-suppression", parameters, 1)).toThrow("exactly");
    expect(() => normalizeNamedAbilityStateParameters("named-ability-suppression", { ...parameters, additional_definitions: ["ember"] }, 2)).toThrow("twice");
  });

  it("binds one reviewed army recipient filter across host grants without filtering resource income", () => {
    const filter = leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE FACTION"] }, 0);
    const ownership = leaf("unit-owner", { owner: "friendly" }, 2);
    const first = leaf("named-ability-grant", { subject: "antecedent", ...ember }, 10);
    const second = leaf("named-ability-grant", { subject: "antecedent", ...frost }, 20);
    const income = leaf("resource-gain", { pool: "sample-pool", amount: 1 }, 30);
    const result = bindNamedAbilityRecipients([filter, ownership, first, second, income]);
    expect(result).toEqual([
      { ...first, parameters: { ...first.parameters, subject: "filtered-units", subject_filter: { owner: "friendly", all_of: ["SAMPLE FACTION"] } } },
      { ...second, parameters: { ...second.parameters, subject: "filtered-units", subject_filter: { owner: "friendly", all_of: ["SAMPLE FACTION"] } } },
      income,
    ]);
    expect(result.at(-1)).toBe(income);
  });

  it("binds source-contained recipient filters while preserving cross-record definition identity", () => {
    const parent = "sample-parent-rule";
    const suppression = { ...leaf("named-ability-suppression", {
      subject: "antecedent", ability_id: parent, definition_id: "ember", except_from: "this-ability", additional_definitions: ["frost"],
    }, 0), end_byte: 50 };
    const suppressionFilter = leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE FACTION"] }, 1);
    const swap = { ...leaf("named-ability-exchange", {
      subject: "antecedent", ability_id: parent, definition_id: "ember", exchange_with: "frost",
    }, 60), end_byte: 100 };
    const swapFilter = leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE FACTION"] }, 61);
    const result = bindNamedAbilityRecipients([suppression, suppressionFilter, swap, swapFilter]);
    expect(result).toHaveLength(2);
    expect(result.map(namedAbilityStateEffect)).toEqual([
      { type: "sequence", steps: ["ember", "frost"].map((definition_id) => ({
        type: "rule-state",
        target: { owner: "friendly", all_of: ["SAMPLE FACTION"] },
        modifier: {
          direction: "suppressed",
          rule_kind: "ability",
          rule: { ability_id: parent, definition_id },
          except_from: "this-ability",
        },
      })) },
      {
        type: "rule-state",
        target: { owner: "friendly", all_of: ["SAMPLE FACTION"] },
        modifier: {
          direction: "exchanged",
          rule_kind: "ability",
          rule: { ability_id: parent, definition_id: "ember" },
          exchange_with: { ability_id: parent, definition_id: "frost" },
        },
      },
    ]);
  });

  it("rejects duplicate definitions, missing bodies, and unstable exchange identities", () => {
    const duplicate = compileLeaves([
      leaf("named-ability-definition", { definition_id: "ember", label: "Ember" }, 0),
      leaf("named-ability-definition", { definition_id: "ember", label: "Other label" }, 2),
    ], undefined, { abilityId: owner });
    expect(duplicate).toMatchObject({ ok: false, errors: [expect.stringContaining("Duplicate named ability")] });
    const empty = compileLeaves([leaf("named-ability-definition", { definition_id: "ember", label: "Ember" })], undefined, { abilityId: owner });
    expect(empty).toMatchObject({ ok: false, errors: [expect.stringContaining("no reviewed effect")] });
    expect(() => normalizeNamedAbilityStateParameters("named-ability-exchange", { subject: "this-unit", ...ember, exchange_with: "ember" })).toThrow("distinct");
    expect(() => normalizeNamedAbilityStateParameters("named-ability-grant", { subject: "this-unit", ...ember, option_id: "ember" })).toThrow("exactly");
  });
});

describe("ordered resource-funded automatic ability states", () => {
  it("guards the complete paid exchange before spending and retains its optional local event", () => {
    const input = { type: "ability-part", trigger: { event: "phase-ended", condition: { operator: "and", operands: [phase, turn] } }, optional: true, effect: { type: "sequence", steps: [spend, exchange] } };
    expect(guardNamedAbilityPayments(input)).toEqual({ ...input, effect: {
      type: "conditional", condition: { type: "resource", parameters: { pool: "sample-pool", count: { min: 2 } } }, effect: input.effect,
    } });
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [exchange, spend] })).toThrow("follow its payment");
  });

  it("rejects unresolved payment amounts instead of inventing a spend allowance", () => {
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [
      { ...spend, modifier: { pool: "sample-pool", amount: "all" } }, exchange,
    ] })).toThrow("positive fixed amount");
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [spend, spend, exchange] })).toThrow("one fixed resource payment");
  });

  it("localizes a shared grant lifetime without constraining resource income", () => {
    const income = { type: "resource-gain", target: "this-model", modifier: { pool: "sample-pool", amount: 1 } };
    const source = { type: "sequence", steps: [grant, income] };
    expect(localizeNamedAbilityGrantDuration(source, "until-next-command-phase")).toEqual({
      grants: 1,
      value: {
        type: "sequence",
        steps: [
          { type: "ability-part", duration: "until-next-command-phase", effect: grant },
          income,
        ],
      },
    });
  });

  it("runs income before mutually exclusive threshold branches while retaining each player's eligibility", () => {
    const income = { type: "ability-part", trigger: { event: "phase-ended", condition: phase }, effect: { type: "resource-gain", target: "this-model", modifier: { pool: "sample-pool", amount: 1 } } };
    const branch = (count: Record<string, number>, ability: typeof ember) => ({ type: "conditional", condition: { type: "resource", parameters: { pool: "sample-pool", count } }, effect: { ...grant, modifier: { ability } } });
    const determine = { type: "ability-part", trigger: { event: "phase-ended", condition: { operator: "and", operands: [phase, turn] } }, duration: "phase", effect: { type: "sequence", steps: [branch({ max: 3 }, ember), branch({ min: 4 }, frost)] } };
    const start = { type: "ability-part", trigger: { event: "battle-started" }, effect: grant };
    const result = orderResourceBeforeAbilities({ type: "sequence", steps: [start, determine, income] }, "sample-pool");
    expect(result).toEqual({ type: "sequence", steps: [start, {
      type: "ability-part", trigger: { event: "phase-ended" }, effect: { type: "sequence", steps: [
        { type: "conditional", condition: phase, effect: { type: "ability-part", effect: income.effect } },
        { type: "conditional", condition: determine.trigger.condition, effect: { type: "ability-part", duration: "phase", effect: determine.effect } },
      ] },
    }] });
    // Thresholds are evaluated after the income step, not copied into an early selection menu.
    expect(JSON.stringify(result)).not.toContain("stance");
    expect(() => orderResourceBeforeAbilities(start, "sample-pool")).toThrow("no separate phase-end");
  });
});
