import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { runDamageCell } from "../src/stack-damage/search.js";

const dataset = Dataset.embedded();
const faction = resolveFactionContext(dataset, "tau-empire");
const target = resolveTarget(dataset, dataset.targetProfiles.get("geq-guardsmen")!)!;

function tauCell(extra: Record<string, string> = {}) {
  const config = parseMatrixConfig({
    HC_FACTIONS: "tau-empire",
    HC_TARGETS: "geq-guardsmen",
    HC_PHASES: "shooting",
    HC_BODYGUARDS: "1",
    HC_TOP: "1",
    HC_DEEP: "1",
    HC_OUTPUT: "ledger.json",
    ...extra,
  }, { factionIds: new Set(["tau-empire"]), targetIds: ["geq-guardsmen"] });
  return runDamageCell({ dataset, config, faction, target, phase: "shooting" });
}

describe("stack damage ledger", () => {
  const cell = tauCell();
  const entry = (abilityId: string, side: "attacker" | "target" = "attacker") =>
    cell.ledger.filter((candidate) => candidate.abilityId === abilityId && candidate.side === side);

  it("marks the provider of every selected lever applied", () => {
    const providers = new Set(cell.winner!.selectedLevers.map((lever) => (lever.source as { abilityId: string }).abilityId));
    expect(providers.size).toBeGreaterThan(0);
    for (const abilityId of providers) {
      expect(entry(abilityId).some((candidate) =>
        candidate.status === "applied" || candidate.reasons.includes("applied in part"))).toBe(true);
    }
  });

  it("keeps an eligible Stratagem the optimiser did not select", () => {
    // Broadsides bring Retaliation Cadre, whose other Stratagems the winner leaves unused.
    const broadside = tauCell({ HC_BODYGUARDS: "3" });
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
    expect(entry("for-the-greater-good-sudden-dawn-cadre-tau-empire")[0]).toMatchObject({
      status: "rejected",
      relevant: false,
      reasons: ["no current-attack effect", 'effect type "no-effect" is not modelled by the buff layer'],
    });
  });

  it("classifies an unevaluable condition by what it gates", () => {
    // Guardian Drone's gated penalty acts on incoming attacks, so only the drone weapons stay open.
    expect(entry("drones-tau-empire")[0]).toMatchObject({
      status: "unresolved",
      relevant: true,
      reasons: ['conditional: cannot evaluate condition "unit-wargear" against current context'],
    });
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
