import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const run = (text: string, items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-own-models", name: "Ember Burst" });

function mechanicsOf(text: string, items: Item[]): Record<string, any> {
  const result = run(text, items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, items: Item[]): string {
  const result = run(text, items);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
}

const TEXT = "Each time this unit is selected to fight, you can select one enemy unit within Engagement Range of it, then select one or more **EMBER SPRITE** models in this unit. For each **EMBER SPRITE** model you select, roll one D6: on a 4+, that model is destroyed and that enemy unit suffers 1 mortal wound.";
const OUTER: Item = ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false, bind_as: "foe" }];
const INNER: Item = ["select one or more", "select-unit", { scope: "friendly", distance: "any", visible: false, bind_as: "sprites", at_least: true }];
const ROLL: Item = ["For each **EMBER SPRITE** model you select, roll one D6", "dice-roll", { dice: "D6", per_model: "selected" }];
const WOUNDS: Item = ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }];

function items(swap: Partial<Record<"outer" | "inner" | "roll" | "wounds", Item>> = {}): Item[] {
  return [
    ["Each time this unit is selected to fight", "event", { kind: "selected", to: "fight" }],
    ["you can", "optional-use", { who: "you" }],
    swap.outer ?? OUTER,
    ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-unit" }],
    swap.inner ?? INNER,
    ["**EMBER SPRITE** models in this unit", "unit-filter", { side: "friendly", keywords: ["EMBER SPRITE"], level: "model", member_of: "this-unit" }],
    swap.roll ?? ROLL,
    ["on a 4+", "roll-result", { from: 4 }],
    ["that model is destroyed", "destroy-models", { recipient: "selected-unit", count: "1" }],
    swap.wounds ?? WOUNDS,
  ];
}

describe("a selection of this unit's own models after a unit selection", () => {
  it("nests the model selection in the unit selection and rolls for each model it selects", () => {
    const mechanics = mechanicsOf(TEXT, items());
    const outer = mechanics.effect;
    expect(outer).toMatchObject({ type: "select-units", selector: { filter: { owner: "enemy" }, bind_as: "foe" } });
    const inner = outer.effect;
    expect(inner).toMatchObject({ type: "select-units", selector: { filter: { owner: "friendly", level: "model", member_of: "this-unit" }, bind_as: "sprites" } });
    // "one or more": a lower bound and no upper one.
    expect(inner.selector.count).toEqual({ min: 1 });
    expect(inner.effect).toMatchObject({ type: "dice-gated", dice: "D6", threshold: 4 });
    expect(JSON.stringify(inner.effect)).not.toContain("per_model");
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(outer), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("gives that model the destruction and the bound enemy unit the mortal wounds", () => {
    const steps = mechanicsOf(TEXT, items()).effect.effect.effect.on_success.steps;
    expect(steps[0]).toMatchObject({ type: "destroy-models", target: "selected-unit" });
    expect(steps[1]).toMatchObject({ type: "mortal-wounds", target: { selection_var: "foe" } });
  });

  it("needs the unit selection bound by a name", () => {
    expect(errorsOf(TEXT, items({ outer: ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }] })))
      .toContain("needs the unit selection bound by a name");
  });

  it("refuses mortal wounds on \"that unit\" worded for the other side", () => {
    const text = TEXT.replace("that enemy unit suffers", "that friendly unit suffers");
    expect(errorsOf(text, items({ wounds: ["that friendly unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }] })))
      .toContain("only mortal wounds worded");
  });

  it("refuses a roll for each selected model with no model selection before it", () => {
    const text = "Each time this unit is selected to fight, you can select one enemy unit within Engagement Range of it. For each **EMBER SPRITE** model you select, roll one D6: on a 4+, that enemy unit suffers 1 mortal wound.";
    const result = run(text, [
      ["Each time this unit is selected to fight", "event", { kind: "selected", to: "fight" }],
      ["you can", "optional-use", { who: "you" }],
      OUTER,
      ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-unit" }],
      ROLL,
      ["on a 4+", "roll-result", { from: 4 }],
      WOUNDS,
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("needs a selection of models before it");
  });
});

describe("select-unit at_least", () => {
  it("writes \"one or more\" as count {min: 1} and refuses it beside up_to", () => {
    expect(normalizeFingerprintParameters("select-unit", { distance: "any", visible: false, count: 1, at_least: true }, currentFamilyVersion("select-unit")))
      .toEqual({ distance: "any", visible: false, at_least: true });
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", visible: false, count: 2, up_to: true, at_least: true }, currentFamilyVersion("select-unit")))
      .toThrow(/cannot be combined/u);
  });
});
