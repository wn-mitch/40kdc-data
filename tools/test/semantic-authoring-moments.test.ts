import { describe, expect, it } from "vitest";
import { inheritClauseBands } from "../src/semantic-authoring/compile-clause-band.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { familyRole, normalizeFingerprintParameters, currentFamilyVersion } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/effect.js";
import { expectRefused } from "./semantic-authoring-connective-fixture.js";

// semantic-authoring-event-used-object
{
// Fabricated wording only; no rules text.

const normalize = (parameters: Record<string, unknown>, version: number) => normalizeFingerprintParameters("event", parameters, version);

function leaf(text: string, wording: string, family: string, version: number, parameters: Record<string, unknown>): CompileLeaf {
  const start = Buffer.from(text).indexOf(Buffer.from(wording));
  if (start < 0) throw new Error(`"${wording}" is not in the text`);
  return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(wording), fragment: "RAW_TEXT" };
}

describe("event object on a used rule (the unit an Order is issued to)", () => {
  const order = { kind: "used", activity: "order" };

  it("accepts object on a used event at version 35 and not before", () => {
    expect(normalize({ ...order, object: "this-unit" }, 35)).toEqual({ ...order, object: "this-unit" });
    expect(() => normalize({ ...order, object: "this-unit" }, 34)).toThrow();
    expect(() => normalize({ ...order, object: "antecedent" }, 35)).toThrow(/event.object/);
    expect(normalize(order, 35)).toEqual(order);
  });

  it("lowers to a used trigger aimed at the unit, not one the unit makes", () => {
    const text = "Each time this squad is given an Order, it can move 1\".";
    const result = compileLeaves([
      leaf(text, "Each time this squad is given an Order", "event", 35, normalize({ ...order, object: "this-unit" }, 35)),
      leaf(text, "it can move 1\"", "make-move", 6, { subject: "this-unit", move_type: "normal", inches: 1 }),
    ], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as Record<string, any>;
    expect(mechanics.trigger).toEqual({ event: "used", filter: { kind: "order" }, object: "this-unit" });
  });
});

describe("event object on a used Stratagem (the unit the Stratagem targets)", () => {
  const text = "Once per turn, when its squad is picked by a Stratagem, lower the CP cost of that use of that Stratagem by 1CP.";
  const leaves = (event: Record<string, unknown>) => [
    leaf(text, "its squad is picked by a Stratagem", "event", 35, normalize(event, 35)),
    leaf(text, "lower the CP cost of that use of that Stratagem by 1CP", "stratagem-cost", 1, { of: "stratagem", operation: "decrease", amount: 1, applies_to: "the-triggering-use" }),
  ];

  it("keeps the targeted unit on the trigger and says so", () => {
    const result = compileLeaves(leaves({ kind: "used", activity: "stratagem", object: "this-unit" }), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as Record<string, any>;
    expect(mechanics.trigger).toMatchObject({ event: "used", filter: { kind: "stratagem" }, object: "this-unit" });
    const prose = describeAbility({ ability_id: "fabricated", name: "Fabricated", ...mechanics } as never);
    expect(prose).toMatch(/^Each time you target the unit with a Stratagem, /);
    expect(prose).not.toMatch(/use a Stratagem/i);
  });

  it("names a targeted Stratagem by name", () => {
    const result = compileLeaves(leaves({ kind: "used", activity: "stratagem", id: "heroic-intervention", object: "this-unit" }), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as Record<string, any>;
    expect(mechanics.trigger).toMatchObject({ filter: { kind: "stratagem", id: "heroic-intervention" }, object: "this-unit" });
    expect(describeAbility({ ability_id: "fabricated", name: "Fabricated", ...mechanics } as never)).toMatch(/^When you target the unit with the Heroic Intervention Stratagem, /);
  });

  it("still reads any Stratagem use when no object is named", () => {
    const result = compileLeaves(leaves({ kind: "used", activity: "stratagem" }), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as Record<string, any>;
    expect(mechanics.trigger.object).toBeUndefined();
    expect(describeAbility({ ability_id: "fabricated", name: "Fabricated", ...mechanics } as never)).toMatch(/each time you use a Stratagem/i);
  });
});
}

// semantic-authoring-optional-moments
{
/**
 * Which trigger moments an optional-use makes optional. The moments of the sentence that offers the
 * use (and the WHEN clauses before it) are the player's choice; a moment opened in a later sentence
 * ("If you do, …, when this unit …") is mandatory once the ability was used. Wording is fabricated.
 */

type Piece = [wording: string, family: string, parameters: Record<string, unknown>];

function placed(text: string, ...items: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    const normalized = normalizeFingerprintParameters(family, parameters, version);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalized, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function triggerOf(text: string, ...items: Piece[]): Array<Record<string, unknown>> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const trigger = (result.mechanics as unknown as { trigger: unknown }).trigger;
  return Array.isArray(trigger) ? trigger as Array<Record<string, unknown>> : [trigger as Record<string, unknown>];
}

const selected = (wording: string, to: string): Piece => [wording, "event", { kind: "selected", to }];
const useIt = (wording: string): Piece => [wording, "optional-use", { who: "this-model" }];
const reroll = (wording: string): Piece => [wording, "reroll", { roll: "charge", subset: "all", weapon_type: "all" }];
const declares = (wording: string): Piece => [wording, "event", { kind: "targets-selected", action_kind: "charge" }];

describe("optional-use and the moments it governs", () => {
  it("keeps alternative moments of the sentence that offers the use optional", () => {
    const text = "When this unit is selected to shoot or when it is selected to fight, you can use this ability. This unit can re-roll a charge roll.";
    const moments = triggerOf(text,
      selected("is selected to shoot", "shoot"), selected("is selected to fight", "fight"), useIt("you can use this ability"), reroll("re-roll a charge roll"));
    expect(moments).toHaveLength(2);
    expect(moments.every((moment) => moment.optional === true)).toBe(true);
  });

  it("makes a moment opened after \"if you do\" mandatory while the offering moment stays optional", () => {
    const text = "When this unit is selected to shoot, you can use this ability. If you do, until the end of the turn, when this unit declares a charge, this unit can re-roll that charge roll.";
    const moments = triggerOf(text,
      selected("is selected to shoot", "shoot"), useIt("you can use this ability"), declares("declares a charge"), reroll("re-roll that charge roll"));
    expect(moments).toHaveLength(2);
    expect(moments[0]!.optional).toBe(true);
    expect(moments[1]!.optional).toBeUndefined();
  });

  it("keeps a lone dependent moment optional when no moment offers the use", () => {
    const text = "In the Fight phase, you can use this ability. If you do, when this unit declares a charge, this unit can re-roll that charge roll.";
    const moments = triggerOf(text, useIt("you can use this ability"), declares("declares a charge"), reroll("re-roll that charge roll"));
    expect(moments).toHaveLength(1);
    expect(moments[0]!.optional).toBe(true);
  });
});
}

// semantic-authoring-nested-moment
{
type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order, all in RAW_TEXT (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
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

const shocked: Item = ["this unit is shaken", "battle-shock-state", { recipient: "this-unit", set: true }];
const reaction = (): Item[] => [
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["makes a retreat", "event", { kind: "move-ended", move_types: ["fall-back"] }],
  ["that enemy unit must take a test", "test", { target: "antecedent", test: "leadership" }],
];
const phaseStart: Item = ["Start of the opposing Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "opponent" }];
const offer: Item = ["you can use this", "optional-use", { who: "you" }];

const compiled = (text: string, ...items: Item[]) => {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as { effect: Record<string, any> };
};
const refusal = (text: string, ...items: Item[]) => {
  const result = compileLeaves(placed(text, ...items), text);
  return result.ok ? null : result.errors.join("; ");
};

describe("a later moment under the use the first moment offers", () => {
  const ifYouDo = "Start of the opposing Movement phase, you can use this. If you do: this unit is shaken. When an enemy unit makes a retreat, that enemy unit must take a test.";

  it("nests in the entry part for the phase, instead of standing as a sibling part", () => {
    const { effect } = compiled(ifYouDo, phaseStart, offer, shocked, ...reaction());
    expect(effect.type).toBe("ability-part");
    expect(effect.trigger).toMatchObject({ event: "phase-started", optional: true });
    const [first, nested] = effect.effect.steps;
    expect(first.type).toBe("state-change");
    expect(nested).toMatchObject({ type: "ability-part", duration: "phase", trigger: { event: "move-ended", filter: { move_types: ["fall-back"] } } });
    // The nested moment is not a second offer of the use.
    expect(nested.trigger.optional).toBeUndefined();
  });

  it("keeps the moment a sibling part when 'if you do' is not printed between the use and the moment", () => {
    const text = "Start of the opposing Movement phase, you can use this. Then this unit is shaken. When an enemy unit makes a retreat, that enemy unit must take a test.";
    const { effect } = compiled(text, phaseStart, offer, shocked, ...reaction());
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step: Record<string, any>) => step.type)).toEqual(["ability-part", "ability-part"]);
    expect(JSON.stringify(effect.steps[0])).not.toContain("move-ended");
  });

  it("keeps the moment a sibling part when the first moment is not the start of a phase", () => {
    const text = "When this unit is chosen to shoot, you can use this. If you do: this unit is shaken. When an enemy unit makes a retreat, that enemy unit must take a test.";
    const { effect } = compiled(text, ["When this unit is chosen to shoot", "event", { kind: "selected", to: "shoot", subject: "this-unit" }], offer, shocked, ...reaction());
    expect(effect.type).toBe("sequence");
    expect(JSON.stringify(effect)).not.toContain('"duration":"phase"');
  });

  it("does not move a moment that comes before the use into the use", () => {
    const text = "Start of the opposing Movement phase, this unit is shaken. If you do: you can use this. When an enemy unit makes a retreat, that enemy unit must take a test.";
    const { effect } = compiled(text, phaseStart, shocked, offer, ...reaction());
    expect(JSON.stringify(effect)).not.toContain('"duration":"phase"');
    expect(refusal(text, phaseStart, shocked, offer, ...reaction())).toBeNull();
  });
});
}

// semantic-authoring-clause-timing
{
/** A registered designation, so a designate-target compiles (compile-wrappers.ts designationIdFor). */
const FIXTURE_RULE_NAME = "A Trap Well Laid";

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
  const result = compileLeaves(list, text, { name: FIXTURE_RULE_NAME });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** Every node of a JSON tree whose `type` is `type`. */
function nodesOf(tree: unknown, type: string): Record<string, any>[] {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodesOf(item, type));
  if (tree === null || typeof tree !== "object") return [];
  const record = tree as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((value) => nodesOf(value, type))];
}

const ENEMY_SELECT: [string, string, Record<string, unknown>] = ["Choose one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }];
const D6 = ["Roll one D6", "dice-roll", { dice: "D6" }] as [string, string, Record<string, unknown>];
const ON_5 = ["on a 5+", "roll-result", { from: 5 }] as [string, string, Record<string, unknown>];

describe("Result band covers the later clauses of its sentence (compile-clause-band.ts)", () => {
  // 5814 shape: the test in the "and" clause sits under the band with the mortal wounds.
  const BAND_TEXT = "Choose one enemy unit. Roll one D6: on a 5+, that unit suffers 3 mortal wounds and must take a Battle-shock test.";
  const bandLeaves = (text: string) => placed(text,
    ENEMY_SELECT, D6, ON_5,
    ["that unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }],
    ["must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }]);

  it("puts the test of an 'and' clause under the same dice-gated success as the mortal wounds", () => {
    const mechanics = mechanicsOf(bandLeaves(BAND_TEXT), BAND_TEXT);
    const gated = nodesOf(mechanics, "dice-gated");
    expect(gated).toHaveLength(1);
    expect(gated[0]!.threshold).toBe(5);
    const steps = gated[0]!.on_success.steps as Record<string, any>[];
    expect(steps.map((step) => step.type)).toEqual(["mortal-wounds", "test"]);
  });

  it("does not carry a band past its sentence: the next sentence's effect is ungated", () => {
    const text = "Choose one enemy unit. Roll one D6: on a 5+, that unit suffers 3 mortal wounds. That unit must take a Battle-shock test.";
    const mechanics = mechanicsOf(placed(text,
      ENEMY_SELECT, D6, ON_5,
      ["that unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }],
      ["That unit must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }]), text);
    const gated = nodesOf(mechanics, "dice-gated");
    expect(gated).toHaveLength(1);
    expect(JSON.stringify(gated[0]!.on_success)).not.toContain('"type":"test"');
    expect(JSON.stringify(mechanics)).toContain('"type":"test"');
  });

  it("gives a clause before the band no band of its own", () => {
    const text = "Choose one enemy unit. Roll one D6: that unit must take a Battle-shock test, and on a 5+, that unit suffers 3 mortal wounds.";
    const mechanics = mechanicsOf(placed(text,
      ENEMY_SELECT, D6,
      ["that unit must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }],
      ON_5,
      ["that unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }]), text);
    const gated = nodesOf(mechanics, "dice-gated");
    expect(gated).toHaveLength(1);
    expect(JSON.stringify(gated[0]!.on_success)).toContain('"type":"mortal-wounds"');
    expect(JSON.stringify(gated[0]!.on_success)).not.toContain('"type":"test"');
  });

  it("leaves a fight-on-death band's sentence alone: its band is the per-model gate, not a clause gate", () => {
    const clauseGates = new Map<number, Record<string, unknown>[]>([[1, [{ type: "__roll-result", from: 2 }]]]);
    inheritClauseBands(clauseGates, [{ sentence: 0, clause: 0 }, { sentence: 1, clause: 1 }, { sentence: 1, clause: 2 }], new Set([1]));
    expect(clauseGates.get(2)).toBeUndefined();
  });

  it("does not inherit into a clause of another sentence (the helper alone)", () => {
    const clauseGates = new Map<number, Record<string, unknown>[]>([[0, [{ type: "__roll-result", from: 5 }]]]);
    inheritClauseBands(clauseGates, [{ sentence: 0, clause: 0 }, { sentence: 1, clause: 1 }], new Set());
    expect(clauseGates.get(1)).toBeUndefined();
  });
});

describe("Instead inside a band's sentence (7195 shape)", () => {
  it("replaces the banded mortal wounds under the same success, with no band marker left in the condition", () => {
    const text = "Choose one enemy unit. Roll one D6: on a 2+, that unit suffers 1 mortal wound, or 2 mortal wounds instead if it is a VEHICLE unit.";
    const mechanics = mechanicsOf(placed(text,
      ENEMY_SELECT, D6, ["on a 2+", "roll-result", { from: 2 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
      ["or", "instead", {}],
      ["2 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "2" }],
      ["if it is a VEHICLE unit", "unit-keyword", { keywords: ["VEHICLE"], subject: "antecedent", negated: false }]), text);
    expect(JSON.stringify(mechanics)).not.toContain("__roll-result");
    const gated = nodesOf(mechanics, "dice-gated");
    expect(gated).toHaveLength(1);
    const counts = nodesOf(gated[0]!.on_success, "mortal-wounds").map((node) => node.modifier.count);
    expect(counts).toEqual([1, 2]);
  });
});

describe("Optional spend before a designated selection (compile.ts designatedSpends)", () => {
  // 4243 shape: the spend precedes the selection; the designated read sets the AP on the attacks against that unit.
  const SPEND_TEXT = "Your Shooting phase. One ORBITAL unit from your army. Each time you use this Stratagem, you can spend 3YP. Select one enemy unit. Ranged attacks made by your unit that target that unit improve the Armour Penetration characteristic by 1. If you spent YP during this use of this Stratagem, ranged attacks made by your unit that target that unit improve the Armour Penetration characteristic by 2 instead.";
  const spendLeaves = (text: string) => placed(text,
    ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
    ["One", "stratagem-target", { count: "one" }],
    ["ORBITAL unit", "unit-filter", { side: "friendly", keywords: ["ORBITAL"] }],
    ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
    ["you can", "optional-use", { who: "you" }],
    ["spend 3YP", "resource-spend", { pool: "yp-pool", amount: 3 }],
    ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["Ranged attacks made by your unit that target that unit", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged", target: "that-unit" }],
    ["improve the Armour Penetration characteristic by 1", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "ranged" }],
    ["If you spent YP during this use of this Stratagem", "optional-cost-paid", { pool: "yp-pool", window: "use", subject: "attacker", tag: "yp-spent-this-use" }],
    ["ranged attacks made by your unit that target that unit", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged", target: "that-unit" }],
    ["improve the Armour Penetration characteristic by 2", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 2, weapon_type: "ranged" }],
    ["instead", "instead", {}],
  );

  it("lifts the spend out of the designation's body, so the spend and its designate come first", () => {
    const mechanics = mechanicsOf(spendLeaves(SPEND_TEXT), SPEND_TEXT);
    const steps = mechanics.effect.steps as Record<string, any>[];
    expect(steps[0]!.type).toBe("ability-part");
    expect(steps[0]!.optional).toBe(true);
    expect(steps[0]!.effect.steps.map((step: Record<string, unknown>) => step.type)).toEqual(["resource-spend", "designate"]);
    expect(steps[1]!.type).toBe("designate-target");
  });

  it("keeps the designated read on the attacker that the designate sets the tag for", () => {
    const mechanics = mechanicsOf(spendLeaves(SPEND_TEXT), SPEND_TEXT);
    expect(JSON.stringify(mechanics)).toContain('{"type":"matches","parameters":{"subject":"attacker","filter":{"designated":"yp-spent-this-use"}}}');
  });

  it("limits an instead that replaces a selected effect to the selection, with no attack leaf in its own clause", () => {
    // The 4243 record's instead clause names no unit: only the first clause says "that target that unit".
    const leaves = spendLeaves(SPEND_TEXT).filter((leaf) => leaf.start_byte !== SPEND_TEXT.indexOf("ranged attacks made by your unit that target that unit"));
    const mechanics = mechanicsOf(leaves, SPEND_TEXT);
    expect(JSON.stringify(mechanics)).toContain('{"type":"matches","parameters":{"subject":"attacker","filter":{"designated":"yp-spent-this-use"}}}');
    expect(JSON.stringify(mechanics)).toContain('"value":2');
  });

  it("gives an instead with no attack of its own the attack type of the clause it replaces", () => {
    // 4243: "improve the AP of that attack by 2 instead" is melee-only because the replaced clause's attack is.
    const leaves = spendLeaves(SPEND_TEXT).filter((leaf) => leaf.start_byte !== SPEND_TEXT.indexOf("ranged attacks made by your unit that target that unit"));
    const mechanics = mechanicsOf(leaves, SPEND_TEXT);
    const bonus = nodesOf(mechanics, "conditional").filter((node) => node.effect?.modifier?.value === 2);
    expect(bonus).toHaveLength(1);
    expect(bonus[0]!.condition).toEqual({ operator: "and", operands: [
      { type: "attack-is", parameters: { attack_type: "ranged" } },
      { type: "matches", parameters: { subject: "attacker", filter: { designated: "yp-spent-this-use" } } },
    ] });
  });

  it("leaves an instead that names its own attack type with that type", () => {
    const text = SPEND_TEXT.replace("ranged attacks made by your unit that target that unit improve the Armour Penetration characteristic by 2", "melee attacks made by your unit that target that unit improve the Armour Penetration characteristic by 2");
    const leaves = spendLeaves(SPEND_TEXT).map((leaf) => leaf.start_byte > SPEND_TEXT.indexOf("If you spent") && leaf.family_id === "attack" ? { ...leaf, parameters: { ...leaf.parameters, attack_type: "melee" } } : leaf);
    const bonus = nodesOf(mechanicsOf(leaves, text), "conditional").filter((node) => node.effect?.modifier?.value === 2);
    expect(JSON.stringify(bonus[0]!.condition)).toContain('"attack_type":"melee"');
    expect(JSON.stringify(bonus[0]!.condition)).not.toContain('"attack_type":"ranged"');
  });

  it("refuses a spend that comes after the selection", () => {
    const text = "Your Shooting phase. One ORBITAL unit from your army. Select one enemy unit. Each time you use this Stratagem, you can spend 3YP. If you spent YP during this use of this Stratagem, ranged attacks made by your unit that target that unit improve the Armour Penetration characteristic by 2 instead.";
    const leaves = placed(text,
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["One", "stratagem-target", { count: "one" }],
      ["ORBITAL unit", "unit-filter", { side: "friendly", keywords: ["ORBITAL"] }],
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
      ["you can", "optional-use", { who: "you" }],
      ["spend 3YP", "resource-spend", { pool: "yp-pool", amount: 3 }],
      ["If you spent YP during this use of this Stratagem", "optional-cost-paid", { pool: "yp-pool", window: "use", subject: "attacker", tag: "yp-spent-this-use" }],
      ["ranged attacks made by your unit that target that unit", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged", target: "that-unit" }],
      ["improve the Armour Penetration characteristic by 2", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 2, weapon_type: "ranged" }],
    );
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expectRefused(result);
    expect(result.errors.join(" ")).toContain("not every effect is limited to attacks against it");
  });
});

describe("Instead over a same-sentence group of re-rolls (8903 shape)", () => {
  const REROLL_TEXT = "Each time you use this Stratagem, you can spend 3YP. Until the end of the phase, each time a model in your unit makes an attack, you can re-roll a Hit roll of 1 and re-roll a Wound roll of 1. If you spent YP during this use of this Stratagem, you can re-roll the Hit roll and re-roll a Wound roll of 1 instead.";
  const rerollLeaves = (text: string) => placed(text,
    ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
    ["you can", "optional-use", { who: "you" }],
    ["spend 3YP", "resource-spend", { pool: "yp-pool", amount: 3 }],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["each time a model in your unit makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "any" }],
    ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones" }],
    ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones" }],
    ["If you spent YP during this use of this Stratagem", "optional-cost-paid", { pool: "yp-pool", window: "use", subject: "attacker", tag: "privateer-arsenal-yp-spent" }],
    ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all" }],
    ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones" }],
    ["instead", "instead", {}],
  );

  it("gates the default re-rolls on not designated and the replacements on designated, with no contradictory gate", () => {
    const mechanics = mechanicsOf(rerollLeaves(REROLL_TEXT), REROLL_TEXT);
    const conditionals = (mechanics.effect.steps as Record<string, any>[]).filter((step) => step.type === "conditional");
    expect(conditionals).toHaveLength(4);
    const [hitOnes, woundOnes, hitAll, woundInstead] = conditionals as [Record<string, any>, Record<string, any>, Record<string, any>, Record<string, any>];
    expect(hitOnes.condition).toEqual({ operator: "not", operands: [{ type: "matches", parameters: { subject: "attacker", filter: { designated: "privateer-arsenal-yp-spent" } } }] });
    expect(woundOnes.condition).toEqual(hitOnes.condition);
    expect(hitAll.condition).toEqual({ type: "matches", parameters: { subject: "attacker", filter: { designated: "privateer-arsenal-yp-spent" } } });
    expect(woundInstead.condition).toEqual(hitAll.condition);
    expect(JSON.stringify(mechanics)).not.toMatch(/"operator":"and","operands":\[\{"type":"designated"[^\]]*\},\{"operator":"not","operands":\[\{"type":"designated"/);
  });
});

describe("Parenthesised 'or' replaces a test modifier (7100 shape)", () => {
  const OR_TEXT = "Each enemy unit within 9 inches must take a Battle-shock test, subtracting 1 from that test (or subtracting 2 if that unit is a PSYKER).";
  const orLeaves = (text: string) => placed(text,
    ["Each", "for-each-unit-select", {}],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }],
    ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }],
    ["or", "instead", {}],
    ["subtracting 2", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 2 }],
    ["if that unit is a PSYKER", "unit-keyword", { keywords: ["PSYKER"], subject: "antecedent", negated: false }],
  );

  it("takes -1 unless the unit is a PSYKER, and -2 if it is, both on the test's own taker", () => {
    const mechanics = mechanicsOf(orLeaves(OR_TEXT), OR_TEXT);
    const tests = nodesOf(mechanics, "test");
    expect(tests.map((node) => node.modifier.modifier)).toEqual([-1, -2]);
    expect(tests.every((node) => node.target === "recipient")).toBe(true);
    expect(nodesOf(mechanics, "conditional")).toHaveLength(2);
    expect(JSON.stringify(mechanics)).not.toContain('"type":"test","target":"recipient","modifier":{"test":"battle-shock"}}');
  });

  it("keeps a plain change to the test folded into the test's own modifier", () => {
    const text = "This unit must take a Battle-shock test, subtracting 1 from that test.";
    const mechanics = mechanicsOf(placed(text,
      ["This unit must take a Battle-shock test", "test", { target: "this-unit", test: "battle-shock" }],
      ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]), text);
    expect(mechanics.effect).toEqual({ type: "test", target: "this-unit", modifier: { test: "battle-shock", modifier: -1 } });
  });

  const bearerLeaves = (text: string, wording: string) => placed(text,
    ["Each enemy unit must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }],
    ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }],
    ["or", "instead", {}],
    ["subtracting 2", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 2 }],
    [wording, "unit-keyword", { keywords: ["PSYKER"], subject: "this-unit", negated: false }]);

  it("keeps an instead whose condition says this unit when the test is another unit's: the bearer's size picks the penalty", () => {
    // 9199 shape: "-2 … if this unit has 13+ models" is about the bearer, so the -1 and -2 must not stack.
    const text = "Each enemy unit must take a Battle-shock test, subtracting 1 from that test (or subtracting 2 if this unit is a PSYKER).";
    const tests = nodesOf(mechanicsOf(bearerLeaves(text, "if this unit is a PSYKER"), text), "conditional");
    expect(tests).toHaveLength(2);
    expect(tests[1]!.condition.operands.at(-1)).toEqual({ type: "matches", parameters: { filter: { all_of: ["PSYKER"] } } });
    expect(JSON.stringify(tests[0]!.condition)).toContain('"all_of":["PSYKER"]');
    expect(tests[0]!.effect.target).toBe("recipient");
    expect(tests[1]!.effect.target).toBe("recipient");
  });

  it("refuses an instead whose this-unit condition is worded as another unit", () => {
    const text = "Each enemy unit must take a Battle-shock test, subtracting 1 from that test (or subtracting 2 if that unit is a PSYKER).";
    const result = compileLeaves(bearerLeaves(text, "if that unit is a PSYKER"), text, { name: FIXTURE_RULE_NAME });
    expectRefused(result);
    expect(result.errors.join(" ")).toContain("another unit's test");
  });
});

describe("'Neither X nor Y' as one negated keyword condition on the attack target (6134 leaf)", () => {
  it("requires the target to carry neither keyword", () => {
    const text = "Your unit makes an attack against an enemy unit. If that enemy unit is neither a MONSTER nor a VEHICLE, add 1 to the Wound roll.";
    const mechanics = mechanicsOf(placed(text,
      ["Your unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any", target: "any" }],
      ["an enemy unit", "unit-filter", { side: "enemy", keywords: ["INFANTRY"] }],
      ["If that enemy unit is neither a MONSTER nor a VEHICLE", "unit-keyword", { keywords: ["MONSTER", "VEHICLE"], subject: "target", negated: true }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]), text);
    expect(JSON.stringify(mechanics.effect.condition)).toContain('{"type":"matches","parameters":{"subject":"defender","filter":{"all_of":["MONSTER"]}}');
    expect(JSON.stringify(mechanics.effect.condition)).toContain('{"type":"matches","parameters":{"subject":"defender","filter":{"all_of":["VEHICLE"]}}');
  });
});
}
