import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility, type Effect } from "../src/translate/index.js";
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
