import { describe, expect, it } from "vitest";
import { describeCondition } from "../src/translate/condition.js";
import { describeEffectInline } from "../src/translate/effect.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import type { BuffSource } from "../src/cruncher/buffs.js";

const first = { ability_id: "example-host", definition_id: "first-form" };
const second = { ability_id: "example-host", definition_id: "second-form" };
const source: BuffSource = { kind: "ability", abilityId: "example-host", abilityKind: "unit" };

describe("named automatic ability ownership", () => {
  it("renders the supplied identities and atomic exactly-one exchange", () => {
    const effect = { type: "rule-state", target: "this-unit", modifier: {
      rule_kind: "ability", rule: first, direction: "exchanged", exchange_with: second,
    } };
    const text = describeEffectInline(effect);
    expect(text).toContain("exactly one of the First Form (Example Host) and Second Form (Example Host) abilities");
    expect(text).toContain("simultaneously loses that ability and gains the other");
    const result = effectToBuffs(effect, source, { phase: "command" });
    expect(result.applied).toEqual([]);
    expect(result.activatable).toEqual([]);
    expect(result.unsupported[0].reason).toContain("persistent ability ownership and suppression");
  });

  it("preserves the own-ability exception without treating suppression as a buff", () => {
    const effect = { type: "rule-state", target: "this-unit", modifier: {
      rule_kind: "ability", rule: first, direction: "suppressed", except_from: "this-ability",
    } };
    expect(describeEffectInline(effect)).toContain("loses the First Form (Example Host) ability and cannot gain it except from this ability");
    expect(effectToBuffs(effect, source, { phase: "command" }).applied).toEqual([]);
  });

  it("does not execute a named definition as an unconditional anonymous grant", () => {
    const effect = { type: "ability-grant", target: "this-unit", modifier: {
      ability: first,
      definition: { type: "ability-part", effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } },
    } };
    expect(describeEffectInline(effect)).toContain("First Form (Example Host)");
    const result = effectToBuffs(effect, source, { phase: "shooting" });
    expect(result.applied).toEqual([]);
    expect(result.unsupported[0].reason).toBe("ability-grant: named ability ownership is not resolved by the buff engine");
  });

  it("renders army and oath states in positive and negated forms", () => {
    const army = { type: "army-state", parameters: { owner: "enemy", state: "honoured" } };
    const oath = { type: "oath-state", parameters: { ability: "example-oath", state: "fulfilled" } };
    expect(describeCondition(army)).toBe("your opponent's army is honoured");
    expect(describeCondition({ operator: "not", operands: [army] })).toBe("your opponent's army is not honoured");
    expect(describeCondition(oath)).toBe("the Example Oath oath is fulfilled");
    expect(describeCondition({ operator: "not", operands: [oath] })).toBe("the Example Oath oath is not fulfilled");
  });
});

describe("procedure and used-ability modifiers", () => {
  it("repeats the supplied Oath procedure without inventing a stance option", () => {
    const effect = { type: "ability-activate", target: "this-model", modifier: { ability: "example-rule", procedure: "oath" } };
    expect(describeEffectInline(effect)).toBe("this model resolves the Example Rule Oath procedure again");
    expect(effectToBuffs(effect, source, { phase: "command" }).applied).toEqual([]);
  });

  it("renders each Oath policy from its fields and never executes a nested reward immediately", () => {
    const selection = { type: "oath-modifier", target: "this-model", modifier: {
      ability: "example-rule", aspect: "selection", domains: ["deed", "quality"],
      exclude_previously_selected: true, duplicate_roll: "choose-unselected", stop_when: "all-domains-exhausted",
    } };
    const persistence = { type: "oath-modifier", target: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" }, modifier: {
      ability: "example-rule", aspect: "quality-persistence", from: "fulfilled", duration: "turn",
    } };
    const reward = { type: "oath-modifier", target: "this-unit", modifier: {
      ability: "example-rule", aspect: "deed-reward", applies_to: "additional", operation: "replace", selection_method: "random",
      effect: { type: "cp-gain", target: "this-unit", modifier: { amount: 7 } },
    } };
    expect(describeEffectInline(selection)).toContain("exclude previously selected deeds and qualities; if a duplicate is rolled, choose an unselected result in that domain; stop when every domain is exhausted");
    expect(describeEffectInline(persistence)).toContain("qualities from fulfilled Example Rule Oaths until the end of the turn");
    expect(describeEffectInline(reward)).toContain("on completion of additional randomly determined Example Rule deeds, replace their reward with:");
    expect(describeEffectInline({ ...reward, modifier: { ...reward.modifier, selection_method: "any" } })).toContain("on completion of additional Example Rule deeds, regardless of how those deeds were selected, replace their reward with:");
    for (const effect of [selection, persistence, reward]) {
      const result = effectToBuffs(effect, source, { phase: "command", attackerAttachmentRole: "bodyguard" });
      expect(result.applied).toEqual([]);
      expect(result.activatable).toEqual([]);
      expect(result.unsupported).toHaveLength(1);
    }
  });

  it("replaces an event-bound use's recipient selection without creating another use", () => {
    const effect = { type: "ability-modifier", target: { event_var: "actor" }, modifier: {
      ability: { event: "used", event_var: "use" }, aspect: "selection", operation: "set",
      selection: { filter: { owner: "friendly", all_of: ["INFANTRY"], within: { range: { inches: 8 }, of: { event_var: "actor" } } }, count: { min: 0, max: 2 } },
      recipient_duration: "turn",
    } };
    const text = describeEffectInline(effect);
    expect(text).toContain("replace that ability's selection with up to 2 friendly INFANTRY units");
    expect(text).toContain('within 8"');
    expect(text).toContain("those recipients are affected by that same ability until the end of the turn");
    const result = effectToBuffs(effect, source, { phase: "command" });
    expect(result.applied).toEqual([]);
    expect(result.activatable).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
  });
});
