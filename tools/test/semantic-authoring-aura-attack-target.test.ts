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

const text = (side: string) => `While an ${side} unit is within 6" of this unit, each time a friendly **SAMPLE** unit makes an attack that targets that ${side} unit, add 1 to the Hit roll.`;
const items = (side: string): Item[] => [
  [`${side} unit`, "unit-filter", { side }],
  ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
  ["friendly **SAMPLE** unit", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }],
  [`makes an attack that targets that ${side} unit`, "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }],
  ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
];

function compiled(side: string, edit: (leaves: CompileLeaf[]) => CompileLeaf[] = (leaves) => leaves) {
  const source = text(side);
  return compileLeaves(edit(placed(source, ...items(side))), source, {});
}

describe("an attack that targets the enemy unit an aura reaches", () => {
  it("keeps the aura and gates its effect on the attack's target being the aura's unit", () => {
    const result = compiled("enemy");
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as any;
    expect(mechanics.behavior).toBe("aura");
    expect(mechanics.effect).toMatchObject({ type: "aura", target: "enemy-within-aura", modifier: { range: { inches: 6 }, of: "this-unit", eligible: { owner: "enemy" } } });
    expect(mechanics.effect.modifier.effect).toEqual({
      type: "conditional",
      condition: { type: "same-unit", parameters: { subject: "defender", as: "recipient" } },
      effect: { type: "roll-modifier", target: { owner: "friendly", all_of: ["SAMPLE"] }, modifier: { roll: "hit", operation: "add", value: 1 } },
    });
    expect(describeAbility({ id: "sample", name: "Sample", ...mechanics })).toContain("if the attack targets that unit, all friendly SAMPLE units get +1 to Hit rolls");
  });

  it("refuses a friendly aura, whose unit is not the enemy an attack targets", () => {
    const result = compiled("friendly");
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/no designation or selection before it names the unit/u);
  });

  it("refuses an aura printed in another fragment, which is not the attack's sentence", () => {
    const result = compiled("enemy", (leaves) => leaves.map((leaf) => leaf.family_id === "aura-range" || leaf.family_id === "unit-filter" && leaf.parameters.side === "enemy" ? { ...leaf, fragment: "OTHER" } : leaf));
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/no designation or selection before it names the unit/u);
  });
});
