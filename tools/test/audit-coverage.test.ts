import { describe, expect, it } from "vitest";
import { computeCoverage, hasEmptyModifier } from "../src/audit-coverage.js";

describe("computeCoverage", () => {
  it("classifies an offensive ability (+1 to hit) as offensive", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          {
            ability_id: "keen-eye",
            ability_type: "unit",
            effect: { type: "roll-modifier", target: "unit", modifier: { roll: "hit", operation: "add", value: 1 } },
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
            effect: { type: "feel-no-pain", target: "unit", modifier: { threshold: 5 } },
          },
        ],
      },
    ]);
    expect(r.totals.defensive).toBe(1);
    expect(r.totals.offensive).toBe(0);
  });

  it("classifies a non-damage ability (deep-strike) as inert and histograms the reason", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          {
            ability_id: "teleport-strike",
            ability_type: "unit",
            effect: { type: "deep-strike", target: "unit", modifier: {} },
          },
        ],
      },
    ]);
    expect(r.totals.inert).toBe(1);
    expect(r.totals.offensive).toBe(0);
    expect(r.totals.defensive).toBe(0);
    expect(r.unsupportedReasons.some((u) => u.reason.includes("deep-strike"))).toBe(true);
  });

  it("flags GW-text leaks, stubs, and skipped-defensive from community_notes", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          {
            ability_id: "a",
            community_notes: "auto-generated stub — needs manual authoring. Original: While this model...",
            effect: { type: "deep-strike", target: "unit", modifier: {} },
          },
          {
            ability_id: "b",
            community_notes: "defensive ability (skipped for damage calc)",
            effect: { type: "damage-reduction", target: "unit", modifier: { amount: 1 } },
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
        abilities: [{ ability_id: "x", effect: { type: "cp-gain", target: "self", modifier: { amount: 1 } } }],
      },
    ]);
    const cpGain = r.unsupportedReasons.find((u) => u.reason.includes("cp-gain"));
    expect(cpGain?.count).toBe(1);
  });

  it("detects empty-modifier placeholder nodes structurally (incl. nested)", () => {
    expect(hasEmptyModifier({ type: "stat-modifier", target: "unit", modifier: {} })).toBe(true);
    expect(hasEmptyModifier({ type: "conditional", condition: { type: "phase-is" }, effect: { type: "stat-modifier", modifier: {} } })).toBe(true);
    // parameterless flag effects are correct with an empty modifier — NOT stubs
    expect(hasEmptyModifier({ type: "deep-strike", target: "unit", modifier: {} })).toBe(false);
    expect(hasEmptyModifier({ type: "fight-first", target: "unit", modifier: {} })).toBe(false);
    // a fully-specified modifier is not a stub
    expect(hasEmptyModifier({ type: "roll-modifier", modifier: { roll: "hit", operation: "add", value: 1 } })).toBe(false);
    // a type that carries no modifier (e.g. a container) is not itself a stub
    expect(hasEmptyModifier({ type: "sequence", steps: [] })).toBe(false);
  });

  it("emits a named worklist entry per ability with shape + stub + gap", () => {
    const r = computeCoverage([
      {
        faction: "test",
        abilities: [
          { ability_id: "ghost-step", name: "Ghost Step", effect: { type: "stat-modifier", target: "unit", modifier: {} } },
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
          { ability_id: "a", effect: { type: "feel-no-pain", target: "unit", modifier: { threshold: 6 } } },
        ],
      },
    ]);
    expect(r.factions.map((f) => f.faction)).toEqual(["alpha", "zeta"]);
    expect(r.totals.total).toBe(1);
    expect(r.totals.defensive).toBe(1);
  });
});
