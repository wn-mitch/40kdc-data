import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { orLineBreaks } from "../src/semantic-authoring/compile-placement.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

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

// "select one of the following:" then one option per line, the later ones opening with "Or:".
const TEXT = "When this unit is selected to shoot, select one of the following:\rThis unit's ranged attacks have [Lethal Hits].\rOr: Select one enemy unit within 18\" of this unit. That enemy unit has -1 to Hit rolls.";
const leaves = (text = TEXT): CompileLeaf[] => placed(text,
  ["When this unit is selected to shoot", "event", { kind: "selected-to-shoot" }],
  ["select one of the following", "choice-open", { choice_label: "one of the following", min_choices: 1, max_choices: 1 }],
  ["This unit's ranged attacks have", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
  ["Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
  ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
  ["within 18\" of this unit", "unit-position", { kind: "within", inches: 18, of: "this-unit", subject: "selected-unit", negated: false }],
  ["That enemy unit has -1 to Hit rolls", "roll-modifier", { roll: "hit", operation: "subtract", value: 1, subject: "selected-unit" }]);

/** The first choice node anywhere in the mechanics. */
function findChoice(node: unknown): { options: unknown[] } | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if ((node as Record<string, unknown>).type === "choice") return node as { options: unknown[] };
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findChoice(value);
    if (found) return found;
  }
  return undefined;
}

describe("a choice whose later options open lines with \"Or:\"", () => {
  it("marks only the leaf that opens an \"Or:\" line", () => {
    expect(orLineBreaks(leaves(), TEXT)).toEqual([false, false, false, false, true, false, false]);
  });

  it("keeps every sentence of an \"Or:\" option in that option, a selection included", () => {
    const result = compileLeaves(leaves(), TEXT);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const choice = findChoice(result.mechanics);
    // Two options: the keyword grant, and the selection with its penalty, not three sentence-options.
    expect(choice?.options).toHaveLength(2);
    expect(JSON.stringify(choice!.options[0])).not.toContain("select-units");
    expect(JSON.stringify(choice!.options[1])).toContain('"type":"select-units"');
  });

  it("refuses the same text without the \"Or:\" lines, where the selection would sit in a sentence-split option", () => {
    const plain = TEXT.replace("\rOr: ", " ");
    const result = compileLeaves(leaves(plain), plain);
    expect(result.ok ? "ok" : result.errors.join("; ")).toMatch(/no place inside it|needs/u);
  });
});
