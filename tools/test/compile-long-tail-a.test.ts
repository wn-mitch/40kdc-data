import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { describeAbility } from "../src/translate/effect.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// Parameter additions to existing families: what each accepts, refuses and lowers to. Wording is fabricated.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters);
const compiled = (text: string, ...items: Parameters<typeof placed>[1][]) => {
  const result = compileLeaves(placed(text, ...items), text);
  expectCompiled(result);
  return JSON.stringify(result.mechanics.effect);
};

describe("the families", () => {
  it("reads a Feel No Pain list in canonical order and refuses the pair psychic-and-mortal names", () => {
    expect(normalize("feel-no-pain", { subject: "this-unit", threshold: 4, against: ["devastating-wounds", "mortal", "psychic"] }))
      .toMatchObject({ against: ["mortal", "psychic", "devastating-wounds"] });
    expect(normalize("feel-no-pain", { subject: "this-unit", threshold: 5, against: "damage-1-unmodified" })).toMatchObject({ against: "damage-1-unmodified" });
    expect(() => normalize("feel-no-pain", { subject: "this-unit", threshold: 4, against: ["mortal", "psychic"] })).toThrow();
    expect(() => normalize("feel-no-pain", { subject: "this-unit", threshold: 4, against: ["mortal"] })).toThrow();
    expect(() => normalize("feel-no-pain", { subject: "this-unit", threshold: 4, against: ["mortal", "blast"] })).toThrow();
  });

  it("takes not_cumulative only on a worsening change", () => {
    expect(normalize("roll-modifier", { roll: "charge", operation: "subtract", value: 2, subject: "event-subject", not_cumulative: "negative-modifiers" }))
      .toMatchObject({ not_cumulative: "negative-modifiers" });
    expect(normalize("roll-modifier", { roll: "charge", operation: "add", value: 1, subject: "this-unit", not_cumulative: { ability: "fabricated-veil" } }))
      .toMatchObject({ not_cumulative: { ability: "fabricated-veil" } });
    expect(() => normalize("roll-modifier", { roll: "charge", operation: "add", value: 1, subject: "this-unit", not_cumulative: "negative-modifiers" })).toThrow();
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1, not_cumulative: "negative-modifiers" })).toThrow();
    expect(normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "subtract", value: 2, not_cumulative: "negative-modifiers" }))
      .toMatchObject({ not_cumulative: "negative-modifiers" });
  });

  it("keeps shoot-or-fight to the moment after the attacking unit finishes", () => {
    expect(normalize("fight-on-death", { act: "shoot-or-fight", timing: "after-the-attacking-unit-finishes" })).toMatchObject({ act: "shoot-or-fight" });
    expect(() => normalize("fight-on-death", { act: "shoot-or-fight" })).toThrow();
  });

  it("takes the new closed values and refuses neighbours", () => {
    expect(normalize("critical-hit-threshold", { roll: "hit", value: "success" })).toMatchObject({ value: "success" });
    expect(() => normalize("critical-hit-threshold", { roll: "hit", value: "failure" })).toThrow();
    expect(normalize("make-move", { subject: "this-unit", move_type: "normal", distance: 6, as_if_keywords: ["FLY"] })).toMatchObject({ as_if_keywords: ["FLY"] });
    expect(() => normalize("make-move", { subject: "this-unit", move_type: "normal", distance: 6, as_if_keywords: ["INFANTRY"] })).toThrow();
    expect(normalize("select-objective-open", { bind_as: "marked", count: 1, visible_to: "this-unit" })).toMatchObject({ visible_to: "this-unit" });
    expect(() => normalize("select-objective-open", { bind_as: "marked", count: 1, visible_to: "enemy-unit" })).toThrow();
    expect(normalize("counts-as", { subject: "this-unit", model_count_below: 5, for_weapon_ability: "Blast" })).toMatchObject({ model_count_below: 5 });
    expect(() => normalize("counts-as", { subject: "this-unit", model_count_below: 5 })).toThrow();
    expect(() => normalize("counts-as", { subject: "this-unit", model_count_below: 1, for_weapon_ability: "Blast" })).toThrow();
  });

  it("counts uses from equipped wargear only for a once-per-battle limit", () => {
    expect(normalize("usage-limit", { frequency: "once-per-battle", per: "unit", count_from: "equipped-wargear" })).toMatchObject({ count_from: "equipped-wargear" });
    expect(() => normalize("usage-limit", { frequency: "once-per-turn", per: "unit", count_from: "equipped-wargear" })).toThrow();
  });

  it("sets Range only on a weapon", () => {
    expect(normalize("characteristic-set", { subject: "this-model", weapon_type: "ranged", values: [{ characteristic: "Range", value: 18 }, { characteristic: "D", value: 8 }] }))
      .toMatchObject({ values: [{ characteristic: "Range", value: 18 }, { characteristic: "D", value: 8 }] });
    expect(() => normalize("characteristic-set", { subject: "this-model", weapon_type: "melee", characteristic: "Range", value: 18 })).toThrow();
    expect(() => normalize("characteristic-set", { subject: "this-model", weapon_type: "all", characteristic: "Range", value: 18 })).toThrow();
  });

  it("maps every earlier leaf of a bumped family onto the current version unchanged", () => {
    for (const [family, from] of [["critical-hit-threshold", 1], ["characteristic-set", 10], ["feel-no-pain", 5], ["fight-on-death", 2], ["roll-modifier", 13],
      ["characteristic-modifier", 21], ["characteristic-modifier", 22], ["make-move", 8], ["select-objective-open", 1], ["usage-limit", 6], ["counts-as", 3],
      ["apply-mark", 9], ["apply-mark", 10]] as const) {
      const parameters = { probe: family };
      expect(mapToLatest(family, from, parameters)).toMatchObject({ family, parameters });
    }
  });
});

describe("lowering", () => {
  it("lowers each new parameter onto its DSL field", () => {
    const fnp = "Models in your unit have the Feel No Pain 4+ ability against mortal wounds and fabricated criticals.";
    expect(compiled(fnp, ["Models in your unit have the Feel No Pain 4+ ability against mortal wounds and fabricated criticals", "feel-no-pain",
      { subject: "this-unit", threshold: 4, against: ["mortal", "devastating-wounds"] }])).toContain('"against":["mortal","devastating-wounds"]');
    const blast = "Your unit is treated as containing fewer than five models for the purpose of the Blast ability.";
    expect(compiled(blast, ["Your unit is treated as containing fewer than five models for the purpose of the Blast ability", "counts-as",
      { subject: "this-unit", model_count_below: 5, for_weapon_ability: "Blast" }])).toContain('"modifier":{"model_count":{"below":5},"for_weapon_ability":"blast"}');
    const roll = "Subtract 2 from the Charge roll (not cumulative with other penalties).";
    expect(compiled(roll, ["Subtract 2 from the Charge roll (not cumulative with other penalties", "roll-modifier",
      { operation: "subtract", value: 2, roll: "charge", subject: "this-unit", not_cumulative: "negative-modifiers" }])).toContain('"not_cumulative":"negative-modifiers"');
    const crit = "Each successful Hit roll scores a Critical Hit.";
    expect(compiled(crit, ["Each successful Hit roll scores a Critical Hit", "critical-hit-threshold", { roll: "hit", value: "success" }])).toContain('"success"');
  });

  it("lowers an allocated attack's Damage set to 1 as a damage reduction, not a permanent attacker change", () => {
    const text = "Each time an attack is allocated to this model, change the Damage characteristic of that attack to 1.";
    const json = compiled(text,
      ["Each time an attack is allocated to this model", "event", { kind: "damage-allocated", object: "this-model" }],
      ["change the Damage characteristic of that attack to 1", "characteristic-set", { subject: "attack", characteristic: "D", value: 1, weapon_type: "all" }]);
    expect(json).toContain('"type":"damage-reduction"');
    expect(json).toContain('"reduction":"to-one"');
    expect(json).not.toContain('"stat":"D"');
  });
});

describe("the cruncher", () => {
  const source = { kind: "ability", abilityId: "fabricated-warding", abilityKind: "unit" } as const;
  const fnp = (against: unknown) => ({ type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5, against } });

  it("folds a Feel No Pain list into the mortal stream only when it names mortal wounds", () => {
    const withMortal = effectToBuffs(fnp(["mortal", "devastating-wounds"]) as never, source, { phase: "shooting" } as never, "target");
    expect(JSON.stringify(withMortal.applied)).toContain('"scope":"mortal"');
    const without = effectToBuffs(fnp(["psychic", "devastating-wounds"]) as never, source, { phase: "shooting" } as never, "target");
    expect(without.applied).toEqual([]);
    expect(without.unsupported.map((u) => u.reason).join()).toMatch(/without mortal wounds/u);
  });

  it("leaves a Damage-1 Feel No Pain and a set-to-1 reduction unsupported rather than overstating defence", () => {
    const d1 = effectToBuffs(fnp("damage-1-unmodified") as never, source, { phase: "shooting" } as never, "target");
    expect(d1.applied).toEqual([]);
    const toOne = effectToBuffs({ type: "damage-reduction", target: "this-unit", modifier: { reduction: "to-one" } } as never, source, { phase: "shooting" } as never, "target");
    expect(toOne.applied).toEqual([]);
    expect(toOne.unsupported.map((u) => u.reason).join()).toMatch(/setting Damage to 1/u);
  });
});

describe("the describer", () => {
  it("prints a not-cumulative change after the change it qualifies", () => {
    expect(describeAbility({ effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "charge", operation: "subtract", value: 2, not_cumulative: "negative-modifiers" } }, scope: { duration: "phase" } } as never))
      .toContain("subtract 2 from this unit's Charge rolls (this is not cumulative with any other negative modifiers to that roll)");
  });

  it("does not repeat per unit after a count taken from the unit's wargear", () => {
    const text = describeAbility({ effect: { type: "ability-part", usage: { frequency: "n-per-battle", count_from: "equipped-wargear", per: "unit" },
      effect: { type: "cp-gain", target: "this-model", modifier: { amount: 1 } } }, scope: { duration: "resolution" } } as never);
    expect(text).toContain("Once per battle for each copy of this wargear its unit is equipped with, you gain 1 CP.");
    expect(text).not.toContain("per unit");
  });
});
