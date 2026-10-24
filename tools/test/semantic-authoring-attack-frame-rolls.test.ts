import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

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

const reroll = (roll: string, weaponType = "all"): Record<string, unknown> => ({ roll, subset: "all", weapon_type: weaponType, count: 1 });
const FRIENDLY_VEHICLES: Array<[string, string, Record<string, unknown>]> = [
  ["Friendly ALPHA VEHICLE units", "unit-filter", { side: "friendly", keywords: ["ALPHA", "VEHICLE"] }],
  ["(excluding WALKER units)", "unit-filter", { side: "friendly", excluded_keywords: ["WALKER"] }],
];
const TEXT = "Friendly ALPHA VEHICLE units (excluding WALKER units) ranged attacks can: Re-roll one hit roll. Re-roll one wound roll.";

function compile(list: CompileLeaf[], text = TEXT) {
  return compileLeaves(list, text, {});
}

// "Friendly X units' ranged attacks can:" + two rolls. The attack-filter is the rolls' attack type.
describe("Semantic authoring attack-filter frame over subjectless rolls", () => {
  it("folds the attack type into each roll as its weapon scope and drops the frame", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(true);
    const steps = (result as { mechanics: { effect: { steps: Array<{ target: unknown; modifier: { roll: string; weapons?: { type?: string } } }> } } }).mechanics.effect.steps;
    expect(steps.map((step) => step.modifier.weapons?.type)).toEqual(["ranged", "ranged"]);
    expect(steps.map((step) => step.modifier.roll)).toEqual(["hit", "wound"]);
    // Each roll's recipient is the filter's units, exclusion included, not the attack's target.
    expect(steps[1]!.target).toEqual({ owner: "friendly", all_of: ["ALPHA", "VEHICLE"], none_of: ["WALKER"] });
    expect(JSON.stringify((result as { mechanics: unknown }).mechanics)).not.toContain("attack-filter");
  });

  it("keeps an explicit weapon_type that matches the attack type", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit", "ranged")],
      ["Re-roll one wound roll.", "reroll", reroll("wound", "all")]));
    expect(result.ok).toBe(true);
  });

  it("refuses a roll whose explicit weapon_type differs from the attack type", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound", "melee")]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/ranged attack-filter and a melee roll.*conflict/);
  });

  it("refuses a negated attack-filter", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged", negated: true }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/needs a select-unit or attack right before it/);
  });

  it("refuses a psychic attack-filter, which weapon_type cannot scope", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "psychic" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(false);
  });

  it("refuses an attack-filter that names more than its type", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged", weapon_keyword: "Torrent" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/needs a select-unit or attack right before it/);
  });

  it("refuses a frame followed by an effect that is not a subjectless roll", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", { ...reroll("hit"), subject: "this-unit" }]));
    expect(result.ok).toBe(false);
  });

  it("refuses a roll-auto-result, which has no weapon_type in the DSL, rather than dropping the frame", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "roll-auto-result", { roll: "hit", outcome: "auto-pass", count: 1 }]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/cannot scope a roll-auto-result effect/);
  });

  it("refuses an attack frame over a test roll", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/hit, wound or damage rolls only/);
  });
});
