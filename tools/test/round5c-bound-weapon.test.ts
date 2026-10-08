import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/**
 * Battle-formation weapon change: select-weapon names a weapon, and a stat adjustment with
 * weapon: antecedent changes only that weapon. Wording is fabricated.
 */

/**
 * Leaves at their current versions, each placed at the next offset (no sentence breaks). Parameters
 * go through the family's normalizer, as a parsed leaf's do before it compiles.
 */
function leaves(...items: Array<[string, Record<string, unknown>]>): CompileLeaf[] {
  let offset = 0;
  return items.map(([family, parameters]) => {
    offset += 10;
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: offset, end_byte: offset + 5,
    };
  });
}

const BATTLE_FORMATION = (): CompileLeaf[] => leaves(
  ["event", { kind: "battle-formations-declared" }],
  ["select-weapon", { target: "this-model", weapon_name: "Plasma rifle", bind_as: "plasma-rifle-weapon" }],
  ["weapon-property-scope", { subject: "this-model", weapon: "antecedent" }],
  ["characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" }],
  ["characteristic-modifier", { characteristics: ["A", "AP", "D"], operation: "improve", value: 1, weapon: "antecedent" }],
);

function compiled(list: CompileLeaf[]) {
  const result = compileLeaves(list);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

describe("select-weapon names the weapon it binds", () => {
  it("accepts weapon_name at the current version and lowercases it as the DSL carries names", () => {
    const version = currentFamilyVersion("select-weapon");
    expect(normalizeFingerprintParameters("select-weapon", { target: "this-model", weapon_name: "T’au flamer", bind_as: "w" }, version))
      .toEqual({ target: "this-model", bind_as: "w", weapon_name: "t’au flamer" });
  });

  it("refuses weapon_name at the earlier version and a blank name", () => {
    const version = currentFamilyVersion("select-weapon");
    expect(() => normalizeFingerprintParameters("select-weapon", { target: "this-model", weapon_name: "Plasma rifle", bind_as: "w" }, version - 1)).toThrow();
    expect(() => normalizeFingerprintParameters("select-weapon", { target: "this-model", weapon_name: "  ", bind_as: "w" }, version)).toThrow();
  });
});

describe("a stat adjustment with weapon: antecedent changes the selected weapon", () => {
  it("lowers the select to a named bind and each stat change to the bound weapon", () => {
    const { mechanics } = compiled(BATTLE_FORMATION());
    const text = JSON.stringify(mechanics.effect);
    expect(text).toContain('"weapon_name":"plasma rifle"');
    expect(text).toContain('"bind_as":"plasma-rifle-weapon"');
    // Both stat changes name the bound weapon and carry no weapon_type of their own.
    const modifiers = JSON.stringify(mechanics.effect).match(/"weapon_ref":\{"weapon_var":"plasma-rifle-weapon"\}/g) ?? [];
    expect(modifiers.length).toBe(4);
    expect(text).not.toContain('"weapon_type"');
  });

  it("refuses an antecedent adjustment with no select-weapon before it or in the ability", () => {
    expect(() => compiled(leaves(
      ["weapon-property-scope", { subject: "this-model", weapon: "antecedent" }],
      ["characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" }],
      ["select-weapon", { target: "this-model", weapon_name: "Plasma rifle", bind_as: "w" }],
    ))).toThrow(/no earlier select-weapon/);
    expect(() => compiled(leaves(
      ["weapon-property-scope", { subject: "this-model", weapon: "antecedent" }],
      ["characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" }],
    ))).toThrow(/select-weapon in this ability/);
  });

  it("refuses an antecedent after a select-weapon that binds several weapons", () => {
    expect(() => compiled(leaves(
      ["select-weapon", { target: "this-model", count: 2, weapon_type: "ranged", bind_as: "pair" }],
      ["weapon-property-scope", { subject: "this-model", weapon: "antecedent" }],
      ["characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" }],
    ))).toThrow(/several/);
  });

  it("refuses a weapon-scoped stat adjustment that names no weapon when the record selects one", () => {
    expect(() => compiled(leaves(
      ["select-weapon", { target: "this-model", weapon_name: "Plasma rifle", bind_as: "w" }],
      ["weapon-property-scope", { subject: "this-model", weapon_type: "ranged" }],
      ["characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2 }],
    ))).toThrow(/must name that weapon/);
  });

  it("keeps a weapon-scoped stat adjustment with no select-weapon compiling as before", () => {
    expect(() => compiled(leaves(
      ["weapon-property-scope", { subject: "this-model", weapon_type: "ranged" }],
      ["characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2 }],
    ))).not.toThrow();
  });

  it("refuses a keyword grant under a bound-weapon scope rather than widening it to the weapon type", () => {
    expect(() => compiled(leaves(
      ["select-weapon", { target: "this-model", weapon_name: "Plasma rifle", bind_as: "w" }],
      ["weapon-property-scope", { subject: "this-model", weapon: "antecedent" }],
      ["weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ))).toThrow(/stat adjustments only/);
  });
});

describe("characteristic-modifier v13 weapon: antecedent", () => {
  const version = () => currentFamilyVersion("characteristic-modifier");

  it("takes weapon characteristics for this-model with no weapon_type, weapon_name or weapon_keyword", () => {
    expect(normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" }, version()))
      .toEqual({ characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" });
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent", weapon_type: "ranged" }, version())).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent", weapon_name: "x" }, version())).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 2, weapon: "antecedent" }, version())).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent", subject: "this-unit" }, version())).toThrow();
  });
});
