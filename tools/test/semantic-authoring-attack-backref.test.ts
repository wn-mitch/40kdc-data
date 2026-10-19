import { describe, expect, it } from "vitest";

import { compileLeaves, shapeSignature, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording and keywords only; no rules prose.

type Part = [string, string, Record<string, unknown>];

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

/** Leaves on their own wording in `text`, in order, normalized as the current family version. */
function placed(text: string, ...items: Part[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text after byte ${from}`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalize(family, parameters), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, ...items: Part[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, ...items: Part[]): string[] {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics)}`);
  return result.errors;
}

const MELEE_BY_UNIT: Part = ["each time a model in this unit makes a melee attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }];
const ANY_BY_UNIT: Part = ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }];
const HIT_PLUS: Part = ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }];
const WOUND_PLUS: Part = ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }];
const REFERS: Record<string, unknown> = { refers: "earlier-attack" };
const isMelee = { type: "attack-is", parameters: { attack_type: "melee" } };
const isRanged = { type: "attack-is", parameters: { attack_type: "ranged" } };
const zetaDefender = { type: "matches", parameters: { subject: "defender", filter: { all_of: ["ZETA"] } } };
const hit = { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } };
const wound = { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } };

describe("attack@6 family checks", () => {
  it("keeps a back-reference to refers and a printed narrower type", () => {
    expect(normalize("attack", REFERS)).toEqual(REFERS);
    expect(normalize("attack", { refers: "earlier-attack", attack_type: "ranged" })).toEqual({ refers: "earlier-attack", attack_type: "ranged" });
  });

  it("refuses a back-reference that also names who attacks, which way, or any type", () => {
    expect(() => normalize("attack", { ...REFERS, direction: "makes" })).toThrow(/drop direction/u);
    expect(() => normalize("attack", { ...REFERS, unit: "this-unit" })).toThrow(/drop unit/u);
    expect(() => normalize("attack", { ...REFERS, target: "that-unit" })).toThrow(/drop target/u);
    expect(() => normalize("attack", { ...REFERS, attack_type: "any" })).toThrow(/melee, ranged or psychic/u);
    expect(() => normalize("attack", { refers: "antecedent" })).toThrow(/earlier-attack/u);
  });

  it("still requires direction, unit and type on an attack that does not refer back", () => {
    expect(() => normalize("attack", { unit: "this-unit", attack_type: "any" })).toThrow(/direction is required/u);
    expect(() => normalize("attack", { direction: "makes", attack_type: "any" })).toThrow(/unit is required/u);
    expect(normalize("attack", { direction: "makes", unit: "this-unit", attack_type: "any" })).toEqual({ direction: "makes", unit: "this-unit", attack_type: "any" });
  });

  it("allows target that-unit only on an attack another unit makes", () => {
    expect(normalize("attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }).target).toBe("that-unit");
    expect(() => normalize("attack", { direction: "targeted", unit: "this-unit", attack_type: "any", target: "that-unit" })).toThrow(/must be makes/u);
    expect(() => normalize("attack", { direction: "makes", unit: "that-unit", attack_type: "any", target: "that-unit" })).toThrow(/both make and receive/u);
  });
});

describe("Sub-shape A: an earlier attack named again", () => {
  const text = "While this unit fights, each time a model in this unit makes a melee attack, add 1 to the Hit roll. If that attack targets a ZETA unit, add 1 to the Wound roll as well.";

  it("gates only the later sentence's effect on the target the back-reference names", () => {
    const mechanics = mechanicsOf(text, MELEE_BY_UNIT, HIT_PLUS,
      ["that attack targets a", "attack", REFERS], ["ZETA unit", "unit-filter", { side: "enemy", keywords: ["ZETA"] }], WOUND_PLUS);
    // The antecedent's melee gate covers the whole ability; the back-reference adds no second one.
    expect(mechanics.effect).toEqual({ type: "conditional", condition: isMelee, effect: { type: "sequence", steps: [hit, { type: "conditional", condition: zetaDefender, effect: wound }] } });
  });

  it("prints the back-reference in the shape signature", () => {
    const leaves = placed(text, MELEE_BY_UNIT, HIT_PLUS, ["that attack targets a", "attack", REFERS], ["ZETA unit", "unit-filter", { side: "enemy", keywords: ["ZETA"] }], WOUND_PLUS);
    expect(shapeSignature(leaves, text)).toContain("EVENT(attack:refers)");
  });

  it("refuses a back-reference with no attack before it", () => {
    const own = "If that attack targets a ZETA unit, add 1 to the Wound roll.";
    expect(errorsOf(own, ["that attack targets a", "attack", REFERS], ["ZETA unit", "unit-filter", { side: "enemy", keywords: ["ZETA"] }], WOUND_PLUS))
      .toEqual(["'That attack' points back to an attack, but no attack leaf comes before it."]);
  });

  it("refuses a printed type that contradicts the attack it points back to", () => {
    const own = "Now each time a model in this unit makes a melee attack, add 1 to the Hit roll. If those ranged attacks target a ZETA unit, add 1 to the Wound roll.";
    expect(errorsOf(own, MELEE_BY_UNIT, HIT_PLUS, ["those ranged attacks target a", "attack", { ...REFERS, attack_type: "ranged" }],
      ["ZETA unit", "unit-filter", { side: "enemy", keywords: ["ZETA"] }], WOUND_PLUS)).toEqual(["'Those ranged attacks' names a different attack type from the attack it points back to."]);
  });

  it("repeats a printed narrower type for its own sentence only", () => {
    const own = "Now each time a model in this unit makes an attack, add 1 to the Hit roll. If those ranged attacks target a ZETA unit, add 1 to the Wound roll.";
    const mechanics = mechanicsOf(own, ANY_BY_UNIT, HIT_PLUS, ["those ranged attacks target a", "attack", { ...REFERS, attack_type: "ranged" }],
      ["ZETA unit", "unit-filter", { side: "enemy", keywords: ["ZETA"] }], WOUND_PLUS);
    expect(mechanics.effect).toEqual({ type: "sequence", steps: [hit, { type: "conditional", condition: { operator: "and", operands: [isRanged, zetaDefender] }, effect: wound }] });
  });

  it("repeats the antecedent's type when the antecedent comes after the ability's first effect", () => {
    const own = "This unit suffers D3 mortal wounds. Then each time a model in this unit makes a melee attack, add 1 to the Hit roll. If that attack targets a ZETA unit, add 1 to the Wound roll.";
    const mechanics = mechanicsOf(own, ["This unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "D3" }], MELEE_BY_UNIT, HIT_PLUS,
      ["that attack targets a", "attack", REFERS], ["ZETA unit", "unit-filter", { side: "enemy", keywords: ["ZETA"] }], WOUND_PLUS);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    // The antecedent's gate holds for its own sentence; the back-reference's sentence repeats it.
    expect(steps[1]).toEqual({ type: "conditional", condition: isMelee, effect: hit });
    expect(steps[2]).toEqual({ type: "conditional", condition: { operator: "and", operands: [isMelee, zetaDefender] }, effect: wound });
  });

  it("keeps the antecedent's attacker filter for the effects after the back-reference", () => {
    const own = "Each time a friendly ZETA unit that arrived this turn makes an attack, add 1 to the Hit roll. If that attack targets an OMEGA unit, add 1 to the Wound roll.";
    const mechanics = mechanicsOf(own, ["friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["that arrived this turn", "unit-activity", { activities: ["disembarked-this-turn"], subject: "antecedent", negated: false }],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }], HIT_PLUS,
      ["that attack targets an", "attack", REFERS], ["OMEGA unit", "unit-filter", { side: "enemy", keywords: ["OMEGA"] }], WOUND_PLUS);
    const steps = mechanics.effect.effect.steps as Array<Record<string, any>>;
    expect(steps[0]!.target).toEqual({ owner: "friendly", all_of: ["ZETA"] });
    expect(steps[1]!.effect.target).toEqual({ owner: "friendly", all_of: ["ZETA"] });
    expect(steps[1]!.condition).toEqual({ type: "matches", parameters: { subject: "defender", filter: { all_of: ["OMEGA"] } } });
  });

  it("never reads a filter before a back-reference as its attacker", () => {
    const own = "Each time a friendly unit makes an attack, add 1 to the Hit roll. If a ZETA unit makes that attack, add 1 to the Wound roll.";
    const errors = errorsOf(own, ["Each time a friendly unit makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }], HIT_PLUS,
      ["ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }], ["makes that attack", "attack", REFERS], WOUND_PLUS);
    expect(errors[0]).toMatch(/^A unit-filter needs/u);
  });

  it("lets an instead clause on the back-reference replace the earlier effect", () => {
    const own = "Now each time a model in this unit makes an attack, re-roll a Wound roll of 1. If the target of that attack is an enemy unit within range of an objective marker, re-roll the Wound roll instead.";
    const within = { type: "matches", parameters: { subject: "defender", filter: { within: { of: { objective: {} }, range: "objective-control" } } } };
    const mechanics = mechanicsOf(own, ANY_BY_UNIT, ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
      ["the target of that attack is an", "attack", REFERS], ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within range of an objective marker", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "target", negated: false }],
      ["re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }], ["instead", "instead", {}]);
    expect(mechanics.effect.steps.map((step: Record<string, any>) => step.condition)).toEqual([{ operator: "not", operands: [within] }, within]);
  });
});

const DESIGNATED = { type: "matches", parameters: { subject: "defender", filter: { designated: "afflicted" } } };

describe("Sub-shape C1: an attack on the designated or selected unit", () => {
  const text = "While a unit is afflicted, when a ZETA unit that arrived this turn targets that unit, those attacks have [LETHAL HITS].";
  const parts = (target: boolean): Part[] => [
    ["While a unit is afflicted", "designated-filter", { tag: "afflicted" }],
    ["ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
    ["that arrived this turn", "unit-activity", { activities: ["disembarked-this-turn"], subject: "antecedent", negated: false }],
    ["targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", ...(target ? { target: "that-unit" } : {}) }],
    ["those attacks have", "weapon-ability-grant", { subject: "attack", weapon_type: "all" }],
    ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
  ];

  it("checks the designation on the defender and gives the filtered attacker the grant", () => {
    const mechanics = mechanicsOf(text, ...parts(true));
    expect(mechanics.effect.condition.operands).toContainEqual(DESIGNATED);
    expect(mechanics.effect.condition.operands).toContainEqual({ type: "happened", parameters: { subject: "attacker", event: "disembarked", window: "turn" } });
    expect(mechanics.effect.effect.target).toEqual({ owner: "friendly", all_of: ["ZETA"] });
  });

  it("without target that-unit leaves the designation on no unit (the version-5 reading)", () => {
    const mechanics = mechanicsOf(text, ...parts(false));
    expect(JSON.stringify(mechanics)).not.toContain(JSON.stringify(DESIGNATED));
  });

  it("binds to the selected unit when no designation names it", () => {
    const own = "Select one enemy unit. Until the end of the turn, each time a friendly unit targets that unit, add 1 to the Hit roll.";
    const mechanics = mechanicsOf(own, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["each time a friendly unit targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }], HIT_PLUS);
    expect(mechanics.effect.type).toBe("designate-target");
    expect(JSON.stringify(mechanics.effect)).toContain("\"target\":{\"owner\":\"friendly\"}");
  });

  it("refuses an attack on 'that unit' with neither a designation nor a selection before it", () => {
    const own = "Each time a friendly unit targets that unit, add 1 to the Hit roll.";
    expect(errorsOf(own, ["Each time a friendly unit targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }], HIT_PLUS))
      .toContain("An attack targets 'that unit', but no designation or selection before it names the unit.");
  });
});

describe("Sub-shape C2: incoming attacks on each unit a filter matches", () => {
  const text = "While a friendly ZETA unit is within range of an objective marker, attacks that target that unit have -1 to Wound rolls.";
  const within = { type: "matches", parameters: { subject: "defender", filter: { within: { of: { objective: {} }, range: "objective-control" } } } };
  const minus = { type: "roll-modifier", target: "attacker", modifier: { roll: "wound", operation: "subtract", value: 1 } };
  const parts = (side: string): Part[] => [
    [`${side} ZETA unit`, "unit-filter", { side: side === "a" ? "any" : side, keywords: ["ZETA"] }],
    ["within range of an objective marker", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "antecedent", negated: false }],
    ["attacks that target that unit", "attack", { direction: "targeted", unit: "that-unit", attack_type: "any" }],
    ["have -1 to Wound rolls", "roll-modifier", { roll: "wound", operation: "subtract", value: 1 }],
  ];

  it("makes the filter's unit the defender, side included, with its conditions on the defender", () => {
    const mechanics = mechanicsOf(text, ...parts("friendly"));
    expect(mechanics.effect).toEqual({ type: "conditional", condition: { operator: "and", operands: [
      within, { type: "matches", parameters: { subject: "defender", filter: { owner: "friendly", all_of: ["ZETA"] } } },
    ] }, effect: minus });
  });

  it("adds no side check for a filter of either side", () => {
    const own = "While a ZETA unit is within range of an objective marker, attacks that target that unit have -1 to Wound rolls.";
    const mechanics = mechanicsOf(own, ...parts("a"));
    expect(mechanics.effect.condition).toEqual({ operator: "and", operands: [within, zetaDefender] });
  });

  it("leaves a filter right before the attack, with no condition between, to the paths that existed before", () => {
    const own = "Select one enemy unit. Friendly ZETA units' attacks that target that unit have -1 to Wound rolls.";
    const result = compileLeaves(placed(own, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["ZETA units", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["attacks that target that unit", "attack", { direction: "targeted", unit: "that-unit", attack_type: "any" }],
      ["have -1 to Wound rolls", "roll-modifier", { roll: "wound", operation: "subtract", value: 1 }]), own);
    expect(JSON.stringify(result)).not.toContain("owned-by");
  });

  it("gives way to a selection before the filter", () => {
    const own = "Select one enemy unit. While a friendly ZETA unit is within range of an objective marker, attacks that target that unit have -1 to Wound rolls.";
    const result = compileLeaves(placed(own, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }], ...parts("friendly")), own);
    expect(JSON.stringify(result)).not.toContain("owned-by");
  });
});

describe("Sub-shape B: an inline either/or between two effects", () => {
  const text = "When this unit is selected to shoot, you can re-roll one Hit roll or you can re-roll one Wound roll until those attacks are resolved.";
  const parts = (choice: boolean): Part[] => [
    ["When this unit is selected to shoot", "event", { kind: "selected", to: "shoot" }],
    ["you can", "optional-use", { who: "you" }],
    ["re-roll one Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all", count: 1 }],
    ...(choice ? [["or", "instead", { choice: true }] as Part] : []),
    ["you can", "optional-use", { who: "you" }],
    ["re-roll one Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all", count: 1 }],
    ["until those attacks are resolved", "duration", { endpoint: "end-of-attack-sequence" }],
  ];

  it("compiles a choice leaf on the 'or' as the player's pick of one effect", () => {
    const mechanics = mechanicsOf(text, ...parts(true));
    expect(mechanics.effect.type).toBe("choice");
    expect(mechanics.effect.options.map((option: Record<string, any>) => option.modifier.roll)).toEqual(["hit", "wound"]);
    expect(mechanics.scope).toEqual({ duration: "attack-sequence" });
  });

  it("without the choice leaf, the two effects still both apply", () => {
    const mechanics = mechanicsOf(text, ...parts(false));
    expect(mechanics.effect.type).toBe("sequence");
  });

  it("still refuses a choice leaf with no effect after it in its sentence", () => {
    // With no effect after it, the choice leaf has nothing earlier to replace and no group after it to offer.
    const own = "When this unit is selected to shoot, you can re-roll one Hit roll or not.";
    expect(errorsOf(own, ["When this unit is selected to shoot", "event", { kind: "selected", to: "shoot" }], ["you can", "optional-use", { who: "you" }],
      ["re-roll one Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all", count: 1 }], ["or", "instead", { choice: true }]))
      .toEqual(["\"Or:\" needs an effect on each side to choose between."]);
  });
});
