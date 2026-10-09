import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/**
 * Psyker-level setter: characteristic-set v6 takes psyker-level on the model. Fabricated wording only.
 */

const SETTER = 6;
const setter = (parameters: Record<string, unknown>, version = SETTER) => normalizeFingerprintParameters("characteristic-set", parameters, version);

function leafAt(text: string, wording: string, parameters: Record<string, unknown>): CompileLeaf {
  const start = Buffer.from(text, "utf8").indexOf(Buffer.from(wording, "utf8"));
  if (start < 0) throw new Error(`"${wording}" is not in the text`);
  const version = currentFamilyVersion("characteristic-set");
  return { role: familyRole("characteristic-set", version), family_id: "characteristic-set", family_version: version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(wording, "utf8"), fragment: "RAW_TEXT" };
}

describe("Round 5C characteristic-set v6 psyker-level setter", () => {
  it("is the current characteristic-set version", () => {
    expect(currentFamilyVersion("characteristic-set")).toBe(SETTER);
  });

  it("accepts a model's psyker level, and v5 still refuses it", () => {
    expect(setter({ subject: "this-model", characteristic: "psyker-level", value: 2 })).toEqual({ subject: "this-model", characteristic: "psyker-level", value: 2 });
    expect(() => setter({ subject: "this-model", characteristic: "psyker-level", value: 2 }, 5)).toThrow();
  });

  it("lowers \"has psyker level 2\" to a model stat-modifier set, with no weapon scope", () => {
    const text = "This model has psyker level 2.";
    const compiled = compileLeaves([leafAt(text, "has psyker level 2", { subject: "this-model", characteristic: "psyker-level", value: 2 })], text);
    expect(compiled.ok).toBe(true);
    const mechanics = (compiled as { mechanics: { effect: Record<string, unknown> } }).mechanics;
    expect(mechanics.effect).toMatchObject({ type: "stat-modifier", target: "this-model", modifier: { stat: "psyker-level", operation: "set", value: 2 } });
    expect((mechanics.effect.modifier as Record<string, unknown>).weapon_type).toBeUndefined();
  });

  it("takes psyker-level in a values list beside other characteristics that share this-model", () => {
    const parsed = setter({ subject: "this-model", values: [{ characteristic: "psyker-level", value: 2 }, { characteristic: "M", value: 7 }] });
    expect(parsed).toEqual({ subject: "this-model", values: [{ characteristic: "psyker-level", value: 2 }, { characteristic: "M", value: 7 }] });
    const text = "This model has psyker level 2 and a Move characteristic of 7.";
    const compiled = compileLeaves([leafAt(text, "psyker level 2", parsed)], text);
    expect(compiled.ok).toBe(true);
    const steps = (compiled as { mechanics: { effect: { type: string; steps: Array<{ modifier: Record<string, unknown> }> } } }).mechanics.effect;
    expect(steps.type).toBe("sequence");
    expect(steps.steps.map((step) => step.modifier.stat)).toEqual(["psyker-level", "M"]);
  });

  it("refuses a psyker level in a values list under v5, which has no psyker-level value", () => {
    expect(() => setter({ subject: "this-model", values: [{ characteristic: "psyker-level", value: 2 }, { characteristic: "M", value: 7 }] }, 5)).toThrow();
  });

  it("emits a setter the ability schema accepts and the describer renders", () => {
    const text = "This model has psyker level 2.";
    const result = compileLeaves([leafAt(text, "has psyker level 2", { subject: "this-model", characteristic: "psyker-level", value: 2 })], text) as { ok: true; mechanics: Parameters<typeof entryWithMechanics>[1] };
    const checked = checkEntry(entryWithMechanics({ ability_id: "fabricated-setter", name: "Fabricated Setter", authored_by: "fabricated", game_version: { edition: "11th", dataslate: "fabricated" }, faction_id: "fabricated-faction", ability_type: "unit", unit_ids: [], source_digest: "0".repeat(64), version: "fabricated-v1" }, result.mechanics));
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
    expect(() => setter({ subject: "this-model", characteristic: "psyker-level", value: 2 }, 5)).toThrow();
  });
});
