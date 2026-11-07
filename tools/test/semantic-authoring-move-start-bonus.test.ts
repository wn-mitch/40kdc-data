import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. */
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

const BONUS_CLAUSE = ", adding 2 to the result if this unit began that move within 6\" of one or more friendly **SAMPLE** units";
const textWith = (clause: string, trigger = "Each time this unit ends a Charge move") =>
  `${trigger}, select one enemy unit within Engagement Range of it and roll one D6 for each model in this unit that is within Engagement Range of that enemy unit${clause}. For each 4+, that enemy unit suffers 1 mortal wound.`;

const opening = (trigger: Item = ["Each time this unit ends a Charge move", "event", { kind: "move-ended", move_types: ["charge"] }]): Item[] => [
  trigger,
  ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
  ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-unit" }],
  ["roll one D6", "dice-roll", { dice: "D6" }],
  ["for each", "for-each-unit-select", {}],
  ["model", "unit-filter", { side: "any", level: "model" }],
  ["in this unit", "membership", { relation: "in", of: "this-unit" }],
  ["that is within Engagement Range of that enemy unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "antecedent" }],
];
const bonus: Item[] = [
  ["adding 2 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 2 }],
  ["this unit began that move within 6\" of one or more", "unit-position", { kind: "within", inches: 6, of: "following-filter", subject: "this-unit", negated: false, at: "move-start" }],
  ["friendly **SAMPLE** units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }],
];
const closing: Item[] = [
  ["For each 4+", "roll-result", { from: 4 }],
  ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
];

function compiled(text: string, items: Item[]) {
  return compileLeaves(placed(text, ...items), text, {});
}

describe("a conditional bonus on one die for each model, read at the start of the triggering move", () => {
  it("makes the roll in two forms, the bonus side needing 2 less on each die", () => {
    const result = compiled(textWith(BONUS_CLAUSE), [...opening(), ...bonus, ...closing]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const steps = (result.mechanics as any).effect.effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    const within = { type: "within", parameters: { of: { owner: "friendly", all_of: ["SAMPLE"] }, range: { inches: 6 }, at: "move-start" } };
    expect(steps[0]!.condition).toEqual(within);
    expect(steps[1]!.condition).toEqual({ operator: "not", operands: [within] });
    // Each form keeps one die for each model engaged with the selected unit.
    for (const [step, threshold] of [[steps[0]!, 2], [steps[1]!, 4]] as const) {
      expect(step.effect.modifier.roll).toMatchObject({ dice: 1, threshold, for_each: { filter: { level: "model", member_of: "this-unit" } } });
    }
    expect(describeAbility({ id: "sample", name: "Sample", ...(result.mechanics as object) } as any)).toContain("was within 6\" of a friendly SAMPLE unit at the start of that move");
  });

  it("refuses a start-of-move position in a record no move triggers", () => {
    const trigger = "At the start of your Fight phase";
    const result = compiled(textWith(BONUS_CLAUSE, trigger), [...opening([trigger, "event", { kind: "phase-start", phase: "fight", turn: "your" }]), ...bonus, ...closing]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/start of a move needs the record to be triggered by that move ending/u);
  });

  it("refuses the bonus when its condition names a unit that is not fixed for the whole roll", () => {
    // The moment's own unit, read as the event's subject, is not one of the units every die shares.
    const clause = ", adding 2 to the result if the moving unit has the **SAMPLE** keyword";
    const result = compiled(textWith(clause), [...opening(),
      ["adding 2 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 2 }],
      ["the moving unit has the **SAMPLE** keyword", "unit-keyword", { keywords: ["SAMPLE"], subject: "event-subject", negated: false }],
      ...closing]);
    expect(result.ok ? JSON.stringify((result.mechanics as any).effect) : result.errors).toEqual(["A conditional change to a roll of several dice has no DSL shape."]);
  });

  it("refuses a distance and its filter followed by a third condition, which no bonus binds", () => {
    const clause = `${BONUS_CLAUSE} that are not Battle-shocked`;
    const result = compiled(textWith(clause), [...opening(), ...bonus,
      ["that are not Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "antecedent", negated: true }],
      ...closing]);
    expect(result.ok).toBe(false);
  });
});

describe("unit-position at move-start", () => {
  it("reads only a within or beyond distance", () => {
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false, at: "move-start" }, currentFamilyVersion("unit-position"))).not.toThrow();
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false, at: "phase-start" }, currentFamilyVersion("unit-position"))).toThrow();
  });
});
