import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { describeEffect, type Effect } from "../src/translate/index.js";

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
const TACTICUS = ["Friendly Tacticus units'", "unit-filter", { side: "friendly", keywords: ["TACTICUS"] }] as const;
const TEXT = "Friendly Tacticus units' Rapid Fire attacks benefit from Rapid Fire when targeting units up to that attack's maximum range.";
const RANGE = (subject: string): Item => ["Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject, keyword: "Rapid Fire", within: "weapon" }];

describe("Round 5C weapon-ability-range: a weapon ability tested at full range", () => {
  it("binds the leading unit-filter's units as the effect's target, with no condition leaf", () => {
    const result = compileLeaves(placed(TEXT, TACTICUS, RANGE("antecedent")), TEXT, {});
    expect(result.ok).toBe(true);
    expect(result.ok && result.mechanics.effect).toEqual({
      type: "weapon-ability-range",
      target: { owner: "friendly", all_of: ["TACTICUS"] },
      modifier: { keyword: "Rapid Fire", within: "weapon" },
    });
  });

  it("lowers a this-unit subject to the effect node with the keyword and the weapon range", () => {
    const text = "This unit's Rapid Fire attacks benefit from Rapid Fire.";
    const result = compileLeaves(placed(text, ["Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "weapon" }]), text, {});
    expect(result.ok).toBe(true);
    expect(result.ok && result.mechanics.effect).toMatchObject({ type: "weapon-ability-range", target: "this-unit", modifier: { keyword: "Rapid Fire", within: "weapon" } });
  });

  it("describes the benefit against the weapon's full range", () => {
    const effect = { type: "weapon-ability-range", target: "this-unit", modifier: { keyword: "Rapid Fire", within: "weapon" } } as unknown as Effect;
    expect(describeEffect(effect)).toBe("The unit's attacks benefit from [RAPID FIRE] when the target is within the weapon's range.");
  });

  it("refuses an antecedent subject with no earlier unit-filter or selection, rather than defaulting to this unit", () => {
    const text = "Rapid Fire attacks benefit from Rapid Fire.";
    const result = compileLeaves(placed(text, ["Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject: "antecedent", keyword: "Rapid Fire", within: "weapon" }]), text, {});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/no earlier unit-filter or selection/u);
  });

  it("keeps a weapon-ability-range effect in a lasting window, so a used ability's phase bounds it", () => {
    const text = "In your Shooting phase, this unit's Rapid Fire attacks benefit from Rapid Fire.";
    const lasting = compileLeaves(placed(text,
      ["In your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["this unit's Rapid Fire attacks benefit from Rapid Fire", "weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "weapon" }],
    ), text, {});
    expect(lasting.ok, lasting.ok ? "" : lasting.errors.join("; ")).toBe(true);
    expect(JSON.stringify(lasting.ok && lasting.mechanics)).toContain('"duration":"phase"');
  });

  it("refuses a keyword other than Rapid Fire", () => {
    expect(() => normalize("weapon-ability-range", { subject: "this-unit", keyword: "Melta", within: "weapon" })).toThrow(/keyword must be one of Rapid Fire/u);
  });

  it("refuses a range other than the full weapon range", () => {
    expect(() => normalize("weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "half-weapon" })).toThrow(/within must be one of weapon/u);
  });

  it("refuses a parameter the family does not declare", () => {
    expect(() => normalize("weapon-ability-range", { subject: "this-unit", keyword: "Rapid Fire", within: "weapon", extra: 1 })).toThrow();
  });
});
