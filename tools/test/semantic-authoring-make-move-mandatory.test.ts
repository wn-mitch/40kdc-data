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

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-forced-march", name: "Forced March" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const MOVE = { subject: "this-unit", move_type: "normal", distance: 6 };

describe("make-move mandatory", () => {
  it("keeps mandatory true, folds false into the absent form, and refuses anything that is not a boolean", () => {
    const version = currentFamilyVersion("make-move");
    expect(normalizeFingerprintParameters("make-move", { ...MOVE, mandatory: true }, version)).toEqual({ ...MOVE, mandatory: true });
    expect(normalizeFingerprintParameters("make-move", { ...MOVE, mandatory: false }, version)).toEqual(MOVE);
    for (const bad of ["true", 1, null]) {
      expect(() => normalizeFingerprintParameters("make-move", { ...MOVE, mandatory: bad }, version)).toThrow(/make-move\.mandatory/u);
    }
  });

  it("lowers a mandatory move to a move effect that must be made, which validates and renders as must", () => {
    const text = "This unit must make a normal move of up to 6 inches.";
    const mechanics = mechanicsOf(text, ["make a normal move of up to 6 inches", "make-move", { ...MOVE, mandatory: true }]);
    expect(mechanics.effect).toEqual({ type: "move", target: "this-unit", modifier: { move_type: "normal", distance: 6, mandatory: true } });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(mechanics.effect), JSON.stringify(validate?.errors)).toBe(true);
    expect(describeAbility(mechanics as never)).toContain("must make a Normal move of up to 6\"");
  });

  it("lowers an optional move with no mandatory key, rendering as can", () => {
    const text = "This unit can make a normal move of up to 6 inches.";
    const mechanics = mechanicsOf(text, ["make a normal move of up to 6 inches", "make-move", MOVE]);
    expect(mechanics.effect.modifier).not.toHaveProperty("mandatory");
    expect(describeAbility(mechanics as never)).toContain("can make a Normal move of up to 6\"");
  });

  it("refuses mandatory false in the DSL: an optional move leaves the key out", () => {
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.({ type: "move", target: "this-unit", modifier: { move_type: "ingress", mandatory: false } })).toBe(false);
  });
});
