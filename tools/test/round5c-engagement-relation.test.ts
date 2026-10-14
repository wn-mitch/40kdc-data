import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected a refusal, but the leaves compiled");
  return result.errors.join("; ");
}

const ENGAGED_WITH_EARLIER = { states: ["engaged"], subject: "antecedent", negated: false, with: "antecedent" };
const SELECT_ENEMY = ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }] as const;

describe("Round 5C engaged-with-that-unit binding (SS2)", () => {
  it("refuses a state whose subject and named unit resolve to the same unit (a moment's unit)", () => {
    const text = "When an enemy unit falls back, it is engaged with it.";
    const message = errorsOf(placed(text,
      ["When an enemy unit falls back", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }],
      ["it is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject \(event-subject\)/);
  });

  it("refuses a state that engages the selected unit with itself", () => {
    const text = "Select one friendly unit. It is engaged with it.";
    const message = errorsOf(placed(text,
      ["Select one friendly unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["It is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject \(selected-unit\)/);
  });

  it("refuses a Stratagem target engaged with itself", () => {
    const text = "One ALPHA unit. It is engaged with it.";
    const message = errorsOf(placed(text,
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["It is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject/);
  });

  it("refuses a state whose named unit is the filter's own unit (the enemy filter names both)", () => {
    const text = "An enemy unit. It is engaged with it.";
    const message = errorsOf(placed(text,
      ["An enemy unit", "unit-filter", { side: "enemy" }],
      ["It is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject/);
  });

  it("refuses a named unit introduced in an earlier sentence that carries an effect", () => {
    // A sentence without an effect joins the next one (compile-placement.ts), so the introducing
    // sentence and the state's sentence each carry their own effect here.
    const text = "Select one friendly unit and add 1 to the Hit roll for it. If a unit engaged with it, add 1 to the Wound roll for this unit.";
    const message = errorsOf(placed(text,
      ["Select one friendly unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["add 1 to the Hit roll for it", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "antecedent" }],
      ["engaged with it", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false, with: "antecedent" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1, subject: "this-unit" }]), text);
    expect(message).toMatch(/introduced outside this sentence/);
  });
});

describe("Round 5C engaged-with-this-model selection (SS3)", () => {
  const text = "Select one enemy unit within Engagement Range of it. Add 1 to the Hit roll for that unit.";
  const effect = ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "antecedent" }] as const;

  it("names the model the selected unit is measured to", () => {
    const mechanics = mechanicsOf(placed(text, SELECT_ENEMY,
      ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-model" }],
      [...effect]), text);
    expect(JSON.stringify(mechanics)).toContain('"engaged_with":"this-model"');
  });

  it("names the unit when the state says this unit", () => {
    const mechanics = mechanicsOf(placed(text, SELECT_ENEMY,
      ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-unit" }],
      [...effect]), text);
    expect(JSON.stringify(mechanics)).toContain('"engaged_with":"this-unit"');
  });
});

describe("Round 5C engaged with a designated unit (SS5)", () => {
  const text = "One HERETIC ASTARTES unit is within Engagement Range of your focus of hatred. Add 1 to the Hit roll for that unit.";

  it("lowers the target's engagement with the designated enemy", () => {
    const mechanics = mechanicsOf(placed(text,
      ["One", "stratagem-target", { count: "one" }],
      ["HERETIC ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["HERETIC ASTARTES"] }],
      ["is within Engagement Range of", "unit-state", { states: ["engaged"], subject: "target", negated: false, with: "following-filter" }],
      ["your focus of hatred", "unit-filter", { side: "enemy", designated: "focus-of-hatred" }],
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }]), text);
    expect(JSON.stringify(mechanics)).toContain('"engaged_with":{"owner":"enemy","designated":"focus-of-hatred"}');
  });

  it("retains a designation on a selection's unit filter", () => {
    const selection = "Select one enemy unit that is your focus of hatred. That unit suffers 1 mortal wound.";
    const mechanics = mechanicsOf(placed(selection,
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["your focus of hatred", "unit-filter", { side: "enemy", designated: "focus-of-hatred" }],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]), selection);
    expect(mechanics.effect.selector.filter).toEqual({ owner: "enemy", designated: "focus-of-hatred" });
    expect(mechanics.effect.effect).toMatchObject({ type: "mortal-wounds", target: "selected-unit" });
  });
});

describe("Round 5C engaged with only the named units (SS1)", () => {
  const text = "While an enemy unit is only within Engagement Range of one or more FORTIFICATIONS from your army, add 1 to the Hit roll for this unit.";
  const enemyWhile = ["While an enemy unit", "unit-filter", { side: "enemy" }] as const;
  const exclusive = ["only", "engagement-exclusive", {}] as const;
  const engaged = ["within Engagement Range of one or more", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "following-filter" }] as const;
  const fortifications = ["FORTIFICATIONS", "unit-filter", { side: "friendly", keywords: ["FORTIFICATIONS"] }] as const;
  const effect = ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }] as const;

  it("folds the qualifier into a two-operand engagement: engaged with the named units, and with no other friendly unit", () => {
    const mechanics = mechanicsOf(placed(text, enemyWhile, exclusive, engaged, fortifications, effect), text);
    const condition = JSON.stringify(mechanics);
    expect(condition).toContain('"not_all_of":["FORTIFICATIONS"]');
    expect(condition).toContain('"all_of":["FORTIFICATIONS"]');
  });

  it("gives both operands the subject the state gets from the enemy filter", () => {
    const mechanics = mechanicsOf(placed(text, enemyWhile, exclusive, engaged, fortifications, effect), text);
    const subjects = [...JSON.stringify(mechanics).matchAll(/"type":"matches","parameters":\{"subject":(\{[^}]*\}),"filter":\{"engaged_with"/gu)].map((match) => match[1]);
    expect(subjects).toEqual(['{"owner":"enemy"}', '{"owner":"enemy"}']);
  });

  it("leaves the state plain without the qualifier (regression)", () => {
    const plain = placed(text, enemyWhile, engaged, fortifications, effect);
    const mechanics = mechanicsOf(plain, text);
    expect(JSON.stringify(mechanics)).not.toContain("not_all_of");
  });

  it("refuses the qualifier when no engaged state follows it in its clause", () => {
    const bare = "Only units are affected, and add 1 to the Hit roll for this unit.";
    const message = errorsOf(placed(bare, ["Only", "engagement-exclusive", {}], effect), bare);
    expect(message).toMatch(/no unit-state follows/);
  });

  it("refuses the qualifier when the state after it is negated", () => {
    const message = errorsOf(placed(text, enemyWhile, exclusive,
      ["within Engagement Range of one or more", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true, with: "following-filter" }],
      fortifications, effect), text);
    expect(message).toMatch(/plain engaged-with-filter/);
  });

  it("refuses a qualifier whose following filter carries a state", () => {
    const message = errorsOf(placed(text, enemyWhile, exclusive, engaged,
      ["FORTIFICATIONS", "unit-filter", { side: "friendly", keywords: ["FORTIFICATIONS"], states: ["battle-shocked"] }], effect), text);
    expect(message).toMatch(/friendly unit-filter of keywords alone/);
  });

  it("refuses two qualifiers on one state", () => {
    const twice = "While an enemy unit is only, and only, within Engagement Range of one or more FORTIFICATIONS from your army, add 1 to the Hit roll for this unit.";
    const message = errorsOf(placed(twice, enemyWhile, exclusive, ["only", "engagement-exclusive", {}], engaged, fortifications, effect), twice);
    expect(message).toMatch(/Two engagement-exclusive leaves/);
  });
});

describe("Round 5C unit-position named as the Engagement Range (SS4)", () => {
  const text = "The bearer is within Engagement Range of one or more enemy PSYKER units that are Battle-shocked. Add 1 to the Hit roll.";
  const distance = ["The bearer is within Engagement Range of one or more", "unit-position", { kind: "within", range_ref: "engagement", of: "following-filter", subject: "this-model", negated: false }] as const;
  const psykers = ["enemy PSYKER units that are Battle-shocked", "unit-filter", { side: "enemy", keywords: ["PSYKER"], states: ["battle-shocked"] }] as const;
  const effect = ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }] as const;

  it("measures the bearer to the enemy units within the Engagement Range", () => {
    const mechanics = mechanicsOf(placed(text, distance, psykers, effect), text);
    expect(JSON.stringify(mechanics)).toContain('"range":"engagement"');
  });

  it("refuses a beyond distance, a matching-unit measure and a counts-as use of the Engagement Range", () => {
    const version = currentFamilyVersion("unit-position");
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "beyond", range_ref: "engagement", of: "this-unit", subject: "this-unit", negated: false }, version)).toThrow(/beyond/);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", range_ref: "engagement", of: "matching-unit", of_side: "enemy", of_keywords: ["PSYKER"], subject: "this-unit", negated: false }, version)).toThrow(/matching-unit/);
    expect(() => normalizeFingerprintParameters("counts-as", { subject: "this-unit", range_ref: "engagement", of_side: "friendly" }, currentFamilyVersion("counts-as"))).toThrow();
  });

  it("keeps the named Synapse range as before", () => {
    expect(normalizeFingerprintParameters("unit-position", { kind: "within", range_ref: "synapse", of: "this-unit", subject: "this-unit", negated: false }, currentFamilyVersion("unit-position"))).toMatchObject({ range_ref: "synapse" });
  });
});

describe("Round 5C re-authored Charge-move selections (records 1400, 3058)", () => {
  // The base records wrote "within Engagement Range of it" as a state with the selected unit as its own
  // named unit (self-engagement). "it" is the moving unit or model, so each names that instead.
  const bodyUnit = (who: "this-unit" | "this-model") => {
    const text = `Each time ${who === "this-unit" ? "this unit" : "this model"} ends a Charge move, select one enemy unit within Engagement Range of it. That unit must take a Battle-shock test, subtracting 1 from that test.`;
    const leaves = placed(text,
      ["Each time", "event", { kind: "move-ended", move_types: ["charge"] }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: who }],
      ["That unit must take a Battle-shock test", "test", { target: "selected-unit", test: "battle-shock" }],
      ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]);
    return { text, leaves };
  };

  it("compiles a Charge-move selection engaged with this unit", () => {
    const { text, leaves } = bodyUnit("this-unit");
    expect(JSON.stringify(mechanicsOf(leaves, text))).toContain('"engaged_with":"this-unit"');
  });

  it("compiles a Charge-move selection engaged with this model", () => {
    const { text, leaves } = bodyUnit("this-model");
    expect(JSON.stringify(mechanicsOf(leaves, text))).toContain('"engaged_with":"this-model"');
  });
});
