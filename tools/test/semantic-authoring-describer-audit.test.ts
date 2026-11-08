import { describe, expect, it } from "vitest";

import { describerGaps, leafDescriberAudit } from "../src/semantic-authoring/leaf-describer-audit.js";

describe("Semantic authoring leaf describer audit", () => {
  it("labels high-dimensional reports as pairwise samples", () => {
    const audit = leafDescriberAudit();
    const unitFilter = audit.find((family) => family.family_id === "unit-filter");
    const unitPosition = audit.find((family) => family.family_id === "unit-position");

    expect(unitFilter).toMatchObject({ sampling: "pairwise" });
    expect(unitPosition).toMatchObject({ sampling: "pairwise" });
    expect(unitFilter!.combinations).toBeGreaterThan(0);
    expect(unitPosition!.combinations).toBeGreaterThan(0);
  });

  it("keeps representative problem and collision identities visible", () => {
    const reports = leafDescriberAudit();
    const report = (familyId: string) => reports.find((family) => family.family_id === familyId)!;

    // Context-only leaves are expected problems when previewed alone. Pin their semantic inputs,
    // not compiler wording or the number of other sampled problems.
    expect(report("history-window").problems.map((problem) => problem.parameters))
      .toContainEqual({ window: "phase" });
    expect(report("move-passthrough-used").problems.map((problem) => problem.parameters))
      .toContainEqual({ passthrough: "tall-terrain" });

    // These values are known to collapse in representative shared contexts. The collision identity
    // is the family, parameter and value pair; rendered English is intentionally not a snapshot.
    expect(report("characteristic-modifier").collisions.some((collision) => collision.parameter === "subject"
      && collision.values.includes("this-unit") && collision.values.includes("attack"))).toBe(true);
    expect(report("ignore-modifiers").collisions.some((collision) => collision.parameter === "rolls"
      && collision.values.some((value) => Array.isArray(value) && value.includes("any"))
      && collision.values.some((value) => Array.isArray(value) && value.includes("all")))).toBe(true);
  });

  it("names concrete hidden values for the Leaves page", () => {
    expect(describerGaps("reroll", { roll: "hit", subset: "failed" })).toEqual([]);
    expect(describerGaps("characteristic-modifier", {
      subject: "attack",
      characteristics: ["M"],
      operation: "add",
      value: 1,
      weapon_type: "all",
    })).toContain("The English reads the same for subject \"this-unit\" and \"attack\".");
    expect(describerGaps("attack", { direction: "makes", unit: "this-model", attack_type: "melee" })).toEqual([
      "The English never shows direction.",
      "The English never shows unit.",
    ]);
  });
});
