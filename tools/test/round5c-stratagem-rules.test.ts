import { describe, expect, it } from "vitest";
import { assertKnownKeywords } from "../src/round5c/core-keywords.js";
import { rewriteStratagemSpan, stratagemWhenWindow } from "../src/round5c/stratagem-rules.js";

// Fabricated fixture phrasing only.
describe("Round 5C Stratagem conventions", () => {
  it("reads a WHEN line that names only a phase as a use window, and nothing longer", () => {
    expect(stratagemWhenWindow("End of the Fight phase.")).toEqual({ your_phases: [], opponent_phases: [], either_phases: ["fight"] });
    expect(stratagemWhenWindow("Your opponent's Shooting phase.")).toEqual({ your_phases: [], opponent_phases: ["shooting"], either_phases: [] });
    expect(stratagemWhenWindow("Your Command phase.")).toEqual({ your_phases: ["command"], opponent_phases: [], either_phases: [] });
    // A trigger in the WHEN line is not a bare window.
    expect(stratagemWhenWindow("Your opponent's Shooting phase, just after an enemy unit has selected its targets.")).toBeNull();
  });

  it("makes a Stratagem's \"your unit\" its target unless the text selects a unit, and leaves other abilities alone", () => {
    const span = { status: "EXISTING", role: "EFFECT", family_id: "make-move", family_version: 2, parameters: { subject: "selected-unit", move_type: "fall-back" } };
    const context = { sourceType: "stratagem", fragment: "EFFECT", exactText: "Your unit can make a Fall Back move", abilitySelects: false };
    expect(rewriteStratagemSpan(span, context).span.parameters).toEqual({ subject: "this-unit", move_type: "fall-back" });
    expect(rewriteStratagemSpan(span, { ...context, abilitySelects: true }).rewrites).toEqual([]);
    expect(rewriteStratagemSpan(span, { ...context, sourceType: "unit" }).span).toBe(span);
  });

  it("accepts a keyword phrase that splits into keywords units carry, and refuses one that does not", () => {
    const index = new Map([["ADEPTUS ASTARTES", "Adeptus Astartes"], ["INFANTRY", "Infantry"]]);
    expect(() => assertKnownKeywords("stratagem-target", { keywords: ["ADEPTUS ASTARTES INFANTRY"], excluded_keywords: [] }, index)).not.toThrow();
    expect(() => assertKnownKeywords("stratagem-target", { keywords: ["ADEPTUS ASTARTES BIKERS"], excluded_keywords: [] }, index)).toThrow(/BIKERS/u);
  });
});
