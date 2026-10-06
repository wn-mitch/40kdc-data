import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((item) => item.ability_id === "control-edict-adeptus-mechanicus")!;

/** The compiled entry validates against the ability schema and renders; returns the render. */
function rendered(list: CompileLeaf[], text: string): string {
  const check = checkEntry(entryWithMechanics(base, compileLeaves(list, text).ok ? mechanicsOf(list, text) as never : (() => { throw new Error(errorsOf(list, text)); })()));
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

const FIGHT = ["When this unit is selected to fight", "event", { kind: "selected", to: "fight" }] as [string, string, Record<string, unknown>];

describe("Round 5C count-scale: an amount per counted unit or model", () => {
  it("scales a stat bonus by enemy units within range of the bearer, capped", () => {
    const text = "When this unit is selected to fight, this model's melee attacks have +1 A for each enemy unit within 6\" of this model (to a maximum of +3 A).";
    const list = placed(text, FIGHT,
      ["this model's melee attacks have", "weapon-property-scope", { subject: "this-model", weapon_type: "melee" }],
      ["+1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
      ["for each", "count-scale", { per: 1 }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["to a maximum of +3 A", "scale-cap", { max: 3 }]);
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("stat-modifier");
    expect(effect.scaling).toEqual({ per: 1, of: "enemy-units-in-range", within_inches: 6, max_value: 3 });
    expect(rendered(list, text)).toMatch(/enemy units within 6" \(to a maximum of 3\)/u);
  });

  it("scales by every N enemy models in range, and by models with one keyword in this unit", () => {
    const text = "Add 2 to the Attacks characteristic of this model's melee weapons for every 5 enemy models within 6\" of this model.";
    const effect = mechanicsOf(placed(text,
      ["Add 2 to the Attacks characteristic of this model's melee weapons", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 2, weapon_type: "melee" }],
      ["for every 5", "count-scale", { per: 5 }],
      ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]), text).effect;
    expect(effect.scaling).toEqual({ per: 5, of: "enemy-models-in-range", within_inches: 6 });

    const own = "Add 1 to the Objective Control characteristic of this model for every 3 ALPHA models in this unit.";
    expect(mechanicsOf(placed(own,
      ["Add 1 to the Objective Control characteristic of this model", "characteristic-modifier", { subject: "this-model", characteristics: ["OC"], operation: "add", value: 1, weapon_type: "all" }],
      ["for every 3", "count-scale", { per: 3 }],
      ["ALPHA models", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }]), own).effect.scaling)
      .toEqual({ per: 3, of: "models-in-bearer-unit", keyword: "ALPHA" });
  });

  it("counts models embarked within the bearer", () => {
    const text = "Add 1 to this model's Objective Control characteristic for each model embarked within this model.";
    const list = placed(text,
      ["Add 1 to this model's Objective Control characteristic", "characteristic-modifier", { subject: "this-model", characteristics: ["OC"], operation: "add", value: 1, weapon_type: "all" }],
      ["for each", "count-scale", { per: 1 }],
      ["model", "unit-filter", { side: "any", level: "model" }],
      ["embarked within this model", "membership", { relation: "embarked-in", of: "this-model" }]);
    expect(mechanicsOf(list, text).effect.scaling).toEqual({ per: 1, of: "models-embarked-in-bearer" });
    expect(rendered(list, text)).toMatch(/models embarked within this model/u);
  });

  it("writes \"1 for each\" into a field that holds a count", () => {
    const text = "You can re-roll one Hit roll for each ALPHA model in this unit.";
    const effect = mechanicsOf(placed(text,
      ["re-roll one Hit roll", "reroll", { roll: "hit", subset: "all", count: 1, weapon_type: "all" }],
      ["for each", "count-scale", { per: 1 }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }]), text).effect;
    expect(effect.modifier.count).toEqual({ count_of: "models-in-bearer-unit", keyword: "ALPHA" });
    expect(effect.scaling).toBeUndefined();
  });

  it("scales each step of a list effect", () => {
    const text = "This model has +1 S and +1 AP for each enemy unit within 6\" of this model.";
    const effect = mechanicsOf(placed(text,
      ["This model has +1 S and +1 AP", "characteristic-modifier", { subject: "this-model", characteristics: ["S", "AP"], operation: "improve", value: 1, weapon_type: "all" }],
      ["for each", "count-scale", { per: 1 }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]), text).effect;
    expect(effect.type).toBe("sequence");
    for (const step of effect.steps) expect(step.scaling).toEqual({ per: 1, of: "enemy-units-in-range", within_inches: 6 });
  });

  describe("refuses what it cannot count faithfully", () => {
    const stat = ["Add 1 to this model's Attacks characteristic", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon_type: "melee" }] as [string, string, Record<string, unknown>];
    const text = "Add 1 to this model's Attacks characteristic for each Battle-shocked other enemy unit that made a Charge move within 6\" of this model (to a maximum of 3).";

    it("a count with no unit-filter after it", () => {
      expect(errorsOf(placed(text, stat, ["for each", "count-scale", { per: 1 }]), text)).toMatch(/needs the unit-filter it counts/u);
    });

    it("a counted set narrowed by a state, other, or a condition on each counted unit (pending the matching selector)", () => {
      expect(errorsOf(placed(text, stat, ["for each", "count-scale", { per: 1 }],
        ["Battle-shocked other enemy unit", "unit-filter", { side: "enemy", states: ["battle-shocked"], other: true }],
        ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]), text)).toMatch(/narrowed by states, other/u);
      expect(errorsOf(placed(text, stat, ["for each", "count-scale", { per: 1 }],
        ["enemy unit", "unit-filter", { side: "enemy" }],
        ["that made a Charge move", "unit-activity", { activities: ["charged-this-phase"], subject: "antecedent", negated: false }],
        ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]), text)).toMatch(/narrowed by unit-activity/u);
    });

    it("friendly units in range, which no source counts", () => {
      expect(errorsOf(placed(text, stat, ["for each", "count-scale", { per: 1 }],
        ["enemy unit", "unit-filter", { side: "friendly" }],
        ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]), text)).toMatch(/friendly units within range/u);
    });

    it("a cap with no count, and an effect with no amount", () => {
      expect(errorsOf(placed(text, stat, ["to a maximum of 3", "scale-cap", { max: 3 }]), text)).toMatch(/scale-cap .* no count-scale/u);
      const grant = "This model has the Stealth ability for each enemy unit within 6\" of this model.";
      expect(errorsOf(placed(grant,
        ["This model has the Stealth ability", "core-ability-grant", { subject: "this-model", ability: "stealth" }],
        ["for each", "count-scale", { per: 1 }],
        ["enemy unit", "unit-filter", { side: "enemy" }],
        ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]), grant)).toMatch(/ability-grant has none/u);
    });

    it("two counts on one effect, and a membership nothing counts", () => {
      const two = "Add 1 to this model's Attacks characteristic for each enemy unit within 6\" of this model and for each model in this unit.";
      expect(errorsOf(placed(two, stat, ["for each", "count-scale", { per: 1 }],
        ["enemy unit", "unit-filter", { side: "enemy" }],
        ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
        ["for each", "count-scale", { per: 1 }],
        ["model", "unit-filter", { side: "any", level: "model" }],
        ["in this unit", "membership", { relation: "in", of: "this-unit" }]), two)).toMatch(/scaled by two counts/u);
      const stray = "Add 1 to this model's Attacks characteristic while a model is in this unit.";
      expect(errorsOf(placed(stray, stat, ["in this unit", "membership", { relation: "in", of: "this-unit" }]), stray)).toMatch(/no count or per-model roll takes it/u);
    });
  });
});

describe("Round 5C count-scale: one effect per listed item that holds", () => {
  const text = "At the end of your Command phase, you gain 1YP for each of the following conditions you satisfy:\n■ You control one or more objective markers outside your deployment zone.\n■ You control more objective markers than your opponent.\nYP cannot exceed 10.";
  const moment = ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }] as [string, string, Record<string, unknown>];
  const gain = ["you gain 1YP", "resource-gain", { pool: "yp-pool", amount: 1 }] as [string, string, Record<string, unknown>];

  it("gates one copy of the effect on each bullet's conditions", () => {
    const effect = mechanicsOf(placed(text, moment, gain,
      ["for each of the following conditions you satisfy", "count-scale", { per: 1, counts: "following-items" }],
      ["You control one or more objective markers outside your deployment zone", "controls-objective", { mode: "count", objective_role: "non-home", count_min: 1 }],
      ["You control more objective markers than your opponent", "controls-objective", { mode: "more-than-opponent" }]), text).effect;
    expect(effect.type).toBe("sequence");
    expect(effect.steps).toHaveLength(2);
    for (const step of effect.steps) {
      expect(step.type).toBe("conditional");
      expect(step.effect).toEqual({ type: "resource-gain", target: "this-model", modifier: { pool: "yp-pool", amount: 1 } });
    }
    expect(effect.steps[0].condition).not.toEqual(effect.steps[1].condition);
  });

  it("refuses a bullet with no condition, and an amount other than 1 per item", () => {
    expect(errorsOf(placed(text, moment, gain,
      ["for each of the following conditions you satisfy", "count-scale", { per: 1, counts: "following-items" }],
      ["You control more objective markers than your opponent", "controls-objective", { mode: "more-than-opponent" }]), text)).toMatch(/no condition leaf/u);
    expect(errorsOf(placed(text, moment, ["you gain 1YP", "resource-gain", { pool: "yp-pool", amount: 2 }],
      ["for each of the following conditions you satisfy", "count-scale", { per: 1, counts: "following-items" }]), text)).toMatch(/adds 1 per item/u);
    expect(() => normalizeFingerprintParameters("count-scale", { per: 2, counts: "following-items" }, 1)).toThrow(/per must be 1/u);
  });
});

describe("Round 5C unit-size: an added unit's size", () => {
  const text = "You can add one new ALPHA unit to your army and set it up anywhere on the battlefield. That unit contains 1 model for each model in this unit.";
  const add = ["add one new ALPHA unit to your army", "add-unit", { source: "datasheet", count: "1", datasheet: "alpha-unit" }] as [string, string, Record<string, unknown>];
  const setUp = ["set it up anywhere on the battlefield", "set-up", { subject: "antecedent", to: "battlefield" }] as [string, string, Record<string, unknown>];

  it("is the count of models in this unit, past the added unit's own set-up", () => {
    const list = placed(text, ["You can", "optional-use", { who: "you" }], add, setUp,
      ["contains 1 model", "unit-size", { models: 1 }],
      ["for each", "count-scale", { per: 1 }],
      ["model", "unit-filter", { side: "any", level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }]);
    const effect = mechanicsOf(list, text).effect;
    // The set-up folds into the add-unit (compile-set-up-placement.ts), so the effect is the add-unit itself.
    expect(effect.type).toBe("add-unit");
    const added = effect;
    expect(added.modifier).toMatchObject({ datasheet: "alpha-unit", count: 1, model_count: { count_of: "models-in-bearer-unit" } });
  });

  it("is a fixed number without a count, and refuses a size on a copy", () => {
    const fixed = "You can add one new ALPHA unit to your army. That unit contains 3 models.";
    const effect = mechanicsOf(placed(fixed, ["You can", "optional-use", { who: "you" }], add, ["contains 3 models", "unit-size", { models: 3 }]), fixed).effect;
    expect(effect.modifier.model_count).toBe(3);
    const copy = "Add a new unit identical to the destroyed unit. That unit contains 3 models.";
    expect(errorsOf(placed(copy, ["Add a new unit identical to the destroyed unit", "add-unit", { source: "copy-of-destroyed", count: "1" }],
      ["contains 3 models", "unit-size", { models: 3 }]), copy)).toMatch(/Only a new unit of a named datasheet takes a size/u);
  });
});

describe("Round 5C per-unit dice (authoring only)", () => {
  it("rolls one die for each enemy unit within range as an iteration", () => {
    const text = "At the end of your Fight phase, roll one D6 for each enemy unit within 6\" of this unit: on a 4+, that unit suffers D3 mortal wounds.";
    const effect = mechanicsOf(placed(text,
      ["At the end of your Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "your" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
      ["on a 4+", "roll-result", { from: 4 }],
      ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }]), text).effect;
    expect(effect.type).toBe("for-each-unit");
    expect(effect.selector).toEqual({ owner: "enemy", within_inches: 6 });
    expect(effect.effect).toMatchObject({ type: "dice-gated", dice: "D6", threshold: 4, on_success: { type: "mortal-wounds", target: "recipient" } });
  });
});

describe("Round 5C per-model dice: one die for each counted model", () => {
  const select = ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }] as [string, string, Record<string, unknown>];

  it("rolls one D6 for each model with a keyword in your unit, mortal wounds per success with their cap", () => {
    const text = "Select one enemy unit. Roll one D6 for each ALPHA model in your unit: for each 3+, that enemy unit suffers 1 mortal wound (to a maximum of 6 mortal wounds).";
    const list = placed(text, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      ["for each 3+", "roll-result", { from: 3 }],
      ["that enemy unit suffers 1 mortal wound (to a maximum of 6 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "1", max: 6 }]);
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("select-units");
    expect(effect.effect).toEqual({ type: "mortal-wounds", target: "selected-unit", modifier: {
      count: 1, max: 6, per: "success",
      roll: { dice: 1, threshold: 3, for_each: { owner: "friendly", target_kind: "model", member_of: "bearer-unit", keywords: ["ALPHA"] } },
    } });
    expect(rendered(list, text)).toMatch(/roll one D6 for each friendly ALPHA model in this model's unit: for each 3\+/u);
  });

  it("counts only the models engaged with the selected unit, the quantifier before the roll", () => {
    const text = "When this unit ends a Charge move, select one enemy unit engaged with this unit. For each model in this unit engaged with that enemy unit, roll one D6. On a 4+, that enemy unit suffers 1 mortal wound.";
    const list = placed(text, ["When this unit ends a Charge move", "event", { kind: "move-ended", move_types: ["charge"] }], select,
      ["engaged with this unit", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-unit" }],
      ["For each", "for-each-unit-select", {}],
      ["model", "unit-filter", { side: "any", level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }],
      ["engaged with that enemy unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "antecedent" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 4+", "roll-result", { from: 4 }],
      ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("select-units");
    expect(effect.effect.modifier.roll).toEqual({ dice: 1, threshold: 4, for_each: {
      owner: "friendly", target_kind: "model", member_of: "bearer-unit",
      eligibility: { type: "unit-state", parameters: { state: "engaged", with: "selected-unit" } },
    } });
    expect(rendered(list, text)).toMatch(/for each friendly model in this model's unit that is engaged with the selected unit: for each 4\+/u);
  });

  it("counts models embarked within this model", () => {
    const text = "Select one enemy unit. Roll one D6 for each model embarked within this model: for each 5+, that enemy unit suffers 1 mortal wound.";
    const effect = mechanicsOf(placed(text, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["model", "unit-filter", { side: "any", level: "model" }],
      ["embarked within this model", "membership", { relation: "embarked-in", of: "this-model" }],
      ["for each 5+", "roll-result", { from: 5 }],
      ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]), text).effect;
    expect(effect.effect.modifier.roll.for_each).toEqual({ owner: "friendly", target_kind: "model", member_of: "embarked-in-bearer" });
  });

  it("refuses a per-model roll whose success does anything but mortal wounds", () => {
    const text = "Roll one D6 for each ALPHA model in your unit: for each 3+, this unit regains 1 lost wound.";
    expect(errorsOf(placed(text, ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      ["for each 3+", "roll-result", { from: 3 }],
      ["this unit regains 1 lost wound", "regain-wounds", { subject: "this-unit", amount: "1" }]), text)).toMatch(/no count or per-model roll takes it/u);
  });

  it("refuses a bonus on a per-model roll, and a condition on counted models nothing counts", () => {
    const text = "Select one enemy unit. Roll one D6 for each ALPHA model in your unit, adding 1 to the result: for each 5+, that enemy unit suffers 1 mortal wound.";
    expect(errorsOf(placed(text, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      ["adding 1 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 1 }],
      ["for each 5+", "roll-result", { from: 5 }],
      ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]), text)).toMatch(/bonus added to the result has no per-die DSL shape|conditional change to this ability's own roll has no DSL shape/u);
    const loose = "Select one enemy unit. For each model engaged with that enemy unit, that enemy unit suffers 1 mortal wound.";
    expect(errorsOf(placed(loose, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["For each", "for-each-unit-select", {}],
      ["model", "unit-filter", { side: "any", level: "model" }],
      ["engaged with that enemy unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "antecedent" }],
      ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]), loose)).not.toMatch(/counted/u);
  });

  it("succeeds on each 1 below the top face, and refuses a middle band", () => {
    const text = "Select one enemy unit. Roll one D6 for each model in that unit: for each 1, that unit suffers 1 mortal wound.";
    const leaves = (band: Record<string, unknown>) => placed(text, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["Roll one D6 for each model in that unit", "dice-roll", { dice: "D6", per_model: "target" }],
      ["for each 1", "roll-result", band],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    expect(mechanicsOf(leaves({ from: 1, to: 1 }), text).effect.effect.modifier.roll).toEqual({ dice: 1, threshold: 1, comparison: "lte", per_model: "target" });
    expect(rendered(leaves({ from: 1, to: 1 }), text)).toMatch(/roll one D6 for each model in the target unit: for each 1, /u);
    expect(errorsOf(leaves({ from: 2, to: 4 }), text)).toMatch(/must reach 6 .* or start at 1/u);
  });
});

describe("Round 5C per-unit dice around a reference unit", () => {
  const moment = ["Each time this model selects its targets", "event", { kind: "targets-selected", action_kind: "shoot" }] as [string, string, Record<string, unknown>];
  const text = "Each time this model selects its targets, roll one D6 for the target unit and one D6 for each other enemy unit within 6\" of it: on a 4+, that unit suffers 1 mortal wound.";
  const leaves = (filter: Record<string, unknown>) => placed(text, moment,
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["for the target unit and one D6 for each", "for-each-unit-select", { including: "target" }],
    ["other enemy unit", "unit-filter", filter],
    ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "target", subject: "antecedent", negated: false }],
    ["on a 4+", "roll-result", { from: 4 }],
    ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);

  it("takes the target and every other unit within range of it, one pass each", () => {
    const list = leaves({ side: "enemy", other: true });
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("for-each-unit");
    expect(effect.selector).toEqual({ owner: "enemy", eligibility: { operator: "or", operands: [
      { type: "same-unit", parameters: { as: "defender" } },
      { type: "within", parameters: { of: "defender", range: { inches: 6 } } },
    ] } });
    expect(effect.effect).toMatchObject({ type: "dice-gated", threshold: 4, on_success: { type: "mortal-wounds", target: "recipient" } });
    expect(rendered(list, text)).toMatch(/For each enemy unit that is the same unit as the target unit or that is within 6" of the target unit/u);
  });

  it("marks each unit a pass's roll strikes, then harms each marked unit after the attacks", () => {
    const struck = "Each time this model selects its targets, roll one D6 for the target unit and one D6 for each other enemy unit within 6\" of it: on a 4+, the unit being rolled for is struck by debris; after resolving all of this model's attacks, each unit struck by debris suffers D3 mortal wounds.";
    const list = placed(struck, moment,
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["for the target unit and one D6 for each", "for-each-unit-select", { including: "target" }],
      ["other enemy unit", "unit-filter", { side: "enemy", other: true }],
      ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "target", subject: "antecedent", negated: false }],
      ["on a 4+", "roll-result", { from: 4 }],
      ["the unit being rolled for is struck by debris", "apply-mark", { subject: "antecedent", tag: "struck-by-explosive-debris" }],
      ["after resolving all of this model's attacks", "event", { kind: "attacks-resolved" }],
      ["each", "for-each-unit-select", {}],
      ["unit", "unit-filter", { side: "any" }],
      ["struck by debris", "designated-filter", { tag: "struck-by-explosive-debris", subject: "recipient" }],
      ["suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }]);
    const effect = mechanicsOf(list, struck).effect;
    expect(effect.type).toBe("sequence");
    const [first, second] = effect.steps;
    expect(first.effect).toMatchObject({ type: "for-each-unit", effect: { type: "dice-gated", on_success: { type: "designate", target: "recipient", modifier: { tag: "struck-by-explosive-debris" } } } });
    expect(second.trigger).toMatchObject({ event: "attacks-resolved" });
    expect(second.effect).toMatchObject({ type: "for-each-unit", selector: { owner: "any" }, effect: { type: "conditional", effect: { type: "mortal-wounds", target: "recipient", modifier: { count: "D3" } } } });
    expect(rendered(list, struck)).toMatch(/struck by explosive debris/u);
  });

  it("takes units of either side for \"each unit\"", () => {
    expect(mechanicsOf(leaves({ side: "any", other: true }), text).effect.selector.owner).toBe("any");
  });

  it("refuses keywords that would narrow the target too", () => {
    expect(errorsOf(leaves({ side: "enemy", other: true, keywords: ["ALPHA"] }), text)).toMatch(/cannot narrow by keyword/u);
  });

  it("measures an ordinary quantifier's range to the attack's target", () => {
    const near = "Each time this model selects its targets, roll one D6 for each enemy unit within 3\" of the target: on a 5+, that unit suffers 1 mortal wound.";
    const effect = mechanicsOf(placed(near, moment,
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 3\" of the target", "unit-position", { kind: "within", inches: 3, of: "target", subject: "antecedent", negated: false }],
      ["on a 5+", "roll-result", { from: 5 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]), near).effect;
    expect(effect.selector).toEqual({ owner: "enemy", eligibility: { type: "within", parameters: { of: "defender", range: { inches: 3 } } } });
  });
});
