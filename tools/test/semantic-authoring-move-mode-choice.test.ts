import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "When this unit is selected to make a consolidation move, you can select any consolidation mode for that consolidation move, regardless of that consolidation move's Before Moving restrictions.";
const SELECTED: Item = ["When this unit is selected to make a consolidation move", "event", { kind: "selected", to: "move", move_types: ["consolidation"] }];
const CHOICE = "select any consolidation mode for that consolidation move, regardless of that consolidation move's Before Moving restrictions";

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-mode-choice", name: "Steady Advance" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

describe("move-mode-choice", () => {
  it("lowers to a move-modifier mode choice on the named move, waiving its Before Moving restrictions", () => {
    const mechanics = mechanicsOf(TEXT, SELECTED, ["you can", "optional-use", { who: "you" }],
      [CHOICE, "move-mode-choice", { subject: "this-unit", move_types: ["consolidation"], modes: "any", ignore_before_moving: true }]);
    expect(mechanics.effect).toEqual({ type: "move-modifier", target: "this-unit", modifier: { applies_to_moves: ["consolidation"], mode_choice: { modes: "any", ignore_before_moving: true } } });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(mechanics.effect), JSON.stringify(validate?.errors)).toBe(true);
    expect(describeAbility(mechanics as never)).toContain("can select any Consolidation mode for its Consolidation moves, ignoring that Consolidation move's Before Moving restrictions");
  });

  it("names the modes it lists, and leaves the waiver out when the wording has none", () => {
    const text = "When this unit is selected to make a consolidation move, you can select the objective consolidation mode for that consolidation move.";
    const mechanics = mechanicsOf(text, SELECTED, ["you can", "optional-use", { who: "you" }],
      ["select the objective consolidation mode for that consolidation move", "move-mode-choice", { subject: "this-unit", move_types: ["consolidation"], modes: ["objective"] }]);
    expect(mechanics.effect.modifier.mode_choice).toEqual({ modes: ["objective"] });
    expect(describeAbility(mechanics as never)).toContain("can select the objective Consolidation mode for its Consolidation moves.");
  });

  it("refuses a mode the move-mode vocabulary does not name, and a waiver other than true", () => {
    const version = currentFamilyVersion("move-mode-choice");
    expect(() => normalizeFingerprintParameters("move-mode-choice", { subject: "this-unit", move_types: ["consolidation"], modes: ["sideways"] }, version)).toThrow(/modes/u);
    expect(() => normalizeFingerprintParameters("move-mode-choice", { subject: "this-unit", move_types: ["consolidation"], modes: "any", ignore_before_moving: false }, version)).toThrow(/true or absent/u);
  });

  it("a move-modifier with only applies_to_moves keeps its old render", () => {
    const plain = describeAbility({ effect: { type: "move-modifier", target: "this-unit", modifier: { applies_to_moves: ["consolidation"], no_end_in_engagement: true } }, scope: { duration: "resolution" } } as never);
    expect(plain).toContain("cannot end a move within Engagement Range of any enemy unit, during its Consolidation moves");
  });
});
