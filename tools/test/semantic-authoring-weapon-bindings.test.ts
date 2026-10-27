import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility, type Effect } from "../src/translate/index.js";
import { describePredicate } from "../src/translate/condition.js";
import { weaponLabel } from "../src/translate/effect-words.js";

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
    expect(text).toContain('"name":"plasma rifle"');
    expect(text).toContain('"bind_as":"plasma-rifle-weapon"');
    // Both stat changes name the bound weapon and carry no weapon type of their own.
    const modifiers = JSON.stringify(mechanics.effect).match(/"ref":\{"weapon_var":"plasma-rifle-weapon"\}/g) ?? [];
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
    ))).toThrow(/sits beside a select-weapon.*must name its weapon/);
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

  it("takes weapon characteristics for this-model with no weapon_name or weapon_keyword, and hands a weapon_type to the equipped-count form", () => {
    expect(normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" }, version()))
      .toEqual({ characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent" });
    // With a weapon_type it is the equipped-weapon-count form, which the previous version owns.
    expect(normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent", weapon_type: "ranged" }, version()))
      .toMatchObject({ weapon: "antecedent", weapon_type: "ranged" });
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent", weapon_name: "x" }, version())).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 2, weapon: "antecedent" }, version())).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2, weapon: "antecedent", subject: "this-unit" }, version())).toThrow();
  });
});

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

// Fabricated wording: a spear count beside a Close combat weapon, then a stat change on those spears.
const TEXT = "If this model carries two spear weapons besides its Close combat weapon, add 1 to the Attacks characteristic of those two weapons.";
const COUNT_WORDING = "If this model carries two spear weapons besides its Close combat weapon";
const STAT_WORDING = "add 1 to the Attacks characteristic of those two weapons";
const countLeaf = (parameters: Record<string, unknown> = {}): [string, string, Record<string, unknown>] =>
  [COUNT_WORDING, "equipped-weapon-count", { subject: "this-model", weapon_type: "melee", count: 2, other_than: "Close combat weapon", ...parameters }];
const statLeaf = (parameters: Record<string, unknown> = {}): [string, string, Record<string, unknown>] =>
  [STAT_WORDING, "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1, weapon_type: "melee", weapon: "antecedent", ...parameters }];

describe("equipped-weapon-count: compile", () => {
  it("gates the stat adjustment on the count and excludes the named weapon", () => {
    const result = compileLeaves(placed(TEXT, countLeaf(), statLeaf()), TEXT);
    expect(result).toMatchObject({
      ok: true,
      mechanics: {
        effect: {
          type: "conditional",
          condition: { operator: "and", operands: [
            { type: "named-weapon", parameters: { subject: "this-model", name: "Close combat weapon", count: 1 } },
            { type: "equipped-weapon-count", parameters: { subject: "this-model", weapons: { type: "melee", exclude_name: "Close combat weapon" }, count: { min: 2, max: 2 } } },
          ] },
          effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "improve", value: 1, weapons: { type: "melee", exclude_name: "Close combat weapon" } } },
        },
      },
    });
  });

  it("compiles the printed value of the stat change with the same shape (add 2)", () => {
    const text = "If this model carries two spear weapons besides its Close combat weapon, add 2 to the Attacks characteristic of those two weapons.";
    const result = compileLeaves(placed(text, countLeaf(), [STAT_WORDING.replace("add 1", "add 2"), "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 2, weapon_type: "melee", weapon: "antecedent" }]), text);
    expect(result).toMatchObject({ ok: true, mechanics: { effect: { effect: { type: "stat-modifier", modifier: { value: 2, weapons: { exclude_name: "Close combat weapon" } } } } } });
  });

  it("does not compile a count with no effect beside it", () => {
    const result = compileLeaves(placed(TEXT, countLeaf()), TEXT);
    expect(result.ok).toBe(false);
  });

  it("refuses an antecedent stat adjustment for any count but exactly two", () => {
    for (const count of [1, 3]) {
      const result = compileLeaves(placed(TEXT, countLeaf({ count }), statLeaf()), TEXT);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).toContain("exactly two extra weapons");
    }
  });

  it("refuses when the excluded weapon is not the Close combat weapon", () => {
    const result = compileLeaves(placed(TEXT, countLeaf({ other_than: "Power fist" }), statLeaf()), TEXT);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("beside a Close combat weapon");
  });

  it("refuses a negated count, which names no weapons", () => {
    const result = compileLeaves(placed(TEXT, countLeaf({ negated: true }), statLeaf()), TEXT);
    expect(result.ok).toBe(false);
  });

  it("refuses a weapon type that differs from the counted type", () => {
    const result = compileLeaves(placed(TEXT, countLeaf({ weapon_type: "ranged" }), statLeaf()), TEXT);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("weapon_type conflicts");
  });

  it("refuses a subject that differs from the counted model", () => {
    const result = compileLeaves(placed(TEXT, countLeaf(), statLeaf({ subject: "this-unit" })), TEXT);
    expect(result.ok).toBe(false);
  });

  it("refuses an antecedent stat adjustment with no equipped-weapon count in the ability", () => {
    const result = compileLeaves(placed(TEXT, statLeaf()), TEXT);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("exactly one equipped-weapon count");
  });

  it("refuses two equipped-weapon counts beside one antecedent stat adjustment", () => {
    const text = `${TEXT} ${COUNT_WORDING.replace("If", "Also, if")}, add 1 to the Attacks characteristic of those two weapons.`;
    const result = compileLeaves(placed(text, countLeaf(), [COUNT_WORDING.replace("If", "Also, if"), "equipped-weapon-count", { subject: "this-model", weapon_type: "melee", count: 2, other_than: "Close combat weapon" }], statLeaf()), text);
    expect(result.ok).toBe(false);
  });

  it("leaves an unmarked stat adjustment with the same weapon type as it was", () => {
    const text = "Add 1 to the Attacks characteristic of melee weapons.";
    const result = compileLeaves(placed(text, ["Add 1 to the Attacks characteristic of melee weapons", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 1, weapon_type: "melee" }]), text);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("exclude_name");
  });
});

describe("equipped-weapon-count: family parameters", () => {
  it("accepts exactly the shape the compiler reads", () => {
    expect(normalizeFingerprintParameters("equipped-weapon-count", { subject: "this-model", weapon_type: "melee", count: 2, other_than: " Close combat weapon " }, 1))
      .toEqual({ subject: "this-model", weapon_type: "melee", count: 2, other_than: "Close combat weapon" });
  });

  it("refuses a count outside 1 to 12, a blank excluded name, a non-model subject and an unknown type", () => {
    const base = { subject: "this-model", weapon_type: "melee", count: 2, other_than: "Close combat weapon" };
    for (const change of [{ count: 0 }, { count: 13 }, { other_than: "  " }, { subject: "this-unit" }, { weapon_type: "all" }, { extra: true }]) {
      expect(() => normalizeFingerprintParameters("equipped-weapon-count", { ...base, ...change }, 1)).toThrow();
    }
  });

  it("refuses an antecedent characteristic-modifier without a melee or ranged weapon_type", () => {
    const base = { characteristics: ["A"], operation: "improve", value: 1, weapon: "antecedent" };
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "melee" }, 13)).not.toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base }, 13)).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "all" }, 13)).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "melee", weapon_name: "Spear" }, 13)).toThrow();
  });
});

describe("equipped-weapon-count: describer", () => {
  const condition = { type: "equipped-weapon-count", parameters: { subject: "this-model", weapons: { type: "melee", exclude_name: "Close combat weapon" }, count: { min: 2, max: 2 } } };

  it("reads the exact count with the named weapon excluded", () => {
    expect(describePredicate(condition as never, false)).toBe('this model is equipped with exactly 2 melee weapons other than "Close combat weapon"');
    expect(describePredicate(condition as never, true)).toBe('this model is not equipped with exactly 2 melee weapons other than "Close combat weapon"');
  });

  it("names the excluded weapon in the stat adjustment", () => {
    const effect = { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "improve", value: 1, weapons: { type: "melee", exclude_name: "Close combat weapon" } } } as unknown as Effect;
    expect(describeAbility({ effect, scope: { duration: "permanent" } } as never)).toContain('of melee weapons other than "Close combat weapon" equipped by this model');
  });
});

{
  /** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
  function compiled(list: CompileLeaf[], text: string): Record<string, any> {
    const result = compileLeaves(list, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics as unknown as Record<string, any>;
  }

  // Inline weapon profiles: the owner prints the weapon's name, and its stats come from the dump
  // entity the id names. The leaf therefore carries only the grant and the id.
  describe("inline weapon profile grant shapes", () => {
    it("compiles an enhancement's bearer clause and granted weapon (S1 shape)", () => {
      const text = "Alpha model only. This model has the following weapon:";
      const mechanics = compiled(placed(text,
        ["Alpha model only", "bearer-eligibility", { keywords: ["ALPHA"], match: "all", excluded_keywords: [] }],
        ["This model has the following weapon", "weapon-grant", { subject: "this-model", weapon_id: "fab-blade-wurrband" }]), text);
      expect(mechanics.effect).toEqual({ type: "weapon-grant", target: "this-model", modifier: { weapon_id: "fab-blade-wurrband" } });
      expect(mechanics.scope).toEqual({ duration: "permanent" });
    });

    it("compiles a unit's drone wargear grant with no count (S2 shape)", () => {
      const text = "The bearer is equipped with the following ranged weapon:";
      const mechanics = compiled(placed(text,
        ["The bearer is equipped with the following ranged weapon", "weapon-grant", { subject: "this-model", weapon_id: "fab-gun-drone-drone" }]), text);
      expect(mechanics.effect).toEqual({ type: "weapon-grant", target: "this-model", modifier: { weapon_id: "fab-gun-drone-drone" } });
    });

    it("keeps the printed count of a single granted copy (S2 correction shape)", () => {
      const text = "The bearer is equipped with 1 fab cannon.";
      const mechanics = compiled(placed(text,
        ["The bearer is equipped with 1 fab cannon", "weapon-grant", { subject: "this-model", weapon_id: "fab-cannon-drone", count: 1 }]), text);
      expect(mechanics.effect.modifier).toEqual({ weapon_id: "fab-cannon-drone", count: 1 });
    });
  });

  // Exported wording for a granted weapon: the printed profile name, never the "-drone" disambiguator.
  describe("granted weapon label", () => {
    it("drops the drone disambiguator from a drone weapon id", () => {
      expect(weaponLabel("twin-pulse-carbine-drone")).toBe("Twin Pulse Carbine");
      expect(weaponLabel("drone-burst-cannon-drone")).toBe("Drone Burst Cannon");
    });

    it("title-cases an id without the suffix and keeps a curated printed name", () => {
      expect(weaponLabel("missile-pod")).toBe("Missile Pod");
      expect(weaponLabel("tl-4-9-lords-of-the-forge")).toBe("TL-4ø9");
    });
  });
}
