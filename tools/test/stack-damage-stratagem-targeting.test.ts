import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset, emptyRawData } from "../src/data/index.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { damageScoringSession, emptySpec } from "../src/stack-damage/search.js";
import { filterStackEligibleAbilities, stratagemCost } from "../src/stack-damage/stratagem-eligibility.js";

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

describe("attached-unit Stratagem targets", () => {
  const dgFaction = resolveFactionContext(dataset, "death-guard");
  const dgConfig = parseMatrixConfig(
    { HC_FACTIONS: "death-guard", HC_TARGETS: "rhino", HC_PHASES: "fight", HC_OUTPUT: "stack-damage.json" },
    { factionIds: new Set(["death-guard"]), targetIds: ["rhino"] },
  );
  const dgSession = damageScoringSession({
    dataset, config: dgConfig, faction: dgFaction, target: resolveTarget(dataset, dataset.targetProfiles.get("rhino")!)!, phase: "fight",
  });
  const offered = (members: { unitId: string; role: "bodyguard" | "leader" }[]) =>
    dgSession.pool(emptySpec("death-guard", members.map(({ unitId, role }) => ({ unit: dataset.units.getInFaction(unitId, "death-guard")!, role })), ["champions-of-contagion"]))
      .levers.some((lever) => lever.source.kind === "ability" && lever.source.abilityId === "blessings-of-filth-champions-of-contagion-death-guard");

  it("refuses Blessings of Filth to a unit nothing is attached to", () => {
    expect(offered([{ unitId: "blightlord-terminators", role: "bodyguard" }])).toBe(false);
  });

  it("offers Blessings of Filth to an attached unit", () => {
    expect(offered([{ unitId: "blightlord-terminators", role: "bodyguard" }, { unitId: "lord-of-contagion", role: "leader" }])).toBe(true);
  });
});

describe("a Stratagem's cost on a stack", () => {
  const dataset = Dataset.embedded();
  const strat = dataset.stratagems.all.find((candidate) => candidate.id === "point-blank-ambush-kauyon-tau-empire")!;
  const unit = (id: string) => dataset.units.getInFaction(id, "tau-empire")!.raw;

  it("triples a Stratagem used on the Manta (Air Caste Colossus)", () => {
    expect(stratagemCost(dataset, strat, [unit("manta")])).toEqual({ cp: strat.cp_cost * 3, modifiedBy: ["air-caste-colossus-tau-empire"], unapplied: [] });
  });

  it("leaves the printed cost on a unit with no cost rule", () => {
    expect(stratagemCost(dataset, strat, [unit("broadside-battlesuits")])).toEqual({ cp: strat.cp_cost, modifiedBy: [], unapplied: [] });
  });
});
