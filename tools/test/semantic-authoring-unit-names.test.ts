import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

const UNIT_NAMES = ["Alpha Scouts", "Beta Walkers"];
const UNITS = [
  { id: "beta-walkers", name: "Beta Walkers" },
  { id: "alpha-scouts", name: "Alpha Scouts" },
];
const UNIT_IDS = ["alpha-scouts", "beta-walkers"];

function leaf(family: string, parameters: Record<string, unknown>, fragment: string, index: number): CompileLeaf {
  const version = currentFamilyVersion(family);
  return {
    role: familyRole(family, version),
    family_id: family,
    family_version: version,
    parameters,
    start_byte: index * 10,
    end_byte: index * 10 + 5,
    fragment,
  };
}

function abilityLeaves(names: string[] = UNIT_NAMES, narrowing: Record<string, unknown>[] = []): CompileLeaf[] {
  return [
    leaf("use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN", 0),
    leaf("unit-filter", { side: "enemy" }, "WHEN", 1),
    leaf("event", { kind: "enemy-selected-targets" }, "WHEN", 2),
    leaf("unit-filter", { side: "friendly", unit_names: names }, "WHEN", 3),
    ...narrowing.map((parameters, index) => leaf("unit-filter", parameters, "WHEN", 4 + index)),
    leaf("triggering-target", { selects: "unit", keywords: [], match: "all", unit_names: UNIT_NAMES }, "TARGET", 4 + narrowing.length),
    leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }, "EFFECT", 5 + narrowing.length),
  ];
}

function compileWith(units: Array<{ id: string; name: string }>, leaves = abilityLeaves()) {
  return compileLeaves(leaves, undefined, { units: { faction_id: "example-faction", units } });
}

describe("Semantic authoring exact unit identities", () => {
  it("resolves reviewed own-faction names to stable IDs in the trigger and core target eligibility", () => {
    const result = compileWith(UNITS);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;

    expect(result.mechanics.trigger).toMatchObject({
      subject: { owner: "enemy" },
      object: { owner: "friendly", level: "unit", unit_ids: UNIT_IDS },
    });
    expect(result.core?.target_restrictions).toMatchObject({
      count: "one",
      selects: "unit",
      bound_to: "attacked-unit",
      eligibility: {
        type: "matches",
        parameters: { subject: "this-unit", filter: { level: "unit", unit_ids: UNIT_IDS } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("ALPHA SCOUTS");
    expect(JSON.stringify(result)).not.toContain("BETA WALKERS");
  });

  it("retains exact identities through stacked narrowing and intersects two identity filters", () => {
    const result = compileWith(UNITS, abilityLeaves(UNIT_NAMES, [
      { side: "friendly", unit_names: ["Alpha Scouts"] },
      { side: "friendly", excluded_keywords: ["EXAMPLE"] },
    ]));
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;

    expect(result.mechanics.trigger).toMatchObject({
      object: { owner: "friendly", level: "unit", unit_ids: ["alpha-scouts"], none_of: ["EXAMPLE"] },
    });
  });

  it("refuses stacked filters whose exact unit identities are disjoint", () => {
    const result = compileWith(UNITS, abilityLeaves(["Alpha Scouts"], [
      { side: "friendly", unit_names: ["Beta Walkers"] },
    ]));
    expect(result.ok ? "" : result.errors.join("; ")).toMatch(/stacked unit-filters name disjoint unit identities/iu);
  });

  it("normalizes exact names without treating them as model profiles", () => {
    expect(normalizeFingerprintParameters("unit-filter", { side: "friendly", unit_names: [" Beta   Walkers ", "**Alpha Scouts**"] }, currentFamilyVersion("unit-filter")))
      .toEqual({ side: "friendly", unit_names: UNIT_NAMES });
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", level: "model", unit_names: UNIT_NAMES }, currentFamilyVersion("unit-filter")))
      .toThrow(/identifies units, not models/u);
  });

  it("fails closed when an own-faction name is missing or ambiguous", () => {
    const missing = compileWith([UNITS[0]!]);
    expect(missing.ok ? "" : missing.errors.join("; ")).toMatch(/Alpha Scouts.*0 datasheets/u);

    const ambiguous = compileWith([...UNITS, { id: "alpha-scouts-alt", name: "Alpha Scouts" }]);
    expect(ambiguous.ok ? "" : ambiguous.errors.join("; ")).toMatch(/Alpha Scouts.*2 datasheets/u);
  });
});
