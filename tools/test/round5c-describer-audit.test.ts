import { describe, expect, it } from "vitest";

import { describerGaps, leafDescriberAudit } from "../src/round5c/leaf-describer-audit.js";

describe("Round 5C leaf describer audit", () => {
  it("labels high-dimensional reports as pairwise samples", () => {
    const audit = leafDescriberAudit();
    const unitFilter = audit.find((family) => family.family_id === "unit-filter");
    const unitPosition = audit.find((family) => family.family_id === "unit-position");

    expect(unitFilter).toMatchObject({ sampling: "pairwise" });
    expect(unitPosition).toMatchObject({ sampling: "pairwise" });
    expect(unitFilter!.combinations).toBeGreaterThan(0);
    expect(unitPosition!.combinations).toBeGreaterThan(0);
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
