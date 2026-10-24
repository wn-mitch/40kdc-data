import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

/**
 * A change to this ability's own roll that holds only under a condition ("adding 1 to the result if
 * X"). Wording here is fabricated. Each test pins a defect it would let through: a wrapper evaluated
 * once instead of per destroyed model, a shifted band off by one, an empty band emitted, or a
 * stacked or unconditional change folded silently.
 */

type Item = [string, string, Record<string, unknown>];

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

function effectOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, any>;
}

function errorOf(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join("; ");
}

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authoredBase(): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === "control-edict-adeptus-mechanicus");
  if (!entry) throw new Error("Missing control-edict-adeptus-mechanicus");
  return entry;
}

const INFANTRY_UNIT = ["unit-keyword", { keywords: ["INFANTRY"], subject: "this-unit", negated: false }] as const;
const VEHICLE = ["unit-keyword", { keywords: ["VEHICLE"], subject: "selected-unit", negated: false }] as const;
const SELECT: Item = ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }];
const GAIN = (amount: number): Item => ["you gain " + amount + "CP", "resource-gain", { pool: "command-point", amount }];
const ROLL: Item = ["Roll one D6", "dice-roll", { dice: "D6" }];
const ADD: Item = ["adding 1 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 1 }];
const SUBTRACT: Item = ["subtracting 1 from the result", "roll-modifier", { roll: "preceding", operation: "subtract", value: 1 }];

describe("Semantic authoring own-roll conditional change, fight-on-death", () => {
  const text = "Roll one D6, adding 1 to the result if your unit is a INFANTRY unit: on a 4+, that unit fights.";
  const items: Item[] = [ROLL, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 4+", "roll-result", { from: 4 }],
    ["that unit fights", "fight-on-death", { act: "fight", timing: "when-its-unit-fights" }]];

  it("splits into two act-on-death effects, each gated and eligible on its side, with no wrapper", () => {
    const result = compileLeaves(placed(text, ...items), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("sequence");
    expect(effect.steps).toHaveLength(2);
    // The condition is the eligibility, evaluated per destroyed model, not a wrapper around the grant.
    expect(effect.steps[0]).toMatchObject({ type: "act-on-death", modifier: { gate: { dice: "D6+1", threshold: 4, comparison: "gte", modifiers: [] }, eligibility: { type: "matches", parameters: { filter: { all_of: ["INFANTRY"] } } } } });
    expect(effect.steps[1]).toMatchObject({ type: "act-on-death", modifier: { gate: { dice: "D6", threshold: 4, comparison: "gte", modifiers: [] }, eligibility: { operator: "not", operands: [{ type: "matches", parameters: { filter: { all_of: ["INFANTRY"] } } }] } } });
    expect(JSON.stringify(effect)).not.toContain('"type":"conditional"');
    // The compiled entry validates against the ability schema and renders.
    const check = checkEntry(entryWithMechanics(authoredBase(), result.mechanics));
    expect(check.errors).toEqual([]);
  });

  it("lowers a subtraction to a threshold raised by one, the subtracted side keeping the written threshold", () => {
    const effect = effectOf("Roll one D6, subtracting 1 from the result if your unit is a INFANTRY unit: on a 4+, that unit fights.",
      ROLL, SUBTRACT, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 4+", "roll-result", { from: 4 }],
      ["that unit fights", "fight-on-death", { act: "fight", timing: "when-its-unit-fights" }]);
    expect(effect.steps[0].modifier.gate).toEqual({ dice: "D6", threshold: 5, comparison: "gte", modifiers: [] });
    expect(effect.steps[1].modifier.gate).toEqual({ dice: "D6", threshold: 4, comparison: "gte", modifiers: [] });
  });

  it("refuses a subtraction whose raised threshold is above the top face", () => {
    // A 6+ with -1 can never succeed: threshold 7 on a D6. Silently emitting it would be a dead branch.
    expect(errorOf("Roll one D6, subtracting 1 from the result if your unit is a INFANTRY unit: on a 6+, that unit fights.",
      ROLL, SUBTRACT, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 6+", "roll-result", { from: 6 }],
      ["that unit fights", "fight-on-death", { act: "fight", timing: "when-its-unit-fights" }])).toMatch(/beyond the changed D6/u);
  });

  it("refuses a conditional fight-on-death when another effect shares its part", () => {
    expect(errorOf("Roll one D6, adding 1 to the result if your unit is a INFANTRY unit: on a 4+, that unit fights and you gain 1CP.",
      ROLL, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 4+", "roll-result", { from: 4 }],
      ["that unit fights", "fight-on-death", { act: "fight", timing: "when-its-unit-fights" }], GAIN(1))).toMatch(/only effect in its part/u);
  });
});

describe("Semantic authoring own-roll conditional change, one-time roll", () => {
  it("wraps the roll in its condition, once per side, around a dice-gated with the changed dice", () => {
    const effect = effectOf("Select one enemy unit. Roll one D6, adding 1 to the result if that unit is a VEHICLE unit: on a 5+, that unit suffers 1 mortal wound.",
      SELECT, ROLL, ADD, ["if that unit is a VEHICLE unit", ...VEHICLE], ["on a 5+", "roll-result", { from: 5 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    const steps = effect.effect.steps;
    expect(steps[0]).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { subject: "selected-unit", filter: { all_of: ["VEHICLE"] } } },
      effect: { type: "dice-gated", dice: "D6+1", threshold: 5, on_success: { type: "mortal-wounds" } } });
    expect(steps[1]).toMatchObject({ type: "conditional", condition: { operator: "not" }, effect: { type: "dice-gated", dice: "D6", threshold: 5 } });
  });

  it("shifts a table's bands by the change for the yes side, and keeps the written table for the no side", () => {
    const effect = effectOf("Select one enemy unit. Roll one D6, adding 1 to the result if that unit is a VEHICLE unit: on a 2-5, that unit suffers D3 mortal wounds; on a 6, that unit suffers 3 mortal wounds.",
      SELECT, ROLL, ADD, ["if that unit is a VEHICLE unit", ...VEHICLE], ["on a 2-5", "roll-result", { from: 2, to: 5 }],
      ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }], ["on a 6", "roll-result", { from: 6 }],
      ["that unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }]);
    const [yes, no] = effect.effect.steps;
    // Yes side: a raw 1-4 is a modified 2-5; a raw 5-6 is a modified 6-7, so it reads as the 6 band.
    expect(yes.effect.dice).toBe("D6");
    expect(yes.effect.outcomes.map((row: any) => row.results)).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect(no.effect.outcomes.map((row: any) => row.results)).toEqual([[1], [2, 3, 4, 5], [6]]);
  });

  it("omits a band the change moves wholly off the die, its faces reading as no effect", () => {
    // "On a 1" with +1 is a modified 1, a raw 0: no raw face reaches it, so the yes side has no row for it.
    const effect = effectOf("Roll one D6, adding 1 to the result if your unit is a INFANTRY unit: on a 1, you gain 1CP; on a 2+, you gain 2CP.",
      ROLL, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 1", "roll-result", { from: 1, to: 1 }], GAIN(1),
      ["on a 2+", "roll-result", { from: 2 }], GAIN(2));
    const [yes, no] = effect.steps;
    expect(yes.effect).toMatchObject({ type: "dice-gated", dice: "D6", threshold: 1 });
    expect(no.effect.outcomes.map((row: any) => row.results)).toEqual([[1], [2, 3, 4, 5, 6]]);
  });

  it("keeps other effects of the part in their order around the roll", () => {
    const effect = effectOf("You gain 1CP. Roll one D6, adding 1 to the result if your unit is a INFANTRY unit: on a 4+, you gain 2CP.",
      ["You gain 1CP", "resource-gain", { pool: "command-point", amount: 1 }], ROLL, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 4+", "roll-result", { from: 4 }], GAIN(2));
    expect(effect.steps[0]).toMatchObject({ type: "cp-gain" });
    expect(effect.steps[1]).toMatchObject({ type: "conditional" });
    expect(effect.steps[2]).toMatchObject({ type: "conditional" });
  });
});

describe("Semantic authoring own-roll conditional change, refusals", () => {
  it("refuses a condition between the roll and the change, which gates the roll itself", () => {
    expect(errorOf("Roll one D6 if your unit is a INFANTRY unit, adding 1 to the result: on a 4+, you gain 1CP.",
      ROLL, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ADD, ["on a 4+", "roll-result", { from: 4 }], GAIN(1))).toMatch(/conditional change to this ability's own roll has no DSL shape yet/u);
  });

  it("refuses a condition after a comma, which would otherwise gate the whole ability", () => {
    expect(errorOf("Roll one D6, adding 1 to the result, and if your unit is a INFANTRY unit: on a 4+, you gain 1CP.",
      ROLL, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 4+", "roll-result", { from: 4 }], GAIN(1))).toMatch(/conditional change to this ability's own roll has no DSL shape yet/u);
  });

  it("names 6891 for two changes to one roll when either is conditional, and refuses the first's condition", () => {
    expect(errorOf("Roll one D6, adding 1 to the result if your unit is a INFANTRY unit; subtracting 1 from the result if your unit is a INFANTRY unit: on a 4+, you gain 1CP.",
      ROLL, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], SUBTRACT, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT],
      ["on a 4+", "roll-result", { from: 4 }], GAIN(1))).toMatch(/6891/u);
  });

  it("refuses an unconditional change together with a conditional one on the same roll", () => {
    expect(errorOf("Roll one D6, adding 1 to the result. Also, adding 1 to the result if your unit is a INFANTRY unit: on a 4+, you gain 1CP.",
      ROLL, ADD, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT], ["on a 4+", "roll-result", { from: 4 }], GAIN(1))).toMatch(/unconditional and a conditional change/u);
  });

  it("refuses a conditional change to a per-model roll of several dice", () => {
    expect(errorOf("Roll six D6, adding 1 to the result if your unit is a INFANTRY unit: for each 5+, you gain 1CP.",
      ["Roll six D6", "dice-roll", { dice: "D6", per_model: "this-unit" }], ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT],
      ["for each 5+", "roll-result", { from: 5 }], GAIN(1))).toMatch(/roll of several dice/u);
  });

  it("refuses a conditional change to a counted roll whose success does not score mortal wounds", () => {
    expect(errorOf("Roll six D6, adding 1 to the result if your unit is a INFANTRY unit: for each 5+, you gain 1CP.",
      ["Roll six D6", "dice-roll", { dice: "D6", count: 6 }], ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT],
      ["for each 5+", "roll-result", { from: 5 }], GAIN(1))).toMatch(/folds only into mortal wounds/u);
  });

  it("keeps refusing an unconditional subtraction", () => {
    expect(errorOf("Roll one D6, subtracting 1 from the result: on a 4+, you gain 1CP.", ROLL, SUBTRACT,
      ["on a 4+", "roll-result", { from: 4 }], GAIN(1))).toMatch(/Only adding a number/u);
  });

  it("refuses a condition of two leaves attached to a change, since one leaf is all it binds", () => {
    expect(errorOf("Roll one D6, adding 1 to the result if your unit is a INFANTRY unit and is within 6\" of this unit: on a 4+, you gain 1CP.",
      ROLL, ADD, ["if your unit is a INFANTRY unit", ...INFANTRY_UNIT],
      ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
      ["on a 4+", "roll-result", { from: 4 }], GAIN(1))).toMatch(/conditional change to this ability's own roll has no DSL shape yet/u);
  });
});

describe("Semantic authoring own-roll conditional change, negative one-time roll", () => {
  const SUBTRACT_TEXT = "Select one enemy unit. Roll one D6, subtracting 1 from the result if that unit is a VEHICLE unit";

  it("raises a single band's threshold by one on the yes side, the no side keeping the written threshold", () => {
    const effect = effectOf(`${SUBTRACT_TEXT}: on a 4+, that unit suffers 1 mortal wound.`,
      SELECT, ROLL, SUBTRACT, ["if that unit is a VEHICLE unit", ...VEHICLE], ["on a 4+", "roll-result", { from: 4 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    const [yes, no] = effect.effect.steps;
    // A modified 4 is a raw 5, so the yes side rolls a plain D6 at 5+; the no side reads the raw 4+.
    expect(yes).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { subject: "selected-unit", filter: { all_of: ["VEHICLE"] } } }, effect: { type: "dice-gated", dice: "D6", threshold: 5 } });
    expect(no).toMatchObject({ type: "conditional", condition: { operator: "not", operands: [{ type: "matches", parameters: { subject: "selected-unit", filter: { all_of: ["VEHICLE"] } } }] }, effect: { type: "dice-gated", dice: "D6", threshold: 4 } });
  });

  it("refuses a single band whose raised threshold passes the top face, since no raw face can reach it", () => {
    expect(errorOf(`${SUBTRACT_TEXT}: on a 6+, that unit suffers 1 mortal wound.`,
      SELECT, ROLL, SUBTRACT, ["if that unit is a VEHICLE unit", ...VEHICLE], ["on a 6+", "roll-result", { from: 6 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }])).toMatch(/beyond the changed D6/u);
  });

  it("shifts each band of a table up by one on the yes side and keeps the written table on the no side", () => {
    const effect = effectOf(`${SUBTRACT_TEXT}: on a 2-3, that unit suffers D3 mortal wounds; on a 4-5, that unit suffers 3 mortal wounds.`,
      SELECT, ROLL, SUBTRACT, ["if that unit is a VEHICLE unit", ...VEHICLE], ["on a 2-3", "roll-result", { from: 2, to: 3 }],
      ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }], ["on a 4-5", "roll-result", { from: 4, to: 5 }],
      ["that unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }]);
    const [yes, no] = effect.effect.steps;
    // A modified 2-3 is a raw 3-4 and a modified 4-5 is a raw 5-6; raw 1-2 matches no band.
    expect(yes.effect.dice).toBe("D6");
    expect(yes.effect.outcomes.map((row: any) => row.results)).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(no.effect.outcomes.map((row: any) => row.results)).toEqual([[1], [2, 3], [4, 5], [6]]);
  });

  it("refuses a table band whose shifted range passes the top face", () => {
    expect(errorOf(`${SUBTRACT_TEXT}: on a 2-3, that unit suffers D3 mortal wounds; on a 6, that unit suffers 3 mortal wounds.`,
      SELECT, ROLL, SUBTRACT, ["if that unit is a VEHICLE unit", ...VEHICLE], ["on a 2-3", "roll-result", { from: 2, to: 3 }],
      ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }], ["on a 6", "roll-result", { from: 6 }],
      ["that unit suffers 3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "3" }])).toMatch(/beyond the changed D6/u);
  });
});

describe("Semantic authoring own-roll conditional change, subject of the condition", () => {
  it("binds a bearer condition to the bearer's model, as the change's condition", () => {
    // Fabricated: "the bearer" is authored as this-model, as the bearer-subject records are.
    const effect = effectOf("Roll one D6, adding 1 to the result if the bearer is within range of an objective marker you control: on a 4+, you gain 1CP.",
      ROLL, ADD, ["if the bearer is within range of an objective marker you control", "unit-position", { kind: "objective-range", controlled_by: "you", subject: "this-model", negated: false }],
      ["on a 4+", "roll-result", { from: 4 }], GAIN(1));
    const [yes, no] = effect.steps;
    expect(yes).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { subject: "this-model", filter: { within: { of: { objective: { controlled_by: "friendly" } }, range: "objective-control" } } } }, effect: { type: "dice-gated", dice: "D6+1", threshold: 4 } });
    expect(no).toMatchObject({ type: "conditional", condition: { operator: "not", operands: [{ type: "matches", parameters: { subject: "this-model", filter: { within: { of: { objective: { controlled_by: "friendly" } }, range: "objective-control" } } } }] }, effect: { type: "dice-gated", dice: "D6", threshold: 4 } });
  });

  it("binds an 'it' condition to the selected unit it refers back to", () => {
    const effect = effectOf("Select one enemy unit. Roll one D6, adding 1 to the result if it is a VEHICLE unit: on a 5+, that unit suffers 1 mortal wound.",
      SELECT, ROLL, ADD, ["if it is a VEHICLE unit", "unit-keyword", { keywords: ["VEHICLE"], subject: "antecedent", negated: false }], ["on a 5+", "roll-result", { from: 5 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    const [yes] = effect.effect.steps;
    expect(yes.condition).toMatchObject({ type: "matches", parameters: { subject: "selected-unit", filter: { all_of: ["VEHICLE"] } } });
  });

  it("compiles an 'it' within-range condition with no subject, which is the ability's own unit (this-unit)", () => {
    // Fabricated. "it" is authored as this-unit, which the schema defaults to, so the emitted subject is
    // absent. An absent subject on an ability's own unit is the bearer's unit, the record's "it".
    const effect = effectOf("Roll one D6, adding 1 if it is within range of one or more objectives: on a 4+, you gain 1CP.",
      ROLL, ["adding 1", "roll-modifier", { roll: "preceding", operation: "add", value: 1 }], ["if it is within range of one or more objectives", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false }],
      ["on a 4+", "roll-result", { from: 4 }], GAIN(1));
    const [yes, no] = effect.steps;
    const within = yes.condition;
    expect(within.type).toBe("matches");
    expect(within.parameters.subject ?? "this-unit").toBe("this-unit");
    expect(within.parameters.filter.within).toEqual({ of: { objective: {} }, range: "objective-control" });
    expect(no.condition.operands[0]).toEqual(within);
  });
});
