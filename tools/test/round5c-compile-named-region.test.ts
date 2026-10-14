import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";

/**
 * named-region-state lowers directly to the canonical producer/consumer contract. These checks
 * assert the contract rather than comparing against legacy authored output.
 */
function leaf(parameters: Record<string, unknown>, familyVersion = 1): CompileLeaf {
  return { role: "EFFECT", family_id: "named-region-state", family_version: familyVersion, parameters, start_byte: 0 };
}

function compiled(parameters: Record<string, unknown>, familyVersion = 1) {
  const result = compileLeaves([leaf(parameters, familyVersion)]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

describe("Round 5C named-region-state compiler", () => {
  it("emits typed baseline/phase regions, direct unit-filter eligibility and ability-part branches", () => {
    const result = compiled({
      region_id: "flow-of-magic", owner_faction: "thousand-sons", behavior: "aura", membership_scope: "model",
      beneficiary_operator: "and", beneficiary_keywords: ["THOUSAND SONS"],
      default_branch: { kind: "reroll", roll: "wound", subset: "ones", weapon_keyword: "Psychic", optional: false },
      qualified_branch: { kind: "roll-modifier", roll: "wound", operation: "add", value: 1, weapon_keyword: "Psychic", optional: false },
    });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const modifier = result.mechanics.effect.modifier as Record<string, unknown>;
    const producer = modifier.producer as Record<string, unknown>;
    expect(producer.baseline).toEqual([{ region: { territory: "your-deployment-zone" }, duration: "permanent" }]);
    expect(producer.phase_extensions).toEqual([
      { region: { territory: "no-mans-land" }, condition: { type: "controls", parameters: { by: "friendly", objective: { territory: "no-mans-land" }, proportion: { comparison: "gte", fraction: 0.5 } } }, trigger: { event: "phase-started" }, duration: "phase", evaluation: "snapshot-once" },
      { region: { territory: "enemy-deployment-zone" }, condition: { type: "controls", parameters: { by: "friendly", objective: { territory: "enemy-territory" }, proportion: { comparison: "gte", fraction: 0.5 } } }, trigger: { event: "phase-started" }, duration: "phase", evaluation: "snapshot-once" },
    ]);
    const consumer = modifier.consumer as Record<string, unknown>;
    expect(consumer.eligibility).toEqual({ owner: "friendly", all_of: ["THOUSAND SONS"] });
    expect((consumer.default_branch as Record<string, unknown>).type).toBe("ability-part");
    expect((consumer.qualified_branch as Record<string, unknown>).type).toBe("ability-part");
    expect((consumer.default_branch as Record<string, unknown>).trigger).toBeUndefined();
    expect((consumer.qualified_branch as Record<string, unknown>).duration).toBeUndefined();
    expect(modifier.branch_precedence).toBe("qualified-replaces-default");
  });

  it("uses matches predicates for qualified keyword/visibility and a canonical proximity extension", () => {
    const result = compiled({
      region_id: "hallowed-ground", owner_faction: "grey-knights", behavior: "passive", membership_scope: "whole-unit",
      beneficiary_operator: "and", beneficiary_keywords: ["GREY KNIGHTS"],
      qualifies_by_keyword: "PURIFIER SQUAD", melee_or_visible_ranged: true,
      proximity_extension: { gate_ref: "purifier-sources", keywords: ["PURIFIER SQUAD"], radius_inches: 6 },
      default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
      qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: true },
    });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const modifier = result.mechanics.effect.modifier as Record<string, unknown>;
    const producer = modifier.producer as Record<string, unknown>;
    expect(producer.additive_extensions).toEqual([
      { kind: "unit-proximity", filter: { owner: "friendly", all_of: ["PURIFIER SQUAD"] }, range: { inches: 6 } },
    ]);
    expect(JSON.stringify((modifier.consumer as Record<string, unknown>).qualified_condition)).toContain("\"type\":\"matches\"");
    expect(JSON.stringify((modifier.consumer as Record<string, unknown>).attack_condition)).toContain("\"type\":\"matches\"");
  });
  it("accepts a widened reviewed recipe with changed region, fraction, and trigger", () => {
    const custom = [
      {
        region: { territory: "enemy-deployment-zone" },
        condition: { type: "controls", parameters: { by: "friendly", objective: { territory: "enemy-territory" }, proportion: { comparison: "gte", fraction: 0.75 } } },
        trigger: { event: "round-started" }, duration: "turn", evaluation: "snapshot-once",
      },
    ];
    const result = compiled({
      region_id: "custom-region", owner_faction: "custom-faction", behavior: "aura", membership_scope: "model",
      beneficiary_operator: "and", beneficiary_keywords: ["CUSTOM"],
      phase_extensions: custom,
      default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
      qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: false },
    }, 2);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const producer = (result.mechanics.effect.modifier as Record<string, unknown>).producer as Record<string, unknown>;
    expect(producer.phase_extensions).toEqual(custom);
  });
  it("refuses a named-region-state leaf that shares an ability with any other leaf", () => {
    const result = compileLeaves([
      leaf({
        region_id: "x", owner_faction: "y", behavior: "passive", membership_scope: "model",
        beneficiary_operator: "and", beneficiary_keywords: ["X"],
        default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
        qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: false },
      }),
      { role: "EFFECT", family_id: "fights-first", family_version: 2, parameters: { subject: "this-model" }, start_byte: 10 },
    ]);
    expect(result.ok).toBe(false);
  });
});
