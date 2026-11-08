import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { objectiveMatches } from "../src/cruncher/unit-filter.js";

describe("objective territory in the cruncher", () => {
  it("matches a territory the scenario models", () => {
    expect(objectiveMatches({ territory: "enemy-territory" }, { territory: "target" }, "attacker")).toBe(true);
    expect(objectiveMatches({ territory: "your-territory" }, { territory: "target" }, "attacker")).toBe(false);
  });

  it("leaves a deployment zone unknown: an objective's territory is not its deployment zone", () => {
    // An objective in the opponent's territory need not be in the opponent's deployment zone.
    expect(objectiveMatches({ territory: "enemy-deployment-zone" }, { territory: "target" }, "attacker")).toBe("unknown");
    expect(objectiveMatches({ territory: "your-deployment-zone" }, { territory: "attacker" }, "attacker")).toBe("unknown");
  });

  it("leaves a unit's control at the trigger and a marker clear of units unknown: the scenario models neither", () => {
    expect(objectiveMatches({ controlled_by_unit: "this-unit" }, { controller: "attacker" }, "attacker")).toBe("unknown");
    expect(objectiveMatches({ clear_of: { owner: "enemy" } }, { controller: "attacker" }, "attacker")).toBe("unknown");
  });
});

describe("a producer-only named-region-state in the cruncher", () => {
  it("is an unsupported region declaration, not a missing default branch", () => {
    const effect = { type: "named-region-state", target: { owner: "friendly" }, modifier: {
      region_ref: { region_id: "the-fabled-glade", owner_faction: "example-faction" },
      producer: { region_ref: { region_id: "the-fabled-glade", owner_faction: "example-faction" }, mode: "complete", parent_ref: null, baseline: [], phase_extensions: [], additive_extensions: [] },
    } };
    const result = effectToBuffs(effect, { kind: "ability", abilityId: "x", abilityKind: "unit" }, { phase: "shooting" });
    expect(result.applied).toEqual([]);
    expect(result.unsupported.map((item) => item.reason)).toEqual(["named-region-state without a consumer declares a region only; it is not modelled by the buff layer"]);
  });
});
