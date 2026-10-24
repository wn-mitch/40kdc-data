import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { runDamageCell } from "../src/stack-damage/search.js";

const dataset = Dataset.embedded();
const faction = resolveFactionContext(dataset, "tau-empire");
const target = resolveTarget(dataset, dataset.targetProfiles.get("geq-guardsmen")!)!;

function cellFor(factionId: string, phase: "shooting" | "fight", extra: Record<string, string> = {}) {
  const config = parseMatrixConfig({
    HC_FACTIONS: factionId,
    HC_TARGETS: "geq-guardsmen",
    HC_PHASES: phase,
    HC_BODYGUARDS: "1",
    HC_TOP: "1",
    HC_DEEP: "1",
    HC_OUTPUT: "ledger.json",
    ...extra,
  }, { factionIds: new Set([factionId]), targetIds: ["geq-guardsmen"] });
  const context = factionId === "tau-empire" ? faction : resolveFactionContext(dataset, factionId);
  return runDamageCell({ dataset, config, faction: context, target, phase });
}

const tauCell = (extra: Record<string, string> = {}) => cellFor("tau-empire", "shooting", extra);

describe("stack damage ledger", () => {
  const cell = tauCell();
  // Broadsides take Missile Drones, and bring Retaliation Cadre.
  const broadside = tauCell({ HC_BODYGUARDS: "3" });
  const entry = (abilityId: string, side: "attacker" | "target" = "attacker", from = cell) =>
    from.ledger.filter((candidate) => candidate.abilityId === abilityId && candidate.side === side);

  it("marks the provider of every selected lever applied", () => {
    const providers = new Set(cell.winner!.selectedLevers.map((lever) => (lever.source as { abilityId: string }).abilityId));
    expect(providers.size).toBeGreaterThan(0);
    for (const abilityId of providers) {
      expect(entry(abilityId).some((candidate) =>
        candidate.status === "applied" || candidate.reasons.includes("applied in part"))).toBe(true);
    }
  });

  it("keeps an eligible Stratagem the optimiser did not select", () => {
    // Retaliation Cadre's other Stratagems are left unused by the winner.
    const selected = broadside.winner!.stratagem?.id;
    const unselected = broadside.ledger.filter((candidate) =>
      candidate.sourceKind === "detachment-stratagem" && candidate.status !== "applied");
    expect(unselected.length).toBeGreaterThan(0);
    expect(unselected.every((candidate) => !selected?.startsWith(candidate.abilityId))).toBe(true);
  });

  it("records an encounter-layer effect without making the cell incomplete", () => {
    expect(entry("deadly-demise").map(({ status, relevant, reasons }) => ({ status, relevant, reason: reasons[0] })))
      .toContainEqual({ status: "unresolved", relevant: false, reason: "encounter-layer" });
  });

  it("rejects a provider whose only fragments act outside the attack", () => {
    // Pact of Blood is a seeded stub: its effect is no-effect.
    const fight = cellFor("world-eaters", "fight");
    expect(fight.ledger.find((candidate) => candidate.abilityId === "pact-of-blood-world-eaters")).toMatchObject({
      status: "rejected",
      relevant: false,
      reasons: ["no current-attack effect", 'effect type "no-effect" is not modelled by the buff layer'],
    });
  });

  it("classifies an unevaluable condition by what it gates", () => {
    // For the Greater Good gates attack modifiers, so its unknown condition stays open.
    expect(entry("for-the-greater-good-tau-empire")[0]).toMatchObject({
      status: "unresolved",
      relevant: true,
      reasons: ['conditional: cannot evaluate condition "and" against current context'],
    });
    // Grab Dat Scrap gates only effects outside the attack, so it is rejected.
    const fight = cellFor("orks", "fight");
    expect(fight.ledger.find((candidate) => candidate.abilityId === "grab-dat-scrap-orks")).toMatchObject({
      status: "rejected",
      relevant: false,
      reasons: ["no current-attack effect", 'conditional: cannot evaluate condition "matches" against current context'],
    });
  });

  it("resolves wargear-gated rules against the winning loadout", () => {
    const member = broadside.winner!.members.find((candidate) => candidate.unitId === "broadside-battlesuits")!;
    const drones = member.loadout.find((item) => item.weaponId === "missile-drone")?.count ?? 0;
    expect(drones).toBeGreaterThan(0);
    // The Missile Drone's own rule equips its carriers, and its weapon is scored on each of them.
    const pod = member.weapons.find((weapon) => weapon.id === "missile-pod-drone");
    expect(pod?.count).toBe(drones);
    expect(pod?.stages["after-fnp"]).toBeGreaterThan(0);
    expect(entry("missile-drone-tau-empire", "attacker", broadside)[0]).toMatchObject({ status: "applied", relevant: false });
    // The Drones army rule grants for the same drone, so the drone's own rule owns its weapons.
    const drone = entry("drones-tau-empire", "attacker", broadside)[0];
    expect(drone).toMatchObject({ status: "rejected", relevant: false });
    expect(drone.reasons).toContain("weapon-grant: missile-pod-drone duplicates the missile-drone grant of missile-drone-tau-empire");
    // The Sudden Dawn Cadre patrol's copy of Drones applies only in that patrol's detachment.
    expect(entry("drones-sudden-dawn-cadre-tau-empire", "attacker", broadside)).toEqual([]);
    // A drone the loadout leaves out contributes nothing and leaves nothing open.
    expect(entry("marker-drone-tau-empire", "attacker", broadside)[0]).toMatchObject({
      status: "rejected",
      relevant: false,
      reasons: ["the chosen loadout does not include marker-drone, whose rule this is"],
    });
    expect(broadside.unsupported.some((warning) => warning.reason.includes('"unit-wargear"') || warning.sourceAbilityId === "marker-drone-tau-empire")).toBe(false);
  });

  it("rejects the Drones rule when the winner carries no drone", () => {
    expect(cell.winner!.members.every((member) => member.loadout.every((item) => !item.weaponId.endsWith("-drone")))).toBe(true);
    expect(entry("drones-tau-empire")[0]).toMatchObject({ status: "rejected", relevant: false });
  });

  it("treats a defensive choice the attacker cannot select as relevant", () => {
    expect(entry("voice-of-command-astra-militarum", "target")[0]).toMatchObject({ status: "unresolved", relevant: true });
  });

  it("derives the cell status from relevant entries", () => {
    expect(cell.status).toBe(cell.ledger.some((candidate) => candidate.relevant) ? "incomplete" : "complete");
  });

  it("rejects a configuration-dropped rule instead of omitting it", () => {
    const dropped = tauCell({ HC_DROP_RULE: "for-the-greater-good-tau-empire" });
    expect(dropped.ledger.find((candidate) => candidate.abilityId === "for-the-greater-good-tau-empire")).toMatchObject({
      status: "rejected",
      relevant: false,
      reasons: ["dropped by configuration"],
    });
  });
});
