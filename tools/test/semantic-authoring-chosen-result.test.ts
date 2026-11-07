import { describe, expect, it } from "vitest";

import { stepsBeforeLoop } from "../src/semantic-authoring/compile-band-loop.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
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

const TEXT = "When this model falls, if it has the Deadly Demise ability, do not roll for that ability; instead, pick whether that roll's result is a 1 or a 6. If it lacks the Deadly Demise ability, roll one D6 for each unit within 6\" of it: on a 4+, that unit suffers D3 mortal wounds.";

const FALLS: Item = ["When this model falls", "event", { kind: "this-model-destroyed" }];
const HAS: Item = ["if it has the Deadly Demise ability", "unit-has-ability", { subject: "this-model", ability: "deadly-demise" }];
const NO_ROLL: Item = ["do not roll for that", "roll-prohibition", { roll: "deadly-demise" }];
const INSTEAD: Item = ["instead", "instead", {}];
const PICK = (roll = "deadly-demise"): Item => ["pick whether that roll's result is a 1 or a 6", "roll-auto-result", { roll, outcome: "chosen", values: [6, 1], subject: "this-model" }];
const LACKS = (negated = true): Item => ["If it lacks the Deadly Demise ability", "unit-has-ability", { subject: "this-model", ability: "deadly-demise", negated }];
const ROLL: Item = ["roll one D6", "dice-roll", { dice: "D6" }];
const EACH: Item[] = [
  ["for each", "for-each-unit-select", {}],
  ["unit", "unit-filter", { side: "any" }],
  ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
];
const BAND: Item = ["on a 4+", "roll-result", { from: 4 }];
const WOUNDS: Item = ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }];

const ALL = (pick = PICK(), lacks = LACKS()): Item[] => [FALLS, HAS, NO_ROLL, INSTEAD, pick, lacks, ROLL, ...EACH, BAND, WOUNDS];

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, {});
}

function effectOf(items: Item[], text = TEXT): any {
  const result = compiled(items, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as any).effect;
}

const HAS_NODE = { type: "matches", parameters: { subject: "this-model", filter: { has_ability: ["deadly-demise"] } } };
const CHOICE = { type: "choice", options: [
  { type: "roll-result", target: "this-model", modifier: { roll: "deadly-demise", result: 1 } },
  { type: "roll-result", target: "this-model", modifier: { roll: "deadly-demise", result: 6 } },
] };

describe("a roll's result the player picks in place of rolling it (roll-auto-result outcome chosen)", () => {
  it("replaces the forbidden roll with a choice of each result, under the forbidding sentence's condition", () => {
    const effect = effectOf(ALL());
    expect(effect.steps[0]).toEqual({ type: "conditional", condition: HAS_NODE, effect: CHOICE });
    expect(JSON.stringify(effect)).not.toContain("roll-prohibition");
    expect(describeAbility({ id: "sample", name: "Sample", effect } as any)).toMatch(/This model's Deadly Demise rolls count as 1\.[\s\S]*Deadly Demise rolls count as 6\./u);
  });

  it("refuses a picked result of another roll than the one forbidden", () => {
    const result = compiled(ALL(PICK("hit")));
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/replaces only the roll it names \(deadly-demise\)/u);
  });

  it("takes two or more different results from 1 to 6, sorted, and only with outcome chosen", () => {
    const version = currentFamilyVersion("roll-auto-result");
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("roll-auto-result", parameters, version);
    expect(normalize({ roll: "deadly-demise", outcome: "chosen", values: [6, 1] })).toEqual({ roll: "deadly-demise", outcome: "chosen", values: [1, 6] });
    expect(normalize({ roll: "deadly-demise", outcome: "chosen", values: [1, 6], subject: "this-model" })).toEqual({ roll: "deadly-demise", outcome: "chosen", values: [1, 6], subject: "this-model" });
    expect(() => normalize({ roll: "deadly-demise", outcome: "chosen", values: [1, 6], subject: "that-model" })).toThrow();
    for (const values of [[6], [1, 1], [0, 6], [1, 7], [1.5, 6], undefined]) {
      expect(() => normalize({ roll: "deadly-demise", outcome: "chosen", values })).toThrow(/two or more different whole numbers from 1 to 6/u);
    }
    expect(() => normalize({ roll: "deadly-demise", outcome: "chosen", values: [1, 6], count: 1 })).toThrow();
    expect(() => normalize({ roll: "deadly-demise", outcome: "auto-pass", values: [1, 6] })).toThrow(/outcome chosen only/u);
  });
});

describe("an \"if\" inside the first sentence that a later sentence opens with its negation (compile-instead-scope.ts)", () => {
  it("gates its own sentence only, and the later sentence takes the negation", () => {
    const effect = effectOf(ALL());
    expect(effect.type).toBe("sequence");
    expect(effect.steps[1].type).toBe("for-each-unit");
    expect(JSON.stringify(effect.steps[1])).toContain(JSON.stringify({ operator: "not", operands: [HAS_NODE] }));
  });

  it("keeps gating the whole ability when the later condition is not its negation", () => {
    const text = TEXT.replace("If it lacks the Deadly Demise", "If it has the Deadly Demise");
    const items = ALL(PICK(), ["If it has the Deadly Demise ability", "unit-has-ability", { subject: "this-model", ability: "deadly-demise" }]);
    expect(effectOf(items, text)).toMatchObject({ type: "conditional", condition: HAS_NODE });
  });

  it("keeps gating the whole ability when the later sentence negates another condition", () => {
    const items = ALL(PICK(), ["If it lacks the Deadly Demise ability", "unit-has-ability", { subject: "this-model", ability: "explodes", negated: true }]);
    expect(effectOf(items)).toMatchObject({ type: "conditional", condition: HAS_NODE });
  });

  it("keeps gating the whole ability when the later negation does not open its sentence", () => {
    const text = TEXT.replace("If it lacks the Deadly Demise ability, roll one D6", "Then roll one D6, if it lacks the Deadly Demise ability,");
    const items: Item[] = [FALLS, HAS, NO_ROLL, INSTEAD, PICK(), ROLL, ["if it lacks the Deadly Demise ability", "unit-has-ability", { subject: "this-model", ability: "deadly-demise", negated: true }], ...EACH, BAND, WOUNDS];
    expect(effectOf(items, text)).toMatchObject({ type: "conditional", condition: HAS_NODE });
  });
});

describe("a loop in a later sentence (compile-band-loop.ts stepsBeforeLoop)", () => {
  it("repeats its own sentence's effects, and the earlier sentence's run once before it", () => {
    const effect = effectOf(ALL());
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0].effect).toEqual(CHOICE);
    expect(effect.steps[1].effect.type).toBe("dice-gated");
  });

  it("keeps a leading step that names the loop's unit, or a step out of sentence order, inside the loop", () => {
    const plain = { type: "mortal-wounds", target: "this-model" };
    const own = { type: "mortal-wounds", target: "recipient" };
    expect(stepsBeforeLoop([plain, own], [1, 2], 2)).toBe(1);
    expect(stepsBeforeLoop([plain, plain, own], [0, 1, 2], 2)).toBe(2);
    expect(stepsBeforeLoop([own, own], [1, 2], 2)).toBe(0);
    expect(stepsBeforeLoop([plain, own, plain], [1, 2, 1], 2)).toBe(0);
    expect(stepsBeforeLoop([own, plain], [2, 3], 2)).toBe(0);
    expect(stepsBeforeLoop([plain, plain, own], [1, 2], 2)).toBe(0);
  });
});
