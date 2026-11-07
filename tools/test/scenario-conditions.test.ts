import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../src/cruncher/index.js";

const unit: BuffSource = { kind: "ability", abilityId: "fabricated-scenario", abilityKind: "unit" };
const plusHit = (condition: unknown) => ({
  type: "conditional",
  condition,
  effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
});
/** "applied", "dropped" or "unknown" for the +1 Hit gated on `condition`. */
function outcome(condition: unknown, context: Partial<EngineContext>, source: BuffSource = unit, perspective: "attacker" | "target" = "attacker"): string {
  const result = effectToBuffs(plusHit(condition), source, { phase: "shooting", ...context }, perspective);
  if (result.applied.length > 0) return "applied";
  return result.unsupported.length > 0 ? "unknown" : "dropped";
}

describe("rule-active", () => {
  const doctrine = { type: "rule-active", parameters: { rule: { ability_id: "combat-doctrines-example", option_id: "assault-doctrine" } } };
  const rule = { type: "rule-active", parameters: { rule: "example-army-rule" } };

  it("matches a stance option exactly and a rule id by itself or any of its options", () => {
    expect(outcome(doctrine, { activeRules: [{ ability_id: "combat-doctrines-example", option_id: "assault-doctrine" }] })).toBe("applied");
    expect(outcome(doctrine, { activeRules: [{ ability_id: "combat-doctrines-example", option_id: "tactical-doctrine" }] })).toBe("dropped");
    expect(outcome(doctrine, { activeRules: ["combat-doctrines-example"] })).toBe("dropped");
    expect(outcome(rule, { activeRules: ["example-army-rule"] })).toBe("applied");
    expect(outcome(rule, { activeRules: [{ ability_id: "example-army-rule", definition_id: "one" }] })).toBe("applied");
    expect(outcome(rule, { activeRules: [] })).toBe("dropped");
    expect(outcome(rule, {})).toBe("unknown");
  });
});

describe("in-region", () => {
  const flow = { type: "in-region", parameters: { subject: "this-unit", region: { rule_region: { owner_faction: "example", region_id: "flow-of-magic" } } } };
  const yourZone = { type: "in-region", parameters: { region: { territory: "your-deployment-zone" } } };
  const whollyTerrain = { type: "in-region", parameters: { subject: "this-unit", models: "every", region: { terrain_area: {} } } };

  it("reads a rule region, a deployment zone from the ability's side, and wholly-within", () => {
    expect(outcome(flow, { attackerRegions: [{ ruleRegion: "flow-of-magic" }] })).toBe("applied");
    expect(outcome(flow, { attackerRegions: [{ ruleRegion: "hallowed-ground" }] })).toBe("dropped");
    expect(outcome(flow, {})).toBe("unknown");
    expect(outcome(yourZone, { attackerRegions: [{ deploymentZone: "attacker" }] })).toBe("applied");
    expect(outcome(yourZone, { attackerRegions: [{ deploymentZone: "target" }] })).toBe("dropped");
    expect(outcome(whollyTerrain, { attackerRegions: [{ terrainArea: true }] })).toBe("dropped");
    expect(outcome(whollyTerrain, { attackerRegions: [{ terrainArea: true, wholly: true }] })).toBe("applied");
  });

  it("reads 'your' territory as the defender's own for a defensive rule", () => {
    const yours = { type: "in-region", parameters: { region: { territory: "your-territory" } } };
    const save = { type: "conditional", condition: yours, effect: { type: "roll-modifier", target: "attacker", modifier: { roll: "hit", operation: "subtract", value: 1 } } };
    const run = (regions: EngineContext["targetRegions"]) => effectToBuffs(save, unit, { phase: "shooting", targetRegions: regions }, "target").applied.length;
    expect(run([{ territory: "target" }])).toBe(1);
    expect(run([{ territory: "attacker" }])).toBe(0);
  });
});

describe("controls", () => {
  const half = { type: "controls", parameters: { by: "friendly", proportion: { comparison: "gte", fraction: 0.5 } } };
  const more = { type: "controls", parameters: { compare: { owner: "enemy", comparison: "gt" } } };
  const any = { type: "controls", parameters: { count: { min: 1 } } };

  it("counts the ability side's objectives against bounds, the other side and the total", () => {
    expect(outcome(half, { objectivesControlled: { attacker: 3, target: 1, total: 6 } })).toBe("applied");
    expect(outcome(half, { objectivesControlled: { attacker: 2, target: 1, total: 6 } })).toBe("dropped");
    expect(outcome(more, { objectivesControlled: { attacker: 2, target: 2, total: 5 } })).toBe("dropped");
    expect(outcome(more, { objectivesControlled: { attacker: 3, target: 2, total: 5 } })).toBe("applied");
    expect(outcome(any, { objectivesControlled: { attacker: 0, target: 4, total: 5 } })).toBe("dropped");
    expect(outcome(any, {})).toBe("unknown");
    // For a defensive rule, "friendly" is the defender's side.
    expect(outcome(half, { objectivesControlled: { attacker: 3, target: 1, total: 6 } }, unit, "target")).toBe("dropped");
  });
});

describe("attachment with a unit filter", () => {
  const leadingScorpions = { type: "attachment", parameters: { role: "leading", subject: "this-model", with: { all_of: ["STRIKING SCORPIONS"] } } };
  const ledByCharacter = { type: "attachment", parameters: { role: "led", with: { all_of: ["CHARACTER"] } } };
  const members = (bodyguard: string[]): EngineContext["attackerMembers"] => [
    { unitId: "exarch", role: "leader", keywords: ["CHARACTER", "ASPECT WARRIORS"] },
    { unitId: "squad", role: "bodyguard", keywords: bodyguard },
  ];
  const attached: BuffSource = { kind: "ability", abilityId: "fabricated-scenario", abilityKind: "attached", sourceUnitId: "exarch" };

  it("checks the bodyguard a leader leads and the leader a bodyguard is led by", () => {
    expect(outcome(leadingScorpions, { attackerMembers: members(["STRIKING SCORPIONS", "INFANTRY"]) }, attached)).toBe("applied");
    expect(outcome(leadingScorpions, { attackerMembers: members(["HOWLING BANSHEES", "INFANTRY"]) }, attached)).toBe("dropped");
    expect(outcome(leadingScorpions, { attackerAttached: true, attachmentRoles: { exarch: "leader" } }, attached)).toBe("unknown");
    expect(outcome(ledByCharacter, { attackerUnitId: "squad", attackerMembers: members(["INFANTRY"]) })).toBe("applied");
    expect(outcome(ledByCharacter, { attackerUnitId: "exarch", attackerMembers: members(["INFANTRY"]) })).toBe("dropped");
  });

  it("settles a role without a filter from the members", () => {
    const leading = { type: "attachment", parameters: { role: "leading", subject: "this-model" } };
    expect(outcome(leading, { attackerUnitId: "exarch", attackerMembers: members(["INFANTRY"]) })).toBe("applied");
    expect(outcome(leading, { attackerUnitId: "exarch", attackerMembers: [{ unitId: "exarch", role: "leader", keywords: [] }] })).toBe("dropped");
  });
});
