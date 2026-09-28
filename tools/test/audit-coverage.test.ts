import { describe, expect, it } from "vitest";
import { computeCoverage, hasEmptyModifier, isStubEntry } from "../src/audit-coverage.js";

describe("computeCoverage", () => {
  it("classifies an offensive ability (+1 to hit) as offensive", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          {
            ability_id: "keen-eye",
            ability_type: "unit",
            effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
          },
        ],
      },
    ]);
    expect(r.totals.offensive).toBe(1);
    expect(r.totals.defensive).toBe(0);
    expect(r.totals.inert).toBe(0);
  });

  it("classifies a defensive ability (Feel No Pain) as defensive", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          {
            ability_id: "disgustingly-resilient",
            ability_type: "unit",
            effect: { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5 } },
          },
        ],
      },
    ]);
    expect(r.totals.defensive).toBe(1);
    expect(r.totals.offensive).toBe(0);
  });

  it("classifies a non-damage ability (a Deep Strike grant) as inert and histograms the reason", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          {
            ability_id: "teleport-strike",
            ability_type: "unit",
            effect: { type: "ability-grant", target: "this-unit", modifier: { ability: "deep-strike" } },
          },
        ],
      },
    ]);
    expect(r.totals.inert).toBe(1);
    expect(r.totals.offensive).toBe(0);
    expect(r.totals.defensive).toBe(0);
    expect(r.unsupportedReasons.some((u) => u.reason.includes("ability-grant"))).toBe(true);
  });

  it("flags GW-text leaks, stubs, and skipped-defensive from community_notes", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          {
            ability_id: "a",
            community_notes: "auto-generated stub — needs manual authoring. Original: While this model...",
            effect: { type: "ability-grant", target: "this-unit", modifier: { ability: "deep-strike" } },
          },
          {
            ability_id: "b",
            community_notes: "defensive ability (skipped for damage calc)",
            effect: { type: "damage-reduction", target: "this-unit", modifier: { reduction: 1 } },
          },
        ],
      },
    ]);
    expect(r.totals.gwTextLeak).toBe(1);
    expect(r.totals.stub).toBe(1);
    expect(r.totals.defensiveSkipped).toBe(1);
  });

  it("counts an unsupported reason once per ability, not once per phase", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [{ ability_id: "x", effect: { type: "cp-gain", target: "this-model", modifier: { amount: 1 } } }],
      },
    ]);
    const cpGain = r.unsupportedReasons.find((u) => u.reason.includes("cp-gain"));
    expect(cpGain?.count).toBe(1);
  });

  it("detects empty-modifier placeholder nodes structurally (incl. nested)", () => {
    expect(hasEmptyModifier({ type: "stat-modifier", target: "this-unit", modifier: {} })).toBe(true);
    expect(
      hasEmptyModifier({ type: "conditional", condition: { type: "phase-is", parameters: { phase: "fight" } }, effect: { type: "stat-modifier", target: "this-unit", modifier: {} } }),
    ).toBe(true);
    // move-modifier requires at least one property, so an empty one is a placeholder too
    expect(hasEmptyModifier({ type: "move-modifier", target: "this-unit", modifier: {} })).toBe(true);
    // parameterless flag effects are correct with an empty modifier — NOT stubs
    expect(hasEmptyModifier({ type: "end-attack-sequence", target: "defender", modifier: {} })).toBe(false);
    expect(hasEmptyModifier({ type: "objective-sticky", target: "this-unit", modifier: {} })).toBe(false);
    // a named grant is fully specified by its ability, not a stub
    expect(hasEmptyModifier({ type: "ability-grant", target: "this-unit", modifier: { ability: "fights-first" } })).toBe(false);
    // a fully-specified modifier is not a stub
    expect(hasEmptyModifier({ type: "roll-modifier", modifier: { roll: "hit", operation: "add", value: 1 } })).toBe(false);
    // a type that carries no modifier (e.g. a container) is not itself a stub
    expect(hasEmptyModifier({ type: "sequence", steps: [] })).toBe(false);
  });

  it("detects a seeded stub by its marker, and not an authored no-effect", () => {
    expect(isStubEntry({ stub: true, effect: { type: "no-effect" } })).toBe(true);
    expect(isStubEntry({ effect: { type: "no-effect" } })).toBe(false);
    // Older data without the marker is caught by its empty modifier.
    expect(isStubEntry({ effect: { type: "stat-modifier", target: "this-unit", modifier: {} } })).toBe(true);
    expect(isStubEntry({ effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "OC", operation: "add", value: 1 } } })).toBe(false);
    expect(isStubEntry(undefined)).toBe(false);
    const r = computeCoverage([{ faction: "test", abilities: [
      { ability_id: "seeded", stub: true, effect: { type: "no-effect" } },
      { ability_id: "army-selection", effect: { type: "no-effect" } },
    ] }]);
    expect(r.totals.stubStructural).toBe(1);
  });

  it("emits a named worklist entry per ability with shape + stub + gap", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          { ability_id: "ghost-step", name: "Ghost Step", effect: { type: "stat-modifier", target: "this-unit", modifier: {} } },
        ],
      },
    ]);
    expect(r.totals.stubStructural).toBe(1);
    expect(r.worklist).toHaveLength(1);
    const w = r.worklist[0];
    expect(w).toMatchObject({ faction: "test", ability_id: "ghost-step", name: "Ghost Step", shape: "stat-modifier", stub: true, offensive: false });
    expect(w.gap).toContain("stat-modifier");
  });

  it("aggregates totals across factions and sorts factions by name", () => {
    const r = computeCoverage([
      { faction: "zeta", abilities: [] },
      {
        faction: "alpha",
        abilities: [
          { ability_id: "a", effect: { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 6 } } },
        ],
      },
    ]);
    expect(r.factions.map((f) => f.faction)).toEqual(["alpha", "zeta"]);
    expect(r.totals.total).toBe(1);
    expect(r.totals.defensive).toBe(1);
  });
});
