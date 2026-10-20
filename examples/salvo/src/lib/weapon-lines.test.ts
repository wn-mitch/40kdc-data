import { describe, expect, it } from "vitest";
import { crunch, Dataset, unitLoadoutDamage, validateCandidateLoadout, type EngineContext } from "@alpaca-software/40kdc-data";

import { defaultWeaponCount, lineId, memberLoadout, selectLines, weaponLines } from "./weapon-lines.js";

const ds = Dataset.embedded();
const target = { unit: ds.units.getAny("intercessor-squad")!.raw, modelCount: 5 };

const FACTION: Record<string, string> = { legionaries: "chaos-space-marines", "plague-marines": "death-guard", "skitarii-rangers": "adeptus-mechanicus" };
const unitOf = (unitId: string) => ds.units.getInFaction(unitId, FACTION[unitId]!)!;

function member(unitId: string, counts?: Record<string, number>) {
  const unit = unitOf(unitId);
  const loadout = memberLoadout(ds, unit.raw);
  const carried = counts
    ? new Map(Object.entries(counts))
    : new Map(unit.weapons.map((w) => [w.id, defaultWeaponCount(loadout, w.id)] as const).filter(([, n]) => n > 0));
  return { unit, loadout, counts: carried };
}

/** Salvo's per-line path: each used line crunched with the models firing it, summed. */
function lineTotal(unitId: string, firing: Map<string, number>, context: EngineContext): number {
  const unit = unitOf(unitId);
  const lines = weaponLines([{ memberId: unitId, name: unit.name, weapons: unit.weapons.map((w) => w.raw) }], context.phase === "fight" ? "melee" : "ranged");
  return lines.reduce((sum, line) => {
    const models = firing.get(line.id);
    if (!models) return sum;
    const out = crunch({ attacker: { weapon: line.weaponRaw, profileIndex: line.profileIndex }, target: { ...target, profileIndex: 0 }, modelsFiring: models, buffs: [], context }, ds);
    return sum + out.stages.find((stage) => stage.name === "after-fnp")!.expected;
  }, 0);
}

describe("selectLines", () => {
  for (const [unitId, phase] of [["legionaries", "shooting"], ["legionaries", "fight"], ["plague-marines", "shooting"], ["plague-marines", "fight"], ["skitarii-rangers", "shooting"]] as const) {
    it(`scores the lines Salvo shows exactly as the shared loadout scoring: ${unitId} ${phase}`, () => {
      const { loadout, counts } = member(unitId);
      const context: EngineContext = { phase };
      const selection = selectLines({ ds, members: [{ memberId: unitId, loadout, counts }], target, buffs: [], context });
      const legality = validateCandidateLoadout({ unit: loadout.unit, modelCount: loadout.modelCount, options: loadout.options, counts, models: loadout.models });
      const shared = unitLoadoutDamage({ dataset: ds, unit: loadout.unit, modelCount: loadout.modelCount, counts, target, buffs: [], context, groups: legality.groups });
      expect(selection.total).toBeCloseTo(shared.total, 9);
      expect(lineTotal(unitId, selection.firing, context)).toBeCloseTo(shared.total, 9);
    });
  }

  it("gives each model one ordinary melee weapon instead of summing every melee line", () => {
    const { loadout, counts } = member("legionaries");
    const selection = selectLines({ ds, members: [{ memberId: "legionaries", loadout, counts }], target, buffs: [], context: { phase: "fight" } });
    const fired = [...selection.firing.values()].reduce((sum, n) => sum + n, 0);
    expect(fired).toBe(loadout.modelCount);
    expect([...counts.entries()].filter(([id]) => ds.weapons.getAny(id)?.raw.type === "melee").reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(fired);
  });

  it("fires a model's Pistol or its other guns, never both", () => {
    // Five Legionaries: one sergeant with a plasma pistol and boltgun, four with bolt pistols and boltguns.
    const { loadout } = member("legionaries");
    const counts = new Map([["plasma-pistol", 1], ["bolt-pistol", 4], ["boltgun", 5], ["close-combat-weapon", 5]]);
    const selection = selectLines({ ds, members: [{ memberId: "legionaries", loadout, counts }], target, buffs: [], context: { phase: "shooting" } });
    const pistols = [...selection.firing].filter(([id]) => id.includes("pistol")).reduce((sum, [, n]) => sum + n, 0);
    const others = [...selection.firing].filter(([id]) => !id.includes("pistol")).reduce((sum, [, n]) => sum + n, 0);
    expect(pistols + others).toBe(5);
    expect(selection.firing.has(lineId("legionaries", "boltgun", 0)) || pistols === 5).toBe(true);
  });

  it("reports wargear the counts make illegal", () => {
    const { loadout } = member("legionaries");
    // Every Legionary with a heavy melee weapon: only the champion and one other may take one.
    const counts = new Map([["heavy-melee-weapon", 5], ["bolt-pistol", 5], ["close-combat-weapon", 5]]);
    const selection = selectLines({ ds, members: [{ memberId: "legionaries", loadout, counts }], target, buffs: [], context: { phase: "fight" } });
    expect(selection.violations.get("legionaries")?.length).toBeGreaterThan(0);
  });
});
