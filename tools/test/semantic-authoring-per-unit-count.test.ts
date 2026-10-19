import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Wave 10 per-unit-count authoring shapes (P1 to P3). Fabricated wording only; each test
// builds the leaves a drafter authors for one record shape and pins what compiles.

/** Leaves on their own wording in `text`, in order. Every leaf shares one fragment, as in one rule. */
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

function resultOf(list: CompileLeaf[], text: string) {
  return compileLeaves(list, text);
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = resultOf(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = resultOf(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

describe("Semantic authoring per-unit-count P1: a penalty scaled per 10 models in the bearer's unit", () => {
  const text = "When this unit is selected to fight, that enemy unit makes a battle-shock roll, with -1 from that battle-shock roll for every 10 models in this unit.";
  const fight = ["When this unit is selected to fight", "event", { kind: "selected", to: "fight" }] as [string, string, Record<string, unknown>];

  it("is one test leaf whose scaling parameters emit the test's own scaling block, with no field key", () => {
    const list = placed(text, fight,
      ["that enemy unit makes a battle-shock roll, with -1 from that battle-shock roll for every 10 models in this unit", "test",
        { target: "antecedent", test: "battle-shock", modifier: -1, scaling_per: 10, scaling_of: "models-in-bearer-unit", scaling_round: "down" }]);
    const effect = mechanicsOf(list, text).effect;
    // The antecedent lowers to the trigger's subject (event-subject), the same reference the record's trigger gives.
    expect(effect).toEqual({ type: "test", target: "event-subject", modifier: { test: "battle-shock", modifier: -1 }, scaling: { per: 10, of: "models-in-bearer-unit", round: "down" } });
    expect(effect.scaling).not.toHaveProperty("field");
  });

  it("refuses a count-scale onto a test that already scales its own penalty", () => {
    const list = placed(text, fight,
      ["that enemy unit makes a battle-shock roll, with -1 from that battle-shock roll", "test",
        { target: "antecedent", test: "battle-shock", modifier: -1, scaling_per: 10, scaling_of: "models-in-bearer-unit", scaling_round: "down" }],
      ["for every 10", "count-scale", { per: 10 }],
      ["models", "unit-filter", { side: "friendly", level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }]);
    expect(errorsOf(list, text)).toMatch(/cannot also take a count-scale/u);
  });
});

describe("Semantic authoring per-unit-count P2: a second bonus per 5 models in or embarked in the bearer", () => {
  it("scales only the second bonus, by models in or embarked within the bearer, with no timing", () => {
    const text = "Add 1 to the Strength characteristic of this model. Add 1 to the Strength characteristic of this model for every 5 models in this unit (or embarked within this model).";
    const list = placed(text,
      ["Add 1 to the Strength characteristic of this model.", "characteristic-modifier", { subject: "this-model", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" }],
      ["Add 1 to the Strength characteristic of this model", "characteristic-modifier", { subject: "this-model", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" }],
      ["for every 5", "count-scale", { per: 5 }],
      ["models", "unit-filter", { side: "friendly", level: "model" }],
      ["in this unit (or embarked within this model)", "membership", { relation: "in-or-embarked-in", of: "this-unit" }]);
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("sequence");
    const [flat, scaled] = effect.steps;
    expect(flat.scaling).toBeUndefined();
    expect(scaled.scaling).toEqual({ per: 5, of: "models-in-or-embarked-in-bearer" });
  });
});

describe("Semantic authoring per-unit-count P3: one D6 per model of the moved unit", () => {
  // The bearer is the moved unit ("this unit makes a Normal, Advance or Fall Back move"). The "that unit"
  // form of the same rule is pinned below.
  const text = "Each time this unit makes a Normal, Advance or Fall Back move, roll one D6 for each model in this unit: for each 1, this unit suffers 1 mortal wound.";
  const list = placed(text,
    ["Each time this unit makes a Normal, Advance or Fall Back move", "event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"], subject: "this-unit" }],
    ["roll one D6 for each model in this unit", "dice-roll", { dice: "D6", per_model: "target" }],
    ["for each 1", "roll-result", { from: 1, to: 1 }],
    ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]);

  it("rolls one die per moving model, and each 1 is a mortal wound on the moved unit", () => {
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("mortal-wounds");
    expect(effect.target).toBe("this-unit");
    expect(effect.modifier).toMatchObject({ count: 1, per: "success", roll: { dice: 1, per_model: "this-unit", comparison: "lte", threshold: 1 } });
  });

  it("compiles when the mover is the event subject: the recipient is the antecedent, the count is the mover's models", () => {
    const other = "Each time that unit makes a Normal, Advance or Fall Back move, roll one D6 for each model in that unit: for each 1, that unit suffers 1 mortal wound.";
    const leaves = placed(other,
      ["Each time that unit makes a Normal, Advance or Fall Back move", "event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"], subject: "antecedent" }],
      ["roll one D6 for each model in that unit", "dice-roll", { dice: "D6", per_model: "target" }],
      ["for each 1", "roll-result", { from: 1, to: 1 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "antecedent", count: "1" }]);
    const effect = mechanicsOf(leaves, other).effect;
    expect(effect.target).toBe("event-subject");
    expect(effect.modifier).toMatchObject({ count: 1, per: "success", roll: { dice: 1, per_model: "event-subject", comparison: "lte", threshold: 1 } });
  });

  it("refuses recipient that-unit with an event-subject mover, which names a selection that does not exist", () => {
    const other = "Each time that unit makes a Normal, Advance or Fall Back move, roll one D6 for each model in that unit: for each 1, that unit suffers 1 mortal wound.";
    const leaves = placed(other,
      ["Each time that unit makes a Normal, Advance or Fall Back move", "event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"], subject: "antecedent" }],
      ["roll one D6 for each model in that unit", "dice-roll", { dice: "D6", per_model: "target" }],
      ["for each 1", "roll-result", { from: 1, to: 1 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    expect(errorsOf(leaves, other)).toMatch(/names "that unit", but no select-unit leaf/u);
  });
});
