import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../src/cruncher/index.js";
import { matchesUnitFilter } from "../src/cruncher/unit-filter.js";

const models = (filter: Record<string, unknown>) => ({ owner: "friendly", level: "model", ...filter });
// A combined unit whose bodyguard models are DEATH GUARD INFANTRY and whose leader adds CHARACTER.
const combined: EngineContext = {
  phase: "shooting",
  attackerKeywords: ["death guard", "infantry", "character"],
  attackerModelKeywords: ["death guard", "infantry"],
};

describe("model-level keyword filters", () => {
  it("selects the whole unit when every model carries the keywords", () => {
    expect(matchesUnitFilter(models({ all_of: ["DEATH GUARD"] }), combined, "attacker")).toBe(true);
    expect(matchesUnitFilter(models({ any_of: ["MONSTER", "INFANTRY"] }), combined, "attacker")).toBe(true);
    expect(matchesUnitFilter(models({ none_of: ["VEHICLE"] }), combined, "attacker")).toBe(true);
    expect(matchesUnitFilter(models({ not_all_of: ["INFANTRY", "VEHICLE"] }), combined, "attacker")).toBe(true);
  });

  it("rules the unit out when no model can carry the keywords", () => {
    expect(matchesUnitFilter(models({ all_of: ["VEHICLE"] }), combined, "attacker")).toBe(false);
    expect(matchesUnitFilter(models({ none_of: ["INFANTRY"] }), combined, "attacker")).toBe(false);
    expect(matchesUnitFilter(models({ not_all_of: ["DEATH GUARD", "INFANTRY"] }), combined, "attacker")).toBe(false);
    expect(matchesUnitFilter(models({ all_of: ["DEATH GUARD"], none_of: ["INFANTRY"] }), combined, "attacker")).toBe(false);
  });

  it("stays unknown when only some models qualify", () => {
    // Only the leader's models are CHARACTER; the union alone used to reject none_of outright.
    expect(matchesUnitFilter(models({ all_of: ["CHARACTER"] }), combined, "attacker")).toBe("unknown");
    expect(matchesUnitFilter(models({ none_of: ["CHARACTER"] }), combined, "attacker")).toBe("unknown");
    expect(matchesUnitFilter(models({ all_of: ["DEATH GUARD"], none_of: ["CHARACTER"] }), combined, "attacker")).toBe("unknown");
  });

  it("stays unknown without model keywords, but the union still rules a unit out", () => {
    const unionOnly: EngineContext = { phase: "shooting", attackerKeywords: combined.attackerKeywords };
    expect(matchesUnitFilter(models({ all_of: ["DEATH GUARD"] }), unionOnly, "attacker")).toBe("unknown");
    expect(matchesUnitFilter(models({ all_of: ["VEHICLE"] }), unionOnly, "attacker")).toBe(false);
    expect(matchesUnitFilter(models({ all_of: ["DEATH GUARD"] }), { phase: "shooting" }, "attacker")).toBe("unknown");
  });

  it("reads the target's own model keywords on the target side", () => {
    const target: EngineContext = { phase: "shooting", targetKeywords: ["infantry"], targetModelKeywords: ["infantry"] };
    expect(matchesUnitFilter(models({ owner: "enemy", all_of: ["INFANTRY"] }), target, "target", "enemy")).toBe(true);
    expect(matchesUnitFilter(models({ all_of: ["INFANTRY"] }), combined, "target")).toBe("unknown");
  });

  it("keeps a model filter that also names an attachment role on the role path", () => {
    const leader = { ...models({ all_of: ["CHARACTER"] }), member_of: "this-unit", attachment_role: "leader" };
    const context: EngineContext = { ...combined, attackerModelKeywords: ["death guard", "infantry", "character"], attackerAttachmentRole: "leader" };
    expect(matchesUnitFilter(leader, context, "attacker")).toBe(true);
    expect(matchesUnitFilter(leader, { ...context, attackerAttachmentRole: "bodyguard" }, "attacker")).toBe(false);
  });

  it("applies a model-scoped re-roll when every attacking model qualifies", () => {
    const source: BuffSource = { kind: "ability", abilityId: "fabricated-model-reroll", abilityKind: "unit" };
    const effect = { type: "re-roll", target: models({ all_of: ["DEATH GUARD"] }), modifier: { roll: "hit", subset: "ones" } };
    const applied = effectToBuffs(effect, source, combined, "attacker");
    expect(applied.unsupported).toEqual([]);
    expect(applied.applied.map((buff) => buff.contribution.type)).toEqual(["reroll"]);
    expect(effectToBuffs(effect, source, { ...combined, attackerModelKeywords: undefined }, "attacker").applied).toEqual([]);
  });
});

describe("matchesUnitFilter: proximity to other units", () => {
  const nearBattleline = { within: { of: { all_of: ["ADEPTUS MECHANICUS", "BATTLELINE"], owner: "friendly" }, range: { inches: 6 } } };
  const at = (neighbours: EngineContext["attackerNeighbours"], targetNeighbours?: EngineContext["targetNeighbours"]): EngineContext =>
    ({ phase: "shooting", attackerNeighbours: neighbours, targetNeighbours });
  const skitarii = { keywords: ["Adeptus Mechanicus", "Battleline", "Infantry"], owner: "friendly" as const, distanceInches: 5 };

  it("holds for a matching friendly unit in range and fails beyond it", () => {
    expect(matchesUnitFilter(nearBattleline, at([skitarii]), "attacker")).toBe(true);
    expect(matchesUnitFilter(nearBattleline, at([{ ...skitarii, distanceInches: 7 }]), "attacker")).toBe(false);
    expect(matchesUnitFilter(nearBattleline, at([{ ...skitarii, keywords: ["Adeptus Mechanicus", "Infantry"] }]), "attacker")).toBe(false);
    expect(matchesUnitFilter(nearBattleline, at([]), "attacker")).toBe(false);
    expect(matchesUnitFilter(nearBattleline, at(undefined), "attacker")).toBe("unknown");
  });

  it("reads the filter's owner from the ability's side, not the filtered unit's", () => {
    // The defender's ability filters the attacker: a unit friendly to the attacker is an enemy to the ability.
    const nearEnemy = { within: { of: { all_of: ["BATTLELINE"], owner: "enemy" }, range: { inches: 6 } } };
    expect(matchesUnitFilter(nearEnemy, at([skitarii]), "attacker", "enemy")).toBe(true);
    expect(matchesUnitFilter(nearBattleline, at([skitarii]), "attacker", "enemy")).toBe(false);
    expect(matchesUnitFilter(nearBattleline, at(undefined, [skitarii]), "target")).toBe(true);
  });

  it("leaves wholly-within and non-inch ranges unresolved", () => {
    expect(matchesUnitFilter({ within: { ...nearBattleline.within, wholly: true } }, at([skitarii]), "attacker")).toBe("unknown");
    expect(matchesUnitFilter({ within: { ...nearBattleline.within, range: "engagement" } }, at([skitarii]), "attacker")).toBe("unknown");
  });
});
