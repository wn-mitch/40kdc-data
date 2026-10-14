import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-battle-round" });

function errorsOf(text: string, ...items: Item[]): string {
  const result = run(text, ...items);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
}

const TEXT = "Select a number of friendly ALPHA units equal to or less than the current battle round number. Those units must take a Battle-shock test.";
const SELECT: Item = ["Select a number of", "select-unit", { scope: "friendly", distance: "any", visible: false }];
const FILTER: Item = ["friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];
const ROUND: Item = ["equal to or less than the current battle round number", "count-by-battle-round", {}];
const SIZE: Item = ["equal to or less than", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }];
const EFFECT: Item = ["Those units must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }];

describe("Round 5C count by battle round: the family", () => {
  it("takes no parameters at its one version", () => {
    expect(normalizeFingerprintParameters("count-by-battle-round", {}, currentFamilyVersion("count-by-battle-round"))).toEqual({});
    expect(() => normalizeFingerprintParameters("count-by-battle-round", { max: 3 }, currentFamilyVersion("count-by-battle-round"))).toThrow();
    expect(familyRole("count-by-battle-round", currentFamilyVersion("count-by-battle-round"))).toBe("RESTRICTION");
  });

  it("leaves count-by-battle-size's parameters as they were", () => {
    const size = { incursion: 1, "strike-force": 2, onslaught: 3 };
    expect(normalizeFingerprintParameters("count-by-battle-size", size, currentFamilyVersion("count-by-battle-size"))).toEqual(size);
  });
});

describe("Round 5C count by battle round: compiling the selection's cap", () => {
  it("caps the selection at the battle round number and validates against the DSL", () => {
    const result = run(TEXT, SELECT, FILTER, ROUND, EFFECT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("select-units");
    expect(effect.selector.count).toEqual({ min: 0, max: { count_of: "battle-round" } });
    expect(effect.selector).not.toHaveProperty("max_count");
    expect(effect.selector.filter).toEqual({ owner: "friendly", all_of: ["ALPHA"] });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("keeps a plain battle-size selection compiling to its per-size cap", () => {
    const text = "Select a number of friendly ALPHA units equal to or less than the battle size limit. Those units must take a Battle-shock test.";
    const result = run(text, SELECT, FILTER, ["equal to or less than the battle size limit", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }], EFFECT);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.mechanics.effect as Record<string, any>).selector.count).toEqual({ min: 0, max: { incursion: 1, "strike-force": 2, onslaught: 3 } });
  });

  it("refuses both a battle-size and a battle-round count", () => {
    const text = "Select a number of friendly ALPHA units equal to the battle size limit or equal to or less than the current battle round number. Those units must take a Battle-shock test.";
    expect(errorsOf(text, SELECT, FILTER, ["equal to the battle size limit", ...SIZE.slice(1) as [string, Record<string, unknown>]], ROUND, EFFECT)).toContain("not both");
  });

  it("refuses a round count with no unit selection", () => {
    expect(errorsOf("Those units must take a Battle-shock test, equal to the current battle round number.", EFFECT, ["equal to the current battle round number", "count-by-battle-round", {}]))
      .toContain("needs the unit selection it limits");
  });

  it("refuses a round count on a selection that names its own count", () => {
    const own: Item = ["Select a number of", "select-unit", { scope: "friendly", distance: "any", visible: false, count: 2 }];
    expect(() => run(TEXT, own, FILTER, ROUND, EFFECT)).toThrow(/names its own count/u);
  });
});

describe("Round 5C count by battle round: shapes that would drop the cap are refused", () => {
  const ATTACK_TEXT = "Select a number of enemy ALPHA units equal to or less than the current battle round number. Each time a friendly unit makes an attack that targets that unit, add 1 to the Hit roll.";
  const DESIGNATION: Item[] = [
    ["Select a number of", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["enemy ALPHA units", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }],
    ["Each time a friendly unit makes an attack that targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  ];
  const withCount = (items: Item[], count: Item) => [...items.slice(0, 2), count, ...items.slice(2)];

  it("compiles the designation without a count, so the refusals below are the count's own", () => {
    expect(run(ATTACK_TEXT, ...DESIGNATION).ok).toBe(true);
  });

  const MESSAGE = "is carried only by a plain single selection";
  it.each([
    ["round", ROUND],
    ["size", ["equal to or less than the current battle round number", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }] as Item],
  ])("refuses a %s count with a designated selection", (_name, count) => {
    expect(errorsOf(ATTACK_TEXT, ...withCount(DESIGNATION, count))).toContain(MESSAGE);
  });

  const PART_TEXT = "Those units must take a Battle-shock test, and each time this unit fights, select a number of friendly ALPHA units equal to or less than the current battle round number, those units must take a Battle-shock test.";
  const PART: Item[] = [
    ["Those units must take a Battle-shock test", "test", { target: "this-unit", test: "battle-shock" }],
    ["each time this unit fights", "event", { kind: "move-ended", subject: "this-unit" }],
    ["select a number of", "select-unit", { scope: "friendly", distance: "any", visible: false }],
    FILTER,
  ];
  it.each([["round", ROUND], ["size", ["equal to or less than the current battle round number", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }] as Item]])(
    "refuses a %s count on a selection inside a compound part", (_name, count) => {
      const items: Item[] = [...PART, count, ["those units must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }]];
      expect(errorsOf(PART_TEXT, ...items)).toContain(MESSAGE);
    });

  it.each([["round", ROUND], ["size", ["equal to or less than the current battle round number", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }] as Item]])(
    "refuses a %s count beside a for-each loop", (_name, count) => {
      const text = "Each friendly unit and a number of units equal to or less than the current battle round number. Those units must take a Battle-shock test.";
      const items: Item[] = [
        ["Each friendly", "for-each-unit-select", { scope: "friendly", distance: "any" }],
        ["a number of", "select-unit", { scope: "friendly", distance: "any", visible: false }],
        ["equal to or less than the current battle round number", ...count.slice(1) as [string, Record<string, unknown>]],
        EFFECT,
      ];
      expect(errorsOf(text, ...items)).toContain(MESSAGE);
    });

  it("compiles the same part when it carries no count, so the refusal is the count's own", () => {
    const text = PART_TEXT.replace(" equal to or less than the current battle round number", "");
    const items: Item[] = [...PART, ["those units must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }]];
    expect(run(text, ...items).ok).toBe(true);
  });

  it("refuses a round count beside a bound pair", () => {
    const text = "Select one friendly ALPHA model. Select a number of enemy BRAVO units equal to or less than the current battle round number within 8 inches of that model. Those units must take a Battle-shock test.";
    const items: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "anchor" }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Select a number of enemy", "select-unit", { distance: "within", inches: 8, visible: false, within_of: "anchor" }],
      ["BRAVO units", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
      ["equal to or less than the current battle round number", "count-by-battle-round", {}],
      EFFECT,
    ];
    expect(errorsOf(text, ...items)).toContain("not bound with it yet");
  });
});
