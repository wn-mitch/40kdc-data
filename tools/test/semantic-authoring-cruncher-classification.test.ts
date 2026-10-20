import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../src/cruncher/buffs.js";
import { assumeEventSubjectMatches, bindEventSubject } from "../src/cruncher/from-dsl-selection.js";
import { classifyUnsupported } from "../src/semantic-authoring/pipeline-8b.js";

// Fabricated wording only; no GW rule prose.

/**
 * Pins pipeline-8b's three-way classification of `effectToBuffs`'s `unsupported` output:
 * honest runtime unknown (live game state the static cruncher can't resolve), outside the damage
 * path by design (the cruncher estimates damage; healing and non-combat stats/rolls are out of
 * its scope on purpose, not gaps), and unrecognized shape (a real gap: a damage-path effect the
 * cruncher should be able to model but can't parse).
 */

const source: BuffSource = { kind: "ability", abilityId: "fixture", abilityKind: "unit" };
const ctx: EngineContext = { phase: "shooting", attackerStationary: false, attackerKeywords: ["example"] };

describe("pipeline-8b cruncher unsupported classification", () => {
  it("counts a heal effect as outside the damage path, not an unrecognized shape", () => {
    const { unsupported } = effectToBuffs({ type: "heal", target: "this-unit", modifier: { value: 3 } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
  });

  it("models a stance selection allowance as an activatable lever, but an unlisted unmodelled type stays a gap", () => {
    const allowance = effectToBuffs({ type: "stance-selection-capacity", modifier: { ability_id: "doctrine", additional_selections: 1, allocation: "choose-one-option" } }, source, ctx);
    const unlisted = effectToBuffs({ type: "example-unmodelled", target: "this-unit", modifier: {} }, source, ctx).unsupported;
    expect(allowance.unsupported).toEqual([]);
    expect(allowance.activatable.map((lever) => lever.capRaise)).toEqual([{ ability: "doctrine", by: 1, allocation: "choose-one-option" }]);
    expect(classifyUnsupported(allowance.unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 0 });
    expect(classifyUnsupported(unlisted)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });

  it("recognizes an Oath policy without granting a live reward or inventing a damage buff", () => {
    const policy = effectToBuffs({
      type: "oath-modifier", target: { owner: "friendly", level: "model", has_ability: ["example-oath"] },
      modifier: { ability: "example-oath", aspect: "quality-persistence", from: "fulfilled" },
    }, source, ctx);
    expect(policy.applied).toEqual([]);
    expect(policy.activatable).toEqual([]);
    expect(policy.unsupported.length).toBeGreaterThan(0);
    const classified = classifyUnsupported(policy.unsupported);
    expect(classified.unrecognizedShape).toBe(0);
    expect(classified.outsideDamagePath + classified.honestUnknown).toBe(policy.unsupported.length);
  });

  it("distinguishes missing runtime membership from malformed or unknown effect shapes", () => {
    const valid = {
      type: "stat-modifier",
      target: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" },
      modifier: { stat: "S", operation: "add", value: 1 },
    };
    const reason = "unit-filter target: identity, state or model membership is unresolved";
    const unsupported = effectToBuffs(valid, source, ctx).unsupported;
    expect(unsupported.some((item) => item.reason === reason)).toBe(true);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 1, outsideDamagePath: 0, unrecognizedShape: 0 });
    expect(classifyUnsupported([{ ...unsupported[0]!, effectFragment: { ...valid, target: { attachment_role: "bodyguard" } } }]))
      .toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
    expect(classifyUnsupported(effectToBuffs({ type: "unknown-oath-policy" }, source, ctx).unsupported))
      .toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });

  it("keeps a valid aura's unknown emitter separate from malformed emitter filters", () => {
    const effect = { type: "aura", target: "friendly-within-aura", modifier: { range: { inches: 6 },
      emitter_filter: { all_of: ["EXAMPLE"] },
      effect: { type: "roll-modifier", target: "recipient", modifier: { roll: "hit", operation: "add", value: 1 } } } };
    const translated = effectToBuffs(effect, source, ctx);
    expect(translated.applied).toEqual([]);
    expect(classifyUnsupported(translated.unsupported)).toEqual({ honestUnknown: 1, outsideDamagePath: 0, unrecognizedShape: 0 });
    const malformed = { ...effect, modifier: { ...effect.modifier, emitter_filter: { invented_keyword: "EXAMPLE" } } };
    expect(classifyUnsupported(effectToBuffs(malformed, source, ctx).unsupported))
      .toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });

  it("keeps supplied activation and retained-selection context unknown rather than inventing active buffs", () => {
    const bonus = { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } };
    const effects = [
      { type: "stance-select", mode: "re-selectable", min_choices: 1, max_choices: 1, options: [
        { id: "example", name: "Example", effect: { type: "conditional", condition: { type: "attack-is", parameters: { attack_type: "psychic" } }, effect: bonus } },
      ] },
      { type: "persistent-designation", designation: "example-choice",
        select: { kind: "unit", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 }, bind_as: "example" } },
        selection_policy: "one-time", duration: "battle",
        consumer: { relation: "attacks-selected-unit", beneficiary: "this-unit", effect: bonus } },
    ];
    for (const effect of effects) {
      const translated = effectToBuffs(effect, source, ctx);
      expect(translated.applied).toEqual([]);
      expect(classifyUnsupported(translated.unsupported)).toEqual({ honestUnknown: 1, outsideDamagePath: 0, unrecognizedShape: 0 });
    }
  });

  it("recognizes virtual proximity and the typed Hidden transition as non-damage operations", () => {
    const effects = [
      { type: "counts-as", target: "this-unit", modifier: { within: { aura_of: "example-aura" }, of: { owner: "friendly" } } },
      { type: "rule-state", target: "event-subject", modifier: { direction: "suppressed", rule_kind: "core-rule", rule: "attacking-ends-hidden", attacks: { event_var: "example-attacks" } } },
    ];
    for (const effect of effects) {
      const translated = effectToBuffs(effect, source, ctx);
      expect(translated.applied).toEqual([]);
      expect(classifyUnsupported(translated.unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
    }
  });

  it("counts an eligibility permission as outside the damage path, but keeps an unmodelled core-ability grant a real gap", () => {
    const permission = effectToBuffs({ type: "permission", target: "this-unit", modifier: { activity: "shoot", allow: true } }, source, ctx).unsupported;
    const grant = effectToBuffs({ type: "ability-grant", target: "this-unit", modifier: { ability: "firing-deck", value: 2 } }, source, ctx).unsupported;
    expect(classifyUnsupported(permission)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
    expect(classifyUnsupported(grant)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });

  it("counts a Wounds stat-modifier as outside the damage path (A/S/T/Sv are the damage-path stats)", () => {
    const { unsupported } = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "W", operation: "add", value: 1 } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
  });

  it("counts a re-roll of a non-combat roll (charge) as outside the damage path", () => {
    const { unsupported } = effectToBuffs({ type: "re-roll", target: "this-unit", modifier: { roll: "charge", subset: "all" } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
  });

  it("keeps a damage-path re-roll with an unparseable subset as an unrecognized shape, not outside the damage path", () => {
    // Same "... is outside the damage path" wording as the charge case above, but this one is a
    // real gap: "hit" IS a damage-path roll, the subset value is just something the cruncher
    // can't parse — the two must not collapse into the same bucket just because of the message.
    const { unsupported } = effectToBuffs({ type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "bogus" } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });

  const classify = (effect: Record<string, unknown>) => classifyUnsupported(effectToBuffs(effect, source, ctx).unsupported);
  const gap = { honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 };
  const outside = { honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 };

  it("looks through a predicated selection: a battle-shock test is off the damage path, a re-roll inside it is a lever", () => {
    const selector = { filter: { owner: "enemy" }, count: { min: 1, max: 1 }, eligibility: { type: "matches", parameters: { subject: "selected-unit", filter: { engaged_with: "this-unit" } } } };
    expect(classify({ type: "select-units", selector, effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock", modifier: -1 } } })).toEqual(outside);
    expect(classify({ type: "select-units", selector: { ...selector, filter: { owner: "friendly" } }, effect: { type: "re-roll", target: "selected-unit", modifier: { roll: "wound", subset: "ones" } } })).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 0 });
  });

  it("counts a dice table off the damage path only when no outcome touches an attack", () => {
    const harm = { results: [2, 3, 4, 5, 6], effect: { type: "mortal-wounds", target: "selected-unit", modifier: { count: "D3" } } };
    const nothing = { results: [1], effect: { type: "no-effect" } };
    const hitPenalty = { results: [6], effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } };
    expect(classify({ type: "dice-table", dice: "D6", outcomes: [nothing, harm] })).toEqual(outside);
    expect(classify({ type: "dice-table", dice: "D6", outcomes: [nothing, { ...harm, results: [2, 3, 4, 5] }, hitPenalty] })).toEqual(gap);
  });

  it("separates deployment grants and non-combat roll results from damage-path ones", () => {
    expect(classify({ type: "ability-grant", target: "this-unit", modifier: { ability: "scouts", value: 6 } })).toEqual(outside);
    expect(classify({ type: "roll-result", target: "this-unit", modifier: { roll: "advance", result: 6 } })).toEqual(outside);
    expect(classify({ type: "roll-result", target: "this-unit", modifier: { roll: "hit", critical_on: 5 } })).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 0 });
    expect(classify({ type: "roll-result", target: "this-unit", modifier: { roll: "hit", succeeds_on: 5 } })).toEqual(gap);
  });

  it("does not count a defender Toughness lift the target perspective models", () => {
    expect(classify({ type: "stat-modifier", target: "this-unit", modifier: { stat: "T", operation: "add", value: 1 } })).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 0 });
  });

  it("judges a printed grant by the body it carries", () => {
    const grant = (body: Record<string, unknown>) => ({ type: "ability-grant", target: { owner: "friendly", all_of: ["EXAMPLE"] }, modifier: { ability: "fabricated-terror", definition: body } });
    expect(classify(grant({ type: "test", target: "this-unit", modifier: { test: "battle-shock" } }))).toEqual(outside);
    const reroll = effectToBuffs(grant({ type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } }), source, ctx);
    expect(reroll.unsupported).toEqual([]);
    expect(reroll.applied.map((buff) => buff.contribution)).toEqual([{ type: "reroll", roll: "hit", subset: "ones" }]);
  });

  it("counts a record grant by the record: off the path when it changes no attack, covered when it reaches the unit", () => {
    const records: Record<string, unknown> = {
      "fabricated-cost-rule": { type: "cost-modifier", target: "this-unit", modifier: { of: "stratagem", operation: "increase", amount: 1 } },
      "fabricated-reroll-rule": { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
      "fabricated-half-rule": { type: "sequence", steps: [
        { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
        { type: "roll-result", target: "this-unit", modifier: { roll: "hit", succeeds_on: 5 } },
      ] },
    };
    const grantOf = (ability: string, target: unknown = "this-unit") => effectToBuffs({ type: "ability-grant", target, modifier: { ability } }, source, ctx).unsupported;
    const resolve = (id: string) => records[id];
    expect(classifyUnsupported(grantOf("fabricated-cost-rule"), resolve)).toEqual(outside);
    // stackableBuffsFor pulls a record granted to the unit onto it as levers.
    expect(classifyUnsupported(grantOf("fabricated-reroll-rule"), resolve)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 0 });
    expect(classifyUnsupported(grantOf("fabricated-reroll-rule", { owner: "friendly", all_of: ["EXAMPLE"] }), resolve)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 0 });
    // What the granted record itself cannot model still counts.
    expect(classifyUnsupported(grantOf("fabricated-half-rule"), resolve)).toEqual(gap);
    // A damage record granted to an enemy unit is not pulled onto the crunched unit.
    expect(classifyUnsupported(grantOf("fabricated-reroll-rule", { owner: "enemy" }), resolve)).toEqual(gap);
    expect(classifyUnsupported(grantOf("fabricated-missing-rule"), resolve)).toEqual(gap);
    expect(classifyUnsupported(grantOf("fabricated-cost-rule"))).toEqual(gap);
  });

  it("still counts an honest runtime unknown as its own bucket, not outside the damage path", () => {
    const { unsupported } = effectToBuffs(
      { type: "conditional", condition: { type: "matches", parameters: { subject: "defender", filter: { designated: "X" } } }, effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } },
      source, ctx,
    );
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 1, outsideDamagePath: 0, unrecognizedShape: 0 });
  });

  describe("event-subject binding", () => {
    const effect = { type: "roll-modifier", target: "event-subject", modifier: { roll: "hit", operation: "add", value: 1 } };
    const filtered = { event: "used", filter: { kind: "example" }, subject: { owner: "friendly", all_of: ["EXAMPLE"] } };

    it("reports an unbound event subject as an unrecognized shape", () => {
      const { unsupported } = effectToBuffs(effect, source, ctx);
      expect(unsupported.map((item) => item.reason)).toEqual(['target "event-subject" is not resolved by the buff engine']);
      expect(classifyUnsupported(unsupported).unrecognizedShape).toBe(1);
    });

    it("judges a friendly trigger subject as the matching unit sees it", () => {
      const bound = assumeEventSubjectMatches(filtered, effect);
      expect(effectToBuffs(bound, source, ctx).applied.map((buff) => buff.contribution)).toEqual([{ type: "hit-mod", value: 1 }]);
      expect(assumeEventSubjectMatches({ ...filtered, subject: { owner: "enemy" } }, effect)).toBe(effect);
    });

    it("binds only a subject the buffed unit meets, and returns the effect itself when nothing binds", () => {
      expect(bindEventSubject(filtered, effect, { phase: "shooting", attackerKeywords: ["example"] }, "attacker")).toMatchObject({ target: "selected-unit" });
      expect(bindEventSubject(filtered, effect, { phase: "shooting", attackerKeywords: ["other"] }, "attacker")).toMatchObject({ target: "other-unit" });
      expect(bindEventSubject(filtered, effect, { phase: "shooting" }, "attacker")).toBe(effect);
      const alternatives = [filtered, { ...filtered, subject: "this-unit" }];
      expect(bindEventSubject(alternatives, effect, ctx, "attacker")).toBe(effect);
      const nested = { type: "ability-part", trigger: { event: "selected" }, effect };
      expect(bindEventSubject(filtered, nested, { phase: "shooting", attackerKeywords: ["example"] }, "attacker")).toBe(nested);
    });
  });
});
