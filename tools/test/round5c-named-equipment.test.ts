import { describe, expect, it } from "vitest";

import { condition } from "../src/round5c/compile-conditions.js";
import { namedEquipmentPredicate, refuseUnitEquipmentPairs } from "../src/round5c/compile-named-equipment.js";
import { CompileError, type CompileLeaf } from "../src/round5c/compile-fragments.js";
import { compileLeaves } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { describePredicate } from "../src/translate/condition.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

const STAT_WORDING = "add 1 to the Attacks characteristic of melee weapons";
const STAT: [string, string, Record<string, unknown>] =
  [STAT_WORDING, "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 1, weapon_type: "melee" }];
const carry = (at_least: number) => ({ at_least, state: "carry" });
const lack = (at_least: number) => ({ at_least, state: "lack" });

describe("named-weapon: compile", () => {
  it("counts this model's weapons of one printed name, exactly", () => {
    const text = `If this model carries two fizz blades, ${STAT_WORDING}.`;
    const result = compileLeaves(placed(text, ["If this model carries two fizz blades", "named-weapon", { subject: "this-model", name: "Fizz blade", count: 2 }], STAT), text);
    expect(result).toMatchObject({
      ok: true,
      mechanics: { effect: { type: "conditional", condition: { type: "named-weapon", parameters: { subject: "this-model", name: "Fizz blade", count: 2 } } } },
    });
    expect(JSON.stringify(result)).not.toContain('"models"');
  });

  it("wraps a negated named-weapon in not, and leaves the predicate itself unchanged", () => {
    const leaf = placed("If this model does not carry one fizz blade", ["does not carry one fizz blade", "named-weapon", { subject: "this-model", name: "Fizz blade", count: 1, negated: true }])[0]!;
    expect(condition(leaf)).toEqual({ operator: "not", operands: [{ type: "named-weapon", parameters: { subject: "this-model", name: "Fizz blade", count: 1 } }] });
  });

  it("refuses a this-unit named-weapon with no models quantifier", () => {
    const leaf = placed("If this unit carries one fizz blade", ["carries one fizz blade", "named-weapon", { subject: "this-unit", name: "Fizz blade", count: 1 }])[0]!;
    expect(() => namedEquipmentPredicate(leaf)).toThrow(CompileError);
  });

  it("refuses a this-model named-weapon that carries a models quantifier", () => {
    const leaf = placed("If this model carries one fizz blade", ["carries one fizz blade", "named-weapon", { subject: "this-model", name: "Fizz blade", count: 1, models: carry(1) }])[0]!;
    expect(() => namedEquipmentPredicate(leaf)).toThrow(CompileError);
  });

  it("refuses an empty printed name", () => {
    const leaf = placed("If this model carries one fizz blade", ["carries one fizz blade", "named-weapon", { subject: "this-model", name: "", count: 1 }])[0]!;
    expect(() => namedEquipmentPredicate(leaf)).toThrow(CompileError);
  });
});

describe("named-weapon and unit-wargear: family parameters", () => {
  it("writes a U+2010 hyphen in a printed name as ASCII", () => {
    expect(normalizeFingerprintParameters("named-weapon", { subject: "this-model", name: " Fizz‐blade ", count: 1 }, 1))
      .toEqual({ subject: "this-model", name: "Fizz-blade", count: 1 });
  });

  it("refuses an unknown key in named-weapon parameters", () => {
    expect(() => normalizeFingerprintParameters("named-weapon", { subject: "this-model", name: "Fizz blade", count: 1, extra: true }, 1)).toThrow();
  });

  it("refuses unit-wargear for any subject but this unit", () => {
    expect(() => normalizeFingerprintParameters("unit-wargear", { subject: "this-model", wargear: "relay-kit" }, 1)).toThrow();
  });

  it("refuses a wargear id that is not kebab case", () => {
    expect(() => normalizeFingerprintParameters("unit-wargear", { subject: "this-unit", wargear: "Death Korps Medi-pack" }, 1)).toThrow();
  });
});

describe("named-weapon and unit-wargear: describer", () => {
  const weapon = (count: number, state?: "carry" | "lack", at_least = 2) => ({
    type: "named-weapon",
    parameters: state ? { subject: "this-unit", name: "Fizz blade", count, models: { at_least, state } } : { subject: "this-model", name: "Fizz blade", count },
  });

  it("reads a this-model count, exact or single", () => {
    expect(describePredicate(weapon(1) as never, false)).toBe('this model is equipped with one weapon named "Fizz blade"');
    expect(describePredicate(weapon(2) as never, false)).toBe('this model is equipped with exactly 2 weapons named "Fizz blade"');
    expect(describePredicate(weapon(2) as never, true)).toBe('this model is not equipped with exactly 2 weapons named "Fizz blade"');
  });

  it("reads the lack state as none, or fewer than N, and carry as each having exactly N", () => {
    expect(describePredicate(weapon(1, "lack", 1) as never, false)).toBe('one or more models in this unit have no weapon named "Fizz blade"');
    expect(describePredicate(weapon(2, "lack", 2) as never, false)).toBe('at least 2 models in this unit have fewer than 2 weapons named "Fizz blade"');
    expect(describePredicate(weapon(2, "carry", 2) as never, false)).toBe('at least 2 models in this unit are each equipped with exactly 2 weapons named "Fizz blade"');
    expect(describePredicate(weapon(1, "carry", 2) as never, true)).toBe('it is not the case that at least 2 models in this unit are each equipped with one weapon named "Fizz blade"');
  });

  it("reads wargear presence, and the models forms, with the wargear id as a title", () => {
    const presence = { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "death-korps-medi-pack" } };
    expect(describePredicate(presence as never, false)).toBe("this unit has the Death Korps Medi Pack wargear");
    expect(describePredicate(presence as never, true)).toBe("this unit does not have the Death Korps Medi Pack wargear");
    const models = { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "relay-kit", models: carry(2) } };
    expect(describePredicate(models as never, false)).toBe("at least 2 models in this unit are equipped with the Relay Kit wargear");
    const lacking = { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "relay-kit", models: lack(1) } };
    expect(describePredicate(lacking as never, false)).toBe("one or more models in this unit are not equipped with the Relay Kit wargear");
  });
});

describe("named-weapon and unit-wargear: unit-level pairs", () => {
  it("refuses two unit-level equipment conditions when one carries a models quantifier", () => {
    const text = `If this unit has the relay kit and at least one model carries the tap, ${STAT_WORDING}.`;
    const leaves = placed(text,
      ["has the relay kit", "unit-wargear", { subject: "this-unit", wargear: "relay-kit" }],
      ["at least one model carries the tap", "named-weapon", { subject: "this-unit", name: "Tap", count: 1, models: carry(1) }],
      STAT);
    expect(() => refuseUnitEquipmentPairs(leaves)).toThrow(new CompileError("Two unit-level equipment conditions in one ability need one model to carry both; the DSL cannot say that."));
    expect(compileLeaves(leaves, text).ok).toBe(false);
  });

  it("compiles two presence-only unit-wargear conditions as two predicates", () => {
    const text = `If this unit has the relay kit and the tap kit, ${STAT_WORDING}.`;
    const result = compileLeaves(placed(text,
      ["has the relay kit", "unit-wargear", { subject: "this-unit", wargear: "relay-kit" }],
      ["and the tap kit", "unit-wargear", { subject: "this-unit", wargear: "tap-kit" }],
      STAT), text);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).match(/"type":"unit-wargear"/g)?.length).toBe(2);
  });
});

// Record shapes (fabricated wording): each draft leaf set a record's acceptance step depends on.
describe("named equipment: record shapes", () => {
  it("gates a stat change on two counts of one name and one count of another (647 shape)", () => {
    const text = "If this model carries two fizz caestus weapons in addition to its armoured feet weapon, add 2 to the Attacks characteristic of those fizz caestus weapons.";
    const result = compileLeaves(placed(text,
      ["carries two fizz caestus weapons", "named-weapon", { subject: "this-model", name: "Fizz caestus", count: 2 }],
      ["in addition to its armoured feet weapon", "named-weapon", { subject: "this-model", name: "Armoured feet", count: 1 }],
      ["add 2 to the Attacks characteristic of those fizz caestus weapons", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 2, weapon_type: "melee", weapon_name: "Fizz caestus" }]), text);
    expect(result).toMatchObject({
      ok: true,
      mechanics: { effect: { type: "conditional", condition: { operator: "and", operands: [
        { type: "named-weapon", parameters: { subject: "this-model", name: "Fizz caestus", count: 2 } },
        { type: "named-weapon", parameters: { subject: "this-model", name: "Armoured feet", count: 1 } },
      ] }, effect: { type: "stat-modifier", modifier: { value: 2, weapon_name: "Fizz caestus" } } } },
    });
  });

  it("gates a melee stat change on two named weapons of one model (4048 shape)", () => {
    const text = "If this model is equipped with a fizz spear and a bolt chainsword, add 2 to the Attacks characteristic of melee weapons equipped by this model.";
    const result = compileLeaves(placed(text,
      ["equipped with a fizz spear", "named-weapon", { subject: "this-model", name: "Fizz spear", count: 1 }],
      ["and a bolt chainsword", "named-weapon", { subject: "this-model", name: "Bolt chainsword", count: 1 }],
      ["add 2 to the Attacks characteristic of melee weapons equipped by this model", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 2, weapon_type: "melee" }]), text);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"operator":"and"');
  });

  it("gates a unit characteristic on wargear presence (5501 shape)", () => {
    const text = "If equipped with a fizz relay platform, this unit has a Wounds characteristic of 15.";
    const result = compileLeaves(placed(text,
      ["If equipped with a fizz relay platform", "unit-wargear", { subject: "this-unit", wargear: "fizz-relay-platform" }],
      ["has a Wounds characteristic of 15", "characteristic-set", { subject: "this-unit", characteristic: "W", value: 15 }]), text);
    expect(result).toMatchObject({ ok: true, mechanics: { effect: { type: "conditional", condition: { type: "unit-wargear", parameters: { wargear: "fizz-relay-platform" } } } } });
    expect(JSON.stringify(result)).not.toContain('"models"');
  });

  it("compiles a lack-state unit weapon condition as one gate (8317 and 8318 condition)", () => {
    const text = "At the start of the Fight phase, if a model in this unit does not have a fizz vortex weapon, add 1 to the Attacks characteristic of melee weapons.";
    const result = compileLeaves(placed(text,
      ["if a model in this unit does not have a fizz vortex weapon", "named-weapon", { subject: "this-unit", name: "Fizz vortex", count: 1, models: { at_least: 1, state: "lack" } }],
      ["add 1 to the Attacks characteristic of melee weapons", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 1, weapon_type: "melee" }]), text);
    expect(result).toMatchObject({ ok: true, mechanics: { effect: { type: "conditional", condition: { type: "named-weapon", parameters: { models: { at_least: 1, state: "lack" } } } } } });
  });

  it("keeps a named-weapon loadout check to the loadout leaf (9191 shape)", () => {
    const text = "Add 1 to the Hit roll if all ranged weapons equipped by each Fizz unit model in this unit are the same.";
    const result = compileLeaves(placed(text,
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["if all ranged weapons equipped by each Fizz unit model in this unit are the same", "loadout", { subject: "this-unit", model_keyword: "FIZZ UNIT", uniform: "ranged" }]), text);
    expect(result).toMatchObject({ ok: true, mechanics: { effect: { condition: { type: "loadout", parameters: { model_keyword: "FIZZ UNIT", uniform: "ranged" } } } } });
  });

  it("gates each return of a returned-model pair on the wargear, under the below-strength gate (1453 shape)", () => {
    // The compiled gate factors the shared below-strength condition outside the sequence. The two
    // returns are: D3 when the unit lacks two carriers, and D3+1 when it has them.
    const text = "At the start of your Command phase, if the bearer's unit is below its Starting Strength, you can return up to D3 destroyed Fizz troopers to this unit (if this unit contains two models equipped with a fizz medi-pack, return up to D3+1 destroyed Fizz troopers to this unit instead).";
    const result = compileLeaves(placed(text,
      ["if the bearer's unit is below its Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }],
      ["you can return up to D3 destroyed Fizz troopers to this unit", "return-models", { subject: "this-unit", count: "D3" }],
      ["if this unit contains two models equipped with a fizz medi-pack", "unit-wargear", { subject: "this-unit", wargear: "fizz-medi-pack", models: { at_least: 2, state: "carry" } }],
      ["return up to D3+1 destroyed Fizz troopers to this unit", "return-models", { subject: "this-unit", count: "D3+1" }],
      ["instead", "instead", {}]), text);
    const wargear = { type: "unit-wargear", parameters: { subject: "this-unit", wargear: "fizz-medi-pack", models: { at_least: 2, state: "carry" } } };
    expect(result).toMatchObject({
      ok: true,
      mechanics: { effect: { type: "conditional", condition: { type: "strength", parameters: { below: "starting" } }, effect: { type: "sequence", steps: [
        { type: "conditional", condition: { operator: "not", operands: [wargear] }, effect: { type: "return-models", modifier: { count: "D3" } } },
        { type: "conditional", condition: wargear, effect: { type: "return-models", modifier: { count: "D3+1" } } },
      ] } } },
    });
  });
});
