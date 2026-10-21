import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext, unitInFaction } from "../src/stack-damage/factions.js";
import { buildLedger } from "../src/stack-damage/ledger.js";
import { damageScoringSession, emptySpec } from "../src/stack-damage/search.js";

// A Combat Patrol prints its own copy of an army rule. The copy applies only in the patrol's
// detachment, and there it replaces the codex army rule, so the two never stack.

const dataset = Dataset.embedded();
const CODEX = "doctrina-imperatives-adeptus-mechanicus";
const PATROL = "doctrina-imperatives-purge-corps-deltic-9-adeptus-mechanicus";

const faction = resolveFactionContext(dataset, "adeptus-mechanicus");
const config = parseMatrixConfig(
  { HC_FACTIONS: "adeptus-mechanicus", HC_TARGETS: "geq-guardsmen", HC_PHASES: "shooting", HC_OUTPUT: "patrol.json" },
  { factionIds: new Set(["adeptus-mechanicus"]), targetIds: ["geq-guardsmen"] },
);
const target = resolveTarget(dataset, dataset.targetProfiles.get("geq-guardsmen")!)!;
const session = damageScoringSession({ dataset, config, faction, target, phase: "shooting" });

function stack(unitId: string, detachmentIds: string[]) {
  const unit = unitInFaction(faction, unitId)!;
  expect(unit, unitId).toBeDefined();
  return emptySpec(faction.id, [{ unit, role: "bodyguard" }], detachmentIds);
}

/** The Doctrina records whose levers a stack's pool offers. */
function doctrinaProviders(spec: ReturnType<typeof stack>): string[] {
  const ids = session.pool(spec).levers.flatMap((lever) => (lever.source.kind === "ability" ? [lever.source.abilityId] : []));
  return [...new Set(ids.filter((id) => id === CODEX || id === PATROL))].sort();
}

describe("Combat Patrol army rules in the damage matrix", () => {
  it("never offers the patrol's copy in another detachment", () => {
    expect(doctrinaProviders(stack("skitarii-vanguard", ["skitarii-hunter-cohort"]))).toEqual([CODEX]);
    expect(doctrinaProviders(stack("skitarii-vanguard", ["eradication-cohort", "data-psalm-conclave"]))).toEqual([CODEX]);
  });

  it("offers exactly one Doctrina in the patrol's detachment", () => {
    expect(doctrinaProviders(stack("purge-corps-skitarii-vanguard", ["purge-corps-deltic-9"]))).toEqual([PATROL]);
  });

  it("keeps the codex rule replaced when the patrol is combined with another detachment", () => {
    // Each detachment is resolved on its own; the other detachment's pass must not restore the codex rule.
    const spec = stack("purge-corps-skitarii-vanguard", ["purge-corps-deltic-9", "skitarii-hunter-cohort"]);
    expect(doctrinaProviders(spec)).toEqual([PATROL]);
    const best = session.optimiseLevers(spec);
    const ledgerIds = buildLedger(session, best).filter((entry) => entry.side === "attacker").map((entry) => entry.abilityId);
    expect(ledgerIds).toContain(PATROL);
    expect(ledgerIds).not.toContain(CODEX);
  });
});

describe("Combat Patrol army-rule records", () => {
  // Every faction-typed record scoped to a detachment is a patrol's army rule: its detachment is a
  // Combat Patrol of the same faction that lists it, and what it replaces is that faction's army rule.
  const raw = [...dataset.abilities].map((ability) => ability.raw);
  const scoped = raw.filter((ability) => ability.ability_type === "faction" && ability.detachment_id != null);

  it("covers the known copies", () => {
    expect(scoped.map((ability) => ability.ability_id)).toEqual(expect.arrayContaining([PATROL, "nurgles-gift-maggot-lords-death-guard"]));
  });

  for (const ability of scoped) {
    it(`${ability.ability_id} is scoped to a Combat Patrol that lists it and replaces only army rules`, () => {
      const detachment = dataset.detachments.getInFaction(ability.detachment_id!, ability.faction_id!);
      expect(detachment, `${ability.detachment_id} in ${ability.faction_id}`).toBeDefined();
      expect(detachment!.game_modes).toContain("combat-patrol");
      expect(detachment!.detachment_rule_ids).toContain(ability.ability_id);
      const armyRules = dataset.factions.get(ability.faction_id!)?.raw.faction_rule_ids ?? [];
      for (const entry of ability.interactions ?? []) {
        if (entry.type === "replaces") expect(armyRules).toContain(entry.ability_ref);
      }
    });
  }
});
