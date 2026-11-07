import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { firstPartRounds } from "../src/semantic-authoring/compile-round-sections.js";
import { withSharedRoll } from "../src/semantic-authoring/compile-shared-roll.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const FIRST = "Opening round\nAt the start of the first battle round, for each enemy unit within the far zone, your opponent picks whether that unit hides or holds. You then roll one D6 for each of those units and apply the matching result below:\n"
  + "■ **Holding:** On a 3+, that unit suffers D3 mortal wounds.\n"
  + "■ **Hiding:** That unit is **battle-shocked**. On a 5+, that unit suffers D3 mortal wounds.\n";
const LATER = "Later rounds\nAt the start of your Command phase during the second to fifth battle rounds, roll one D6 for each enemy unit within the far zone. On a 3+, that unit suffers 1 mortal wound.";
const TEXT = FIRST + LATER;

const ZONE = (): Item => ["within the far zone", "in-region", { region_kind: "territory", territory: "enemy-deployment-zone", subject: "antecedent" }];
const PICK = (parameters: Record<string, unknown> = { chosen_by: "opponent" }): Item => ["your opponent picks whether that unit hides or holds", "choice-open", parameters];
const HIDING_SHOCK: Item = ["That unit is **battle-shocked**", "battle-shock-state", { recipient: "antecedent", set: true }];
const OPENING = (pick = PICK(), shock = HIDING_SHOCK): Item[] => [
  ["Opening round", "battle-round", { min: 1, max: 1 }],
  ["At the start of the", "turn-start", { turn: "battle-round" }],
  ["first battle round", "battle-round", { min: 1, max: 1 }],
  ["for each", "for-each-unit-select", {}],
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ZONE(),
  pick,
  ["roll one D6", "dice-roll", { dice: "D6" }],
  ["Holding", "named-option", { label: "Holding" }],
  ["On a 3+", "roll-result", { from: 3 }],
  ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "antecedent", count: "D3" }],
  ["Hiding", "named-option", { label: "Hiding" }],
  shock,
  ["On a 5+", "roll-result", { from: 5 }],
  ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "antecedent", count: "D3" }],
];
const FALLOUT = (rounds: Record<string, unknown> = { min: 2, max: 5 }): Item[] => [
  ["Later rounds", "battle-round", { min: 2 }],
  ["At the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }],
  ["the second to fifth battle rounds", "battle-round", rounds],
  ["roll one D6", "dice-roll", { dice: "D6" }],
  ["for each", "for-each-unit-select", {}],
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ZONE(),
  ["On a 3+", "roll-result", { from: 3 }],
  ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
];

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, {});
}

function mechanicsOf(items: Item[], text = TEXT): any {
  const result = compiled(items, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

const ROUND_ONE = { type: "battle-round", parameters: { min: 1, max: 1 } };
const holdingBand = { type: "dice-gated", dice: "D6", threshold: 3, comparison: "gte", on_success: { type: "mortal-wounds", target: "recipient", modifier: { count: "D3" } }, on_fail: null };

describe("a choice the opponent makes for each unit, with the roll printed before its options", () => {
  it("gives each option the one roll, and keeps an option's effect before its band out of the band", () => {
    const first = mechanicsOf([...OPENING(), ...FALLOUT()]).effect.steps[0];
    const choice = first.effect.effect.effect.effect;
    expect(choice).toEqual({ type: "choice", chosen_by: "opponent", options: [
      holdingBand,
      { type: "sequence", steps: [
        { type: "state-change", target: "recipient", modifier: { state: "battle-shocked", set: true } },
        { type: "dice-gated", dice: "D6", threshold: 5, comparison: "gte", on_success: { type: "mortal-wounds", target: "recipient", modifier: { count: "D3" } }, on_fail: null },
      ] },
    ] });
    expect(first.effect.effect.effect.condition).toEqual({ type: "in-region", parameters: { subject: "recipient", region: { territory: "enemy-deployment-zone" } } });
    expect(describeAbility({ id: "sample", name: "Sample", effect: choice } as any)).toMatch(/^Your opponent selects one of the following/u);
  });

  it("leaves the choice to the player without chosen_by", () => {
    const choice = mechanicsOf([...OPENING(PICK({})), ...FALLOUT()]).effect.steps[0].effect.effect.effect.effect;
    expect(choice.type).toBe("choice");
    expect(choice.chosen_by).toBeUndefined();
  });

  it("takes chosen_by opponent only, and only on a plain pick", () => {
    const version = currentFamilyVersion("choice-open");
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("choice-open", parameters, version);
    expect(normalize({ chosen_by: "opponent" })).toEqual({ chosen_by: "opponent" });
    expect(() => normalize({ chosen_by: "you" })).toThrow(/opponent or omitted/u);
    expect(() => normalize({ chosen_by: "opponent", or_random: { dice: "D6", count: 1 } })).toThrow(/plain pick/u);
  });

  it("binds an option's \"that unit\" to the loop's unit (battle-shock-state recipient antecedent)", () => {
    const version = currentFamilyVersion("battle-shock-state");
    expect(normalizeFingerprintParameters("battle-shock-state", { recipient: "antecedent", set: true }, version)).toEqual({ recipient: "antecedent", set: true });
    const shock = mechanicsOf([...OPENING(), ...FALLOUT()]).effect.steps[0].effect.effect.effect.effect.options[1].steps[0];
    expect(shock.target).toBe("recipient");
  });
});

describe("the roll printed before a choice's first named option (compile-shared-roll.ts)", () => {
  const leaf = (family_id: string): CompileLeaf => ({ role: "EFFECT", family_id, family_version: 1, parameters: {}, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" });
  const roll = leaf("dice-roll");
  const option = (...families: string[]) => [leaf("named-option"), ...families.map(leaf)];

  it("moves into each option that reads it", () => {
    const shared = withSharedRoll([[roll], option("roll-result"), option("roll-result", "mortal-wounds")], "named-option");
    expect(shared.map((group) => group.map((item) => item.family_id))).toEqual([["named-option", "dice-roll", "roll-result"], ["named-option", "dice-roll", "roll-result", "mortal-wounds"]]);
  });

  it("stays where it is unless it is one roll before two or more options that each have a band", () => {
    for (const groups of [
      [[leaf("mortal-wounds")], option("roll-result"), option("roll-result")],
      [[roll, leaf("mortal-wounds")], option("roll-result"), option("roll-result")],
      [[roll], option("roll-result")],
      [[roll], option("roll-result"), option("mortal-wounds")],
      [[roll], option("roll-result"), [leaf("roll-result")]],
    ]) expect(withSharedRoll(groups, "named-option")).toEqual(groups);
  });
});

describe("a choice of named options followed by a later part (compile-containers.ts)", () => {
  it("ends the last option at a line that opens a moment, which compiles as its own part", () => {
    const steps = mechanicsOf([...OPENING(), ...FALLOUT()]).effect.steps;
    expect(steps).toHaveLength(2);
    expect(steps[1].trigger.event).toBe("phase-started");
    expect(JSON.stringify(steps[0])).not.toContain("\"count\":1}");
  });

  it("keeps a moment printed on a new line inside an option that has no effect yet", () => {
    const text = "Select one of the following:\n**Watchful**\nAt the start of your Command phase, this unit suffers 1 mortal wound.\n**Restful**\nAt the end of your Fight phase, this unit suffers 2 mortal wounds.";
    const items: Item[] = [
      ["Select one of the following", "choice-open", {}],
      ["Watchful", "named-option", { label: "Watchful" }],
      ["At the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
      ["Restful", "named-option", { label: "Restful" }],
      ["At the end of your Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "your" }],
      ["this unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "2" }],
    ];
    const effect = mechanicsOf(items, text).effect;
    expect(effect.type).toBe("choice");
    expect(effect.options).toHaveLength(2);
  });
});

describe("battle-round conditions over the first part only (compile-round-sections.ts)", () => {
  it("gate the first part, not the later part whose rounds they exclude", () => {
    const [first, later] = mechanicsOf([...OPENING(), ...FALLOUT()]).effect.steps;
    expect(first.effect.condition).toEqual(ROUND_ONE);
    expect(JSON.stringify(later)).not.toContain(JSON.stringify(ROUND_ONE));
  });

  it("keep gating the whole record when the later part's rounds meet them", () => {
    const global = [ROUND_ONE, { type: "battle-round", parameters: { min: 2 } }, { type: "phase-is", parameters: { phase: "command" } }];
    expect(firstPartRounds(global, [{ type: "conditional", condition: { type: "battle-round", parameters: { min: 1, max: 3 } } }])).toEqual([]);
    expect(firstPartRounds(global, [{ type: "conditional", condition: { type: "battle-round", parameters: { min: 2, max: 5 } } }])).toEqual([ROUND_ONE]);
    expect(firstPartRounds(global, [{ type: "conditional", condition: { type: "battle-round", parameters: { min: 1, max: 1 } } }])).toEqual([global[1]]);
    expect(firstPartRounds(global, [{ type: "conditional", condition: { type: "phase-is", parameters: { phase: "fight" } } }])).toEqual([]);
  });
});
