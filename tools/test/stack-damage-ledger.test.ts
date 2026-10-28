import { describe, expect, it, vi } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { buildLedger } from "../src/stack-damage/ledger.js";
import { damageScoringSession, emptySpec, runDamageCell } from "../src/stack-damage/search.js";
import { bearerEquippedBuffs, equippedBuffs } from "../src/stack-damage/weapon-grants.js";
import type { Buff } from "../src/cruncher/index.js";
import type { Unit } from "../src/generated.js";

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
    // Pact of Blood is a list-building rule: its effect is an army-rule.
    const fight = cellFor("world-eaters", "fight");
    expect(fight.ledger.find((candidate) => candidate.abilityId === "pact-of-blood-world-eaters")).toMatchObject({
      status: "rejected",
      relevant: false,
      reasons: ["no current-attack effect", 'effect type "army-rule" is not modelled by the buff layer'],
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

  it("judges a wargear rule reaching through an attachment by its bearer's loadout", () => {
    // Kroot Farstalkers print Pech'ra; led, it reaches the stack both as theirs and as attached.
    const ctan = resolveTarget(dataset, dataset.targetProfiles.get("ctan-shard")!)!;
    const config = parseMatrixConfig(
      { HC_FACTIONS: "tau-empire", HC_TARGETS: "ctan-shard", HC_PHASES: "fight", HC_OUTPUT: "ledger.json" },
      { factionIds: new Set(["tau-empire"]), targetIds: ["ctan-shard"] },
    );
    const session = damageScoringSession({ dataset, config, faction, target: ctan, phase: "fight" });
    const unit = (id: string) => faction.units.find((candidate) => candidate.id === id)!;
    const result = session.optimiseLevers(emptySpec("tau-empire", [
      { unit: unit("kroot-farstalkers"), role: "bodyguard" },
      { unit: unit("kroot-war-shaper"), role: "leader" },
    ]));
    const bearer = result.members.find((scored) => scored.member.unit.id === "kroot-farstalkers")!;
    const carried = (bearer.loadout.counts.get("pechra") ?? 0) > 0;
    const pechra = buildLedger(session, result).filter((candidate) => candidate.abilityId === "pechra-tau-empire");
    expect(pechra.map((candidate) => candidate.sourceKind).sort()).toEqual(["attached", "unit"]);
    for (const candidate of pechra) {
      expect(candidate.reasons.includes("the chosen loadout does not include pechra, whose rule this is")).toBe(!carried);
    }
  });

  it("scores the leader with a bodyguard's wargear rule only while the bodyguard's loadout carries it", () => {
    const ctan = resolveTarget(dataset, dataset.targetProfiles.get("ctan-shard")!)!;
    const config = parseMatrixConfig(
      { HC_FACTIONS: "tau-empire", HC_TARGETS: "ctan-shard", HC_PHASES: "shooting", HC_OUTPUT: "ledger.json" },
      { factionIds: new Set(["tau-empire"]), targetIds: ["ctan-shard"] },
    );
    const session = damageScoringSession({ dataset, config, faction, target: ctan, phase: "shooting" });
    const unit = (id: string) => faction.units.find((candidate) => candidate.id === id)!;
    const unled = emptySpec("tau-empire", [
      { unit: unit("kroot-farstalkers"), role: "bodyguard" },
      { unit: unit("kroot-war-shaper"), role: "leader" },
    ]);
    const levers = session.pool(unled).levers.filter((lever) => lever.source.kind === "ability" && lever.source.abilityId === "pechra-tau-empire");
    const spec = { ...unled, selectedLeverIds: levers.map((lever) => lever.id) };
    const leader = spec.members[1]!;
    const pechra = (buffs: readonly Buff[]) => buffs.some(({ source }) => source.kind === "ability" && source.abilityId === "pechra-tau-empire");
    const loadouts = (pechraCount: number) => new Map([["kroot-farstalkers", new Map([["pechra", pechraCount]])]]);
    expect(pechra(session.memberBuffs(spec, leader))).toBe(true);
    expect(pechra(session.memberBuffs(spec, leader, undefined, loadouts(0)))).toBe(false);
    expect(pechra(session.memberBuffs(spec, leader, undefined, loadouts(1)))).toBe(true);

    // The leader's final search runs under the bodyguard's chosen loadout.
    const searched: Buff[][] = [];
    const bestLoadout = session.bestLoadout.bind(session);
    vi.spyOn(session, "bestLoadout").mockImplementation((member, buffs, ...rest) => {
      if (member.id === "kroot-war-shaper") searched.push(buffs);
      return bestLoadout(member, buffs, ...rest);
    });
    const result = session.scoreStack(spec);
    const carried = (result.members[0]!.loadout.counts.get("pechra") ?? 0) > 0;
    expect(pechra(searched.at(-1)!)).toBe(carried);
  });
});

describe("equipped buffs", () => {
  const unit = { id: "bearers", ability_ids: [{ id: "item-rule", wargear: "item" }] } as unknown as Unit;
  const buff = (abilityKind: "unit" | "attached", sourceUnitId?: string) =>
    ({ source: { kind: "ability", abilityId: "item-rule", abilityKind, ...(sourceUnitId ? { sourceUnitId } : {}) } }) as unknown as Buff;

  it("drops the unit's own item rule however it reaches the unit", () => {
    const buffs = [buff("unit"), buff("attached", "bearers"), buff("attached", "leader")];
    expect(equippedBuffs(unit, new Map(), buffs)).toEqual([buff("attached", "leader")]);
    expect(equippedBuffs(unit, new Map([["item", 1]]), buffs)).toEqual(buffs);
  });

  it("drops the rule another member's item gives, and only while that member leaves the item out", () => {
    const buffs = [buff("unit"), buff("attached", "bearers"), buff("attached", "leader")];
    expect(bearerEquippedBuffs(unit, new Map(), buffs)).toEqual([buff("unit"), buff("attached", "leader")]);
    expect(bearerEquippedBuffs(unit, new Map([["item", 1]]), buffs)).toEqual(buffs);
  });
});
