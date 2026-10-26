import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording and keywords only; no GW rule prose.

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

const TEXT = "While this model is leading an **ALPHA** or **BETA** unit, add 1 to the Hit roll.";

function leaves(attachment: Record<string, unknown>, filter: Record<string, unknown>): CompileLeaf[] {
  return placed(TEXT,
    ["While this model is leading an", "leading-unit", { subject: "this-model", attachment: "leading", ...attachment }],
    ["ALPHA** or **BETA** unit", "unit-filter", { side: "friendly", ...filter }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  );
}

describe("a unit-filter naming the unit a Leader is leading", () => {
  it("becomes the attachment's `with`, keeping its keywords as alternatives", () => {
    const result = compileLeaves(leaves({}, { any_keywords: ["ALPHA", "BETA"] }), TEXT);
    expect(result.ok ? result.mechanics.effect : result.errors).toMatchObject({
      type: "conditional",
      condition: { type: "attachment", parameters: { subject: "this-model", role: "leading", with: { any_of: ["ALPHA", "BETA"] } } },
    });
  });

  it("keeps keywords the attachment leaf already requires alongside the filter's", () => {
    const result = compileLeaves(leaves({ attached_to_keywords: ["GAMMA"] }, { any_keywords: ["ALPHA", "BETA"] }), TEXT);
    expect(result.ok ? result.mechanics.effect : result.errors).toMatchObject({
      condition: { parameters: { with: { any_of: ["ALPHA", "BETA"], all_of: ["GAMMA"] } } },
    });
  });

  it("refuses a model-level filter, which cannot be the unit being led", () => {
    const result = compileLeaves(leaves({}, { any_keywords: ["ALPHA", "BETA"], level: "model" }), TEXT);
    expect(result.ok ? [] : result.errors).toEqual([expect.stringContaining("must name units, not models")]);
  });
});
