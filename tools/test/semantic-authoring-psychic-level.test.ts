import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/**
 * Psychic levels: the psychic-level cost of each "**Name (psychic level N)**" heading (a spend of N
 * from the psychic-level pool), the psyker-level setter (characteristic-set v6), and the record shapes
 * that combine a psyker level in the name with psychic heading costs. Fabricated wording only.
 */

type Item = [wording: string, family: string, parameters: Record<string, unknown>];

/** One leaf on the first occurrence of `wording` in `text`. */
function leafAt(text: string, wording: string, family: string, parameters: Record<string, unknown>, fragment = "RAW_TEXT"): CompileLeaf {
  const start = Buffer.from(text, "utf8").indexOf(Buffer.from(wording, "utf8"));
  if (start < 0) throw new Error(`"${wording}" is not in the text`);
  const version = currentFamilyVersion(family);
  return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(wording, "utf8"), fragment };
}

/** Leaves on their own wording in `text`, in order. Each wording is searched from the end of the previous one. */
function placed(text: string, items: Item[]): CompileLeaf[] {
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

const FABRICATED_ENTRY = { authored_by: "fabricated", game_version: { edition: "11th", dataslate: "fabricated" }, faction_id: "fabricated-faction", ability_type: "unit", unit_ids: [], source_digest: "0".repeat(64), version: "fabricated-v1" };

const cost = (wording: string, level: number): Item => [wording, "psychic-level-cost", { level }];
/** A psychic test, with its result band ("On a 4+"). */
const psychicTest: Item[] = [
  ["roll one D6 (psychic)", "dice-roll", { dice: "D6", roll_var: "psychic" }],
  ["On a 4+", "roll-result", { from: 4, to: 6 }],
];
const shooting: Item = ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }];
const sv: Item = ["this unit has +1 Sv", "characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }];

function compiled(text: string, items: Item[]) {
  return compileLeaves(placed(text, items), text);
}

function errorsOf(result: ReturnType<typeof compiled>): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join(" ");
}

function spendOf(part: Record<string, unknown>) {
  return part.cost as { type: string; target: string; modifier: Record<string, unknown> };
}

describe("Semantic authoring psychic-level cost", () => {
  it("accepts a level from 1 to 6 and refuses anything else or any extra key", () => {
    expect(normalizeFingerprintParameters("psychic-level-cost", { level: 1 })).toEqual({ level: 1 });
    expect(normalizeFingerprintParameters("psychic-level-cost", { level: 6 })).toEqual({ level: 6 });
    expect(() => normalizeFingerprintParameters("psychic-level-cost", { level: 0 })).toThrow();
    expect(() => normalizeFingerprintParameters("psychic-level-cost", { level: 7 })).toThrow();
    expect(() => normalizeFingerprintParameters("psychic-level-cost", { level: 2, pool: "x" })).toThrow();
  });

  it("compiles one psychic ability to a part whose cost spends its level", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const result = compiled(text, [cost("psychic level 2", 2), shooting, ...psychicTest, sv]);
    expect(result.ok).toBe(true);
    const part = (result as { mechanics: { effect: Record<string, unknown> } }).mechanics.effect;
    expect(part.type).toBe("ability-part");
    expect(spendOf(part)).toEqual({ type: "resource-spend", target: "this-unit", modifier: { pool: "psychic-level", amount: 2, label: "Psychic Level" } });
    expect(JSON.stringify(part.effect)).toContain("stat-modifier");
  });

  it("gives each psychic heading its own cost, and keeps a leaf in the ability it sits under", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.\n**Beta Ward (psychic level 1)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const result = compiled(text, [cost("psychic level 2", 2), shooting, ...psychicTest, sv, cost("psychic level 1", 1), ...psychicTest, sv]);
    expect(result.ok).toBe(true);
    const effect = (result as { mechanics: { effect: { type: string; steps: Array<Record<string, unknown>> } } }).mechanics.effect;
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step) => spendOf(step).modifier.amount)).toEqual([2, 1]);
    // The shooting window belongs to the first ability only.
    expect(effect.steps.map((step) => JSON.stringify(step).includes("shooting"))).toEqual([true, false]);
  });

  it("refuses a cost whose number is not the heading's level", () => {
    const text = "**Alpha Hex (psychic level 3)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [cost("psychic level 3", 2), ...psychicTest, sv]))).toMatch(/does not match/);
  });

  it("refuses a cost that sits outside any psychic heading", () => {
    const text = "**Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv. Costs psychic level 2 here.";
    expect(errorsOf(compiled(text, [...psychicTest, sv, cost("psychic level 2", 2)]))).toMatch(/names no psychic ability heading/);
  });

  it("refuses two costs in one heading", () => {
    const text = "**Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const leaves = placed(text, [cost("psychic level 2", 2), ...psychicTest, sv]);
    expect(errorsOf(compileLeaves([...leaves, { ...leaves[0]! }], text))).toMatch(/two psychic-level costs/);
  });

  it("refuses a psychic ability with no psychic roll in its own text", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [cost("psychic level 2", 2), shooting, sv]))).toMatch(/psychic roll/);
  });

  it("refuses a leaf before the first psychic heading", () => {
    const text = "this unit has +1 Sv. **Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [sv, cost("psychic level 2", 2), ...psychicTest, sv]))).toMatch(/outside every psychic ability heading/);
  });

  it("refuses a psychic heading without a cost beside one that has it", () => {
    const text = "**Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.\n**Beta Ward (psychic level 1)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [cost("psychic level 2", 2), ...psychicTest, sv, ...psychicTest, sv]))).toMatch(/no psychic-level cost leaf/);
  });

  it("emits a part the ability schema accepts, and the describer renders it", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const result = compiled(text, [cost("psychic level 2", 2), shooting, ...psychicTest, sv]);
    expect(result.ok).toBe(true);
    const original = { ability_id: "fabricated-alpha-hex", name: "Fabricated Alpha Hex", ...FABRICATED_ENTRY };
    const checked = checkEntry(entryWithMechanics(original, (result as { mechanics: Parameters<typeof entryWithMechanics>[1] }).mechanics));
    expect(checked.errors).toEqual([]);
    expect(checked.rendered_text).not.toBeNull();
  });
});

const SETTER = 6;
const setter = (parameters: Record<string, unknown>, version = SETTER) => normalizeFingerprintParameters("characteristic-set", parameters, version);
const setterAt = (text: string, wording: string, parameters: Record<string, unknown>) => leafAt(text, wording, "characteristic-set", parameters);

describe("Semantic authoring characteristic-set v6 psyker-level setter", () => {
  it("accepts a model's psyker level, and v5 still refuses it", () => {
    expect(setter({ subject: "this-model", characteristic: "psyker-level", value: 2 })).toEqual({ subject: "this-model", characteristic: "psyker-level", value: 2 });
    expect(() => setter({ subject: "this-model", characteristic: "psyker-level", value: 2 }, 5)).toThrow();
  });

  it("lowers \"has psyker level 2\" to a model stat-modifier set, with no weapon scope", () => {
    const text = "This model has psyker level 2.";
    const result = compileLeaves([setterAt(text, "has psyker level 2", { subject: "this-model", characteristic: "psyker-level", value: 2 })], text);
    expect(result.ok).toBe(true);
    const mechanics = (result as { mechanics: { effect: Record<string, unknown> } }).mechanics;
    expect(mechanics.effect).toMatchObject({ type: "stat-modifier", target: "this-model", modifier: { stat: "psyker-level", operation: "set", value: 2 } });
    expect((mechanics.effect.modifier as Record<string, unknown>).weapon_type).toBeUndefined();
  });

  it("takes psyker-level in a values list beside other characteristics that share this-model", () => {
    const parsed = setter({ subject: "this-model", values: [{ characteristic: "psyker-level", value: 2 }, { characteristic: "M", value: 7 }] });
    expect(parsed).toEqual({ subject: "this-model", values: [{ characteristic: "psyker-level", value: 2 }, { characteristic: "M", value: 7 }] });
    const text = "This model has psyker level 2 and a Move characteristic of 7.";
    const result = compileLeaves([setterAt(text, "psyker level 2", parsed)], text);
    expect(result.ok).toBe(true);
    const steps = (result as { mechanics: { effect: { type: string; steps: Array<{ modifier: Record<string, unknown> }> } } }).mechanics.effect;
    expect(steps.type).toBe("sequence");
    expect(steps.steps.map((step) => step.modifier.stat)).toEqual(["psyker-level", "M"]);
  });

  it("refuses a psyker level in a values list under v5, which has no psyker-level value", () => {
    expect(() => setter({ subject: "this-model", values: [{ characteristic: "psyker-level", value: 2 }, { characteristic: "M", value: 7 }] }, 5)).toThrow();
  });

  it("emits a setter the ability schema accepts and the describer renders", () => {
    const text = "This model has psyker level 2.";
    const result = compileLeaves([setterAt(text, "has psyker level 2", { subject: "this-model", characteristic: "psyker-level", value: 2 })], text) as { ok: true; mechanics: Parameters<typeof entryWithMechanics>[1] };
    const checked = checkEntry(entryWithMechanics({ ability_id: "fabricated-setter", name: "Fabricated Setter", ...FABRICATED_ENTRY }, result.mechanics));
    expect(checked.errors).toEqual([]);
    expect(checked.rendered_text).not.toBeNull();
  });

  it("refuses a psyker level that is not set on this model", () => {
    expect(() => setter({ subject: "this-unit", characteristic: "psyker-level", value: 2 })).toThrow(/this-model/);
    expect(() => setter({ subject: "selected-unit", characteristic: "psyker-level", value: 2 })).toThrow(/this-model/);
    expect(() => setter({ characteristic: "psyker-level", value: 2 })).toThrow();
  });

  it("refuses a weapon scope on a psyker level", () => {
    expect(() => setter({ subject: "this-model", characteristic: "psyker-level", value: 2, weapon_type: "melee" })).toThrow(/weapon_type/);
    expect(() => setter({ subject: "this-model", characteristic: "psyker-level", value: 2, weapon_name: "arco-flail" })).toThrow(/weapon_name/);
  });

  it("refuses a values list that sets a psyker level on another recipient", () => {
    expect(() => setter({ subject: "this-unit", values: [{ characteristic: "psyker-level", value: 2 }, { characteristic: "M", value: 7 }] })).toThrow(/this-model/);
  });

  it("keeps the earlier characteristic-set forms unchanged", () => {
    expect(setter({ subject: "this-unit", characteristic: "M", value: 7 })).toEqual({ subject: "this-unit", characteristic: "M", value: 7 });
  });
});

// Each case mirrors the leaf shape of one psychic-level record: a psyker level printed in the name
// (a NAME leaf), psychic heading costs in the body, and the body's effects.

/** The name leaf: "psyker level N" inside the record's name. */
const nameLeaf = (name: string, level: number): CompileLeaf => leafAt(name, `psyker level ${level}`, "characteristic-set", { subject: "this-model", characteristic: "psyker-level", value: level }, "NAME");
const body = (text: string, wording: string, family: string, parameters: Record<string, unknown>) => leafAt(text, wording, family, parameters);

describe("Semantic authoring psychic-level follow-up shapes (fabricated)", () => {
  it("compiles the two-cost shape with the name's psyker level (10444, 10535, 10568 mirror)", () => {
    const name = "Fabricated Warden (psyker level 3)";
    const text = "**Beta Ward (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.\n**Gamma Ward (psychic level 1)**\nIn your Fight phase, roll two D6 (psychic). On a 5+, this unit has +1 Ld.";
    const result = compileLeaves([
      nameLeaf(name, 3),
      body(text, "psychic level 2", "psychic-level-cost", { level: 2 }),
      body(text, "In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }),
      body(text, "roll one D6 (psychic)", "dice-roll", { dice: "D6", roll_var: "psychic" }),
      body(text, "On a 4+", "roll-result", { from: 4, to: 6 }),
      body(text, "this unit has +1 Sv", "characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }),
      body(text, "psychic level 1", "psychic-level-cost", { level: 1 }),
      body(text, "In your Fight phase", "phase-window", { phase: "fight", turn: "your" }),
      body(text, "roll two D6 (psychic)", "dice-roll", { dice: "D6", roll_var: "psychic" }),
      body(text, "On a 5+", "roll-result", { from: 5, to: 6 }),
      body(text, "this unit has +1 Ld", "characteristic-modifier", { subject: "this-unit", characteristics: ["Ld"], operation: "improve", value: 1, weapon_type: "all" }),
    ], text, { name });
    expect(result.ok ? [] : (result as { errors: string[] }).errors).toEqual([]);
    const json = JSON.stringify((result as { mechanics: unknown }).mechanics);
    expect(json).toContain('"stat":"psyker-level"');
    expect(json).toContain('"value":3');
  });

  it("refuses the psychic cost shape when the name's psyker level leaf is present but the name is absent", () => {
    const name = "Fabricated Warden (psyker level 3)";
    const text = "**Beta Ward (psychic level 2)**\nIn your Shooting phase, this unit has +1 Sv.";
    const result = compileLeaves([nameLeaf(name, 3), body(text, "psychic level 2", "psychic-level-cost", { level: 2 })], text);
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/record's name/);
  });

  it("compiles the ranged Range shape with a one-cost heading and the name's psyker level (10472 mirror)", () => {
    const name = "Fabricated Sergeant (psyker level 1)";
    const text = "**Delta Hex (psychic level 1)**\nRoll one D6 (psychic). On a 4+, this unit's ranged attacks have +6 Range.";
    const scope = body(text, "this unit's ranged attacks", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" });
    const result = compileLeaves([
      nameLeaf(name, 1),
      body(text, "psychic level 1", "psychic-level-cost", { level: 1 }),
      body(text, "Roll one D6 (psychic)", "dice-roll", { dice: "D6", roll_var: "psychic" }),
      body(text, "On a 4+", "roll-result", { from: 4, to: 6 }),
      { ...scope, role: "CONDITION" },
      body(text, "have +6 Range", "characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 6 }),
    ], text, { name });
    expect(result.ok ? [] : (result as { errors: string[] }).errors).toEqual([]);
    expect(JSON.stringify((result as { mechanics: unknown }).mechanics)).toContain('"stat":"Range"');
  });
});
