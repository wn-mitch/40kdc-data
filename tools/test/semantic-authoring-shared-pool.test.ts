import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, items: Item[]) {
  return compileLeaves(placed(text, ...items), text, {});
}

const SLAM = "Each time this unit ends a Charge move, select one enemy unit engaged with this unit, then select one model in this unit engaged with that enemy unit. Roll as many D6 as the W of that model: for each 1, this unit suffers 1 mortal wound; for each 5+, that enemy unit suffers 1 mortal wound (up to 6 mortal wounds per unit).";
const slamItems = (roll: Record<string, unknown>, enemyEffect: Item = ["that enemy unit suffers 1 mortal wound (up to 6 mortal wounds per unit", "mortal-wounds", { recipient: "that-unit", count: "1", max: 6 }]): Item[] => [
  ["Each time this unit ends a Charge move", "event", { kind: "move-ended", move_types: ["charge"] }],
  ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false, bind_as: "foe" }],
  ["engaged with this unit", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-unit" }],
  ["select one", "select-unit", { scope: "friendly", distance: "any", visible: false, bind_as: "rammer" }],
  ["model in this unit", "unit-filter", { side: "friendly", level: "model", member_of: "this-unit" }],
  ["engaged with that enemy unit", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false, with: "selected-unit" }],
  ["Roll as many D6 as the W of that model", "dice-roll", roll],
  ["for each 1", "roll-result", { from: 1, to: 1 }],
  ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1", max: 6 }],
  ["for each 5+", "roll-result", { from: 5 }],
  enemyEffect,
];

describe("one pool of dice paying out to two units", () => {
  it("rolls once, as many dice as the selected model's characteristic, and counts each band's faces", () => {
    const result = compiled(SLAM, slamItems({ dice: "D6", count_stat: { stat: "W", of: "selected" } }));
    if (!result.ok) throw new Error(result.errors.join("; "));
    const outer = (result.mechanics as any).effect;
    expect(outer.selector.bind_as).toBe("foe");
    const inner = outer.effect;
    // The inner model must be engaged with the outer unit: the pair's candidate condition.
    expect(inner.selector).toMatchObject({ filter: { level: "model", member_of: "this-unit" }, bind_as: "rammer",
      eligibility: { type: "matches", parameters: { filter: { engaged_with: { selection_var: "foe" } } } } });
    // One roll step: neither effect rolls its own dice.
    expect(inner.effect).toEqual({
      type: "roll", dice: "D6", count_stat: { stat: "W", of: "selected-unit" }, roll_var: "pool",
      effect: { type: "sequence", steps: [
        { type: "mortal-wounds", target: "this-unit", modifier: { count: { roll_var: "pool", successes_on: 1, comparison: "lte" }, max: 6 } },
        { type: "mortal-wounds", target: { selection_var: "foe" }, modifier: { count: { roll_var: "pool", successes_on: 5 }, max: 6 } },
      ] },
    });
    const text = describeAbility({ id: "sample", name: "Sample", ...(result.mechanics as object) } as any);
    expect(text).toContain("Roll a number of D6 equal to the W characteristic of the selected unit");
    expect(text).toContain("the number of those dice that rolled a 1 (");
    expect(text).toContain("the number of those dice that rolled a 5+");
  });

  it("makes a fixed number of dice with two bands one pool too", () => {
    const result = compiled(SLAM, slamItems({ dice: "D6", count: 6 }));
    if (!result.ok) throw new Error(result.errors.join("; "));
    const roll = (result.mechanics as any).effect.effect.effect;
    expect(roll).toMatchObject({ type: "roll", dice: "6D6", roll_var: "pool" });
    expect(roll).not.toHaveProperty("count_stat");
  });

  it("refuses a pool whose band pays out an effect that is not mortal wounds", () => {
    const result = compiled(SLAM.replace("that enemy unit suffers 1 mortal wound", "that enemy unit is shaken"),
      slamItems({ dice: "D6", count_stat: { stat: "W", of: "selected" } }, ["that enemy unit is shaken (up to 6 mortal wounds per unit", "apply-mark", { subject: "antecedent", tag: "shaken" }]));
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/shared pool pays out only mortal wounds/u);
  });
});

describe("dice-roll count_stat", () => {
  const roll = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("dice-roll", parameters, currentFamilyVersion("dice-roll"));
  it("names a whole-number characteristic of a model, and no other count", () => {
    expect(roll({ dice: "D6", count_stat: { stat: "T", of: "selected" } })).toEqual({ dice: "D6", count_stat: { stat: "T", of: "selected" } });
    expect(() => roll({ dice: "D6", count: 3, count_stat: { stat: "T", of: "selected" } })).toThrow(/takes no count/u);
    expect(() => roll({ dice: "D6", count_stat: { stat: "Sv", of: "selected" } })).toThrow();
    expect(() => roll({ dice: "D6", count_stat: { stat: "T", of: "enemy" } })).toThrow();
  });
});
