import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset, emptyRawData } from "../src/data/index.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { damageScoringSession, emptySpec } from "../src/stack-damage/search.js";
import { filterStackEligibleAbilities } from "../src/stack-damage/stratagem-eligibility.js";

const dataset = Dataset.embedded();
const factionId = "adeptus-custodes";
const detachmentId = "null-maiden-vigil";
const stratagemAbilityId = "anathema-blademastery-null-maiden-vigil-adeptus-custodes";
const faction = resolveFactionContext(dataset, factionId);
const target = resolveTarget(dataset, dataset.targetProfiles.get("geq-guardsmen")!)!;
const config = parseMatrixConfig(
  { HC_FACTIONS: factionId, HC_TARGETS: "geq-guardsmen", HC_PHASES: "fight", HC_OUTPUT: "stack-damage.json" },
  { factionIds: new Set([factionId]), targetIds: ["geq-guardsmen"] },
);
const session = damageScoringSession({ dataset, config, faction, target, phase: "fight" });

function stratagemIsOffered(unitId: string): boolean {
  const unit = dataset.units.getInFaction(unitId, factionId)!;
  return session.pool(emptySpec(factionId, [{ unit, role: "bodyguard" }], [detachmentId])).levers.some((lever) =>
    lever.source.kind === "ability" && lever.source.abilityId === stratagemAbilityId);
}

function stackAllows(target: unknown, triggerSubject?: unknown): boolean {
  const raw = emptyRawData();
  raw.stratagems = [{
    id: "fixture-stratagem",
    name: "Fixture Stratagem",
    category: "detachment",
    detachment_id: "fixture-detachment",
    cp_cost: 1,
    phases: ["fight"],
    target_restrictions: target,
    ability_id: "fixture-ability",
  }] as never;
  raw.abilities = [{
    ability_id: "fixture-ability",
    name: "Fixture Ability",
    faction_id: "orks",
    ability_type: "stratagem",
    behavior: "reactive",
    effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
    ...(triggerSubject === undefined ? {} : { trigger: { event: "selected", subject: triggerSubject } }),
  }] as never;
  const fixture = new Dataset(raw);
  const ability = fixture.abilities.get("fixture-ability")!;
  return filterStackEligibleAbilities(fixture, { unitId: "vigilator-squad" }, [{
    ability,
    source: { kind: "detachment-stratagem", stratagemId: "fixture-stratagem", cpCost: 1 },
    phases: ["fight"],
  }]).length === 1;
}

describe("stack damage stratagem target eligibility", () => {
  it("does not offer Anathema Blademastery to a non-Vigilator", () => {
    expect(stratagemIsOffered("prosecutor-squad")).toBe(false);
  });

  it("offers Anathema Blademastery to a Vigilator Squad", () => {
    expect(stratagemIsOffered("vigilator-squad")).toBe(true);
  });
});

describe("static target and trigger facts", () => {
  it("keeps a negated target filter unresolved when another predicate is unknown", () => {
    expect(stackAllows({
      selects: "unit",
      eligibility: {
        operator: "not",
        operands: [{ type: "matches", parameters: { filter: { level: "unit", unit_ids: ["vigilator-squad"], state: "engaged" } } }],
      },
    })).toBe(true);
  });

  it("narrows any-of target alternatives by unit ID", () => {
    const target = (unitIds: string[]) => ({
      selects: "unit",
      eligibility: { type: "matches", parameters: { filter: { level: "unit", any_of_filters: unitIds.map((id) => ({ unit_ids: [id] })) } } },
    });
    expect(stackAllows(target(["prosecutor-squad"]))).toBe(false);
    expect(stackAllows(target(["prosecutor-squad", "vigilator-squad"]))).toBe(true);
  });

  it("does not apply an enemy trigger subject to a bound friendly target", () => {
    expect(stackAllows(
      { selects: "unit", bound_to: "triggering-unit", eligibility: { type: "matches", parameters: { filter: { level: "unit", unit_ids: ["vigilator-squad"] } } } },
      { owner: "enemy", level: "unit", unit_ids: ["prosecutor-squad"] },
    )).toBe(true);
  });
});
