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

const position = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("unit-position", parameters, currentFamilyVersion("unit-position"));

const text = (exclusion: string, distance: string) =>
  `At the end of your opponent’s Fight phase, select one visible enemy model (${exclusion}) within 24" of this unit, and roll one D6 for each enemy unit ${distance} of that model: For each 4+, that unit suffers D3 mortal wounds.`;

function items(exclusion: Item, distance: Item): Item[] {
  return [
    ["At the end of your opponent’s Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "opponent" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["visible enemy model", "unit-filter", { side: "enemy", visible: true, level: "model" }],
    exclusion,
    ["within 24\" of this unit", "unit-position", { kind: "within", inches: 24, of: "this-unit", subject: "selected-unit", negated: false }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["for each", "for-each-unit-select", {}],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    distance,
    ["For each 4+", "roll-result", { from: 4 }],
    ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
  ];
}

const LONE: Item = ["excluding Sample Loner units", "unit-filter", { side: "enemy", excluded_abilities: ["lone-operative"] }];
const ROLLED: Item = ["within D6\"", "unit-position", { kind: "within", rolled_inches: "D6", of: "selected-unit", subject: "antecedent", negated: false }];

function compiled(exclusion: Item, distance: Item) {
  const source = text(exclusion[0], distance[0]);
  return compileLeaves(placed(source, ...items(exclusion, distance)), source, {});
}

describe("a selection, then a loop over the units near it", () => {
  it("runs the loop inside the selection, over units within a rolled distance of the selected model", () => {
    const result = compiled(LONE, ROLLED);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const select = (result.mechanics as any).effect;
    expect(select.type).toBe("select-units");
    // The ability exclusion narrows the model selection, as every model of such a unit has the ability.
    expect(select.selector.filter).toMatchObject({ owner: "enemy", level: "model", lacks_ability: ["lone-operative"] });
    expect(select.effect).toMatchObject({
      type: "for-each-unit",
      selector: { filter: { owner: "enemy", within: { range: { dice: "D6" }, of: "selected-unit" } } },
      effect: { type: "dice-gated", threshold: 4, on_success: { type: "mortal-wounds", target: "recipient" } },
    });
    expect(describeAbility({ id: "sample", name: "Sample", ...(result.mechanics as object) } as any)).toContain("For each enemy unit within D6\" of the selected unit");
  });

  it("keeps a fixed distance as inches", () => {
    const result = compiled(LONE, ["within 3\"", "unit-position", { kind: "within", inches: 3, of: "selected-unit", subject: "antecedent", negated: false }]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics as any).effect.effect.selector.filter.within).toEqual({ range: { inches: 3 }, of: "selected-unit" });
  });

  it("refuses a keyword exclusion of units on a model selection, which a model can escape", () => {
    const result = compiled(["excluding SAMPLE units", "unit-filter", { side: "enemy", excluded_keywords: ["SAMPLE"] }], ROLLED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/cannot narrow the select-unit's filter/u);
  });

  it("refuses a loop distance read at the start of a move, rather than reading it as the position now", () => {
    // A move-ended moment, so the record-level start-of-move check passes and the loop's own fold decides.
    const moved = "Each time this unit ends a Normal move";
    const distance: Item = ["within 6\"", "unit-position", { kind: "within", inches: 6, of: "selected-unit", subject: "antecedent", negated: false, at: "move-start" }];
    const source = text(LONE[0], distance[0]).replace("At the end of your opponent’s Fight phase", moved);
    const list = items(LONE, distance);
    list[0] = [moved, "event", { kind: "move-ended", move_types: ["normal"] }];
    const result = compileLeaves(placed(source, ...list), source, {});
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/distance read at the start of a move has no quantifier shape/u);
  });
});

describe("unit-position rolled_inches", () => {
  it("takes a dice roll in place of inches, and not both", () => {
    expect(position({ kind: "within", rolled_inches: "D6", of: "this-unit", subject: "antecedent", negated: false })).toMatchObject({ rolled_inches: "D6" });
    expect(position({ kind: "within", rolled_inches: "D6", of: "this-unit", subject: "antecedent", negated: false })).not.toHaveProperty("inches");
    expect(() => position({ kind: "within", rolled_inches: "D6", inches: 6, of: "this-unit", subject: "antecedent", negated: false })).toThrow(/cannot combine with inches/u);
    expect(() => position({ kind: "within", rolled_inches: "six", of: "this-unit", subject: "antecedent", negated: false })).toThrow(/dice roll/u);
  });
});
