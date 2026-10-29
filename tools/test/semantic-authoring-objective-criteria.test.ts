import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

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

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-last-stand", name: "Last Stand" });

const TEXT = "Each time this unit is destroyed, select one objective that: your unit was controlling when it was destroyed. Has no enemy units (excluding SPRITE units) within range of it. That objective is secured.";
const DESTROYED: Item = ["Each time this unit is destroyed", "event", { kind: "unit-destroyed" }];
const SELECT: Item = ["select one objective", "select-objective-open", { bind_as: "objective", count: 1 }];
const CONTROLLED: Item = ["that: your unit was controlling when it was destroyed", "objective-criterion", { criterion: "controlled-by-unit", unit: "this-unit" }];
const CLEAR: Item = ["Has no enemy units (excluding SPRITE units) within range of it", "objective-criterion", { criterion: "clear-of", side: "enemy", excluded_keywords: ["SPRITE"] }];
const SECURED: Item = ["objective is secured", "sticky-objective", { subject: "selected-objective" }];

describe("objective criteria on a select-objective", () => {
  it("fold into the selector's filter, and the secured marker is the selected one", () => {
    const result = run(TEXT, DESTROYED, SELECT, CONTROLLED, CLEAR, SECURED);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect).toMatchObject({ type: "select-objective", selector: { filter: { controlled_by_unit: "this-unit", clear_of: { owner: "enemy", none_of: ["SPRITE"] } }, bind_as: "objective" } });
    expect(effect.effect).toEqual({ type: "objective-sticky", target: "this-unit", modifier: { objective: { selection_var: "objective" } } });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("refuses a criterion with no objective selection before it, and two criteria of one kind", () => {
    const lone = run("Each time this unit is destroyed, that: your unit was controlling when it was destroyed.", DESTROYED, CONTROLLED);
    expect(lone.ok ? "" : lone.errors.join(" ")).toContain("select-objective-open right before it");
    const twice = "Each time this unit is destroyed, select one objective that: your unit was controlling when it was destroyed, that: your unit was controlling when it was destroyed. That objective is secured.";
    const doubled = run(twice, DESTROYED, SELECT, CONTROLLED, CONTROLLED, SECURED);
    expect(doubled.ok ? "" : doubled.errors.join(" ")).toContain("takes one controlled-by-unit criterion");
  });
});
