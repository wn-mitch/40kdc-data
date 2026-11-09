import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/index.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { damageScoringSession, emptySpec } from "../src/stack-damage/search.js";

const dataset = Dataset.embedded();
const factionId = "adeptus-custodes";
const faction = resolveFactionContext(dataset, factionId);
const target = resolveTarget(dataset, dataset.targetProfiles.get("questoris-knight")!)!;
const config = parseMatrixConfig(
  { HC_FACTIONS: factionId, HC_TARGETS: "questoris-knight", HC_PHASES: "fight", HC_OUTPUT: "stack-damage.json" },
  { factionIds: new Set([factionId]), targetIds: ["questoris-knight"] },
);
const allarus = dataset.units.getInFaction("allarus-custodians", factionId)!;
const spear = "guardian-spear-allarus-custodians";

/** A fresh session scoring Allarus Custodians under Magna Imperator's re-roll-one-hit and re-roll-one-wound. */
function allarusUnderMagnaImperator() {
  const session = damageScoringSession({ dataset, config, faction, target, phase: "fight" });
  const base = emptySpec(factionId, [{ unit: allarus, role: "bodyguard" }], ["emperors-chosen"]);
  const reroll = session.pool(base).levers.find((lever) => lever.id === "magna-imperator-adeptus-custodes@selected:attack");
  expect(reroll?.buffs.some((buff) => buff.contribution.type === "reroll-one")).toBe(true);
  const spec = { ...base, selectedLeverIds: [reroll!.id] };
  const member = spec.members[0];
  const space = session.loadoutSpace(allarus, session.memberBuffs(spec, member), session.state.contextFor(spec, member));
  const threeSpears = new Map(space.scaffold.base);
  expect(threeSpears.get(spear)).toBe(3);
  const oneSpear = new Map(threeSpears).set(spear, 1).set("castellan-axe", 2);
  expect(space.legal(oneSpear)).toBe(true);
  return { session, spec, member, space, threeSpears, oneSpear };
}

const afterFnp = (stages: readonly { name: string; expected: number }[]) =>
  stages.find((stage) => stage.name === "after-fnp")?.expected ?? 0;

describe("stack damage profile score cache", () => {
  it("scores a one-spear loadout the same after the session has scored three spears", () => {
    const fresh = allarusUnderMagnaImperator();
    const expected = fresh.space.score(fresh.oneSpear);

    const warmed = allarusUnderMagnaImperator();
    warmed.space.score(warmed.threeSpears);
    const actual = warmed.space.score(warmed.oneSpear);

    const spearLine = (result: typeof actual) => result.selectedWeapons.find((weapon) => weapon.weaponId === spear);
    expect(spearLine(actual)?.count).toBe(1);
    expect(spearLine(actual)?.damage).toBeCloseTo(spearLine(expected)!.damage, 9);
    expect(actual.total).toBeCloseTo(expected.total, 9);
  });
});

describe("stack damage weapon rows under a re-roll-one permission", () => {
  const { session, spec, member, space, oneSpear } = allarusUnderMagnaImperator();
  const result = space.score(oneSpear);

  it("spends the permission on exactly one row", () => {
    expect(result.selectedWeapons.filter((weapon) => weapon.rerollOne).length).toBe(1);
  });

  it("keeps every row's stages per model, so the rows sum to the total", () => {
    for (const weapon of result.selectedWeapons) {
      expect(afterFnp(weapon.stages) * weapon.count).toBeCloseTo(weapon.damage, 9);
    }
    expect(result.selectedWeapons.reduce((sum, weapon) => sum + weapon.damage, 0)).toBeCloseTo(result.total, 9);
  });

  it("attributes each row's damage with the buffs that row scored with", () => {
    for (const weapon of result.selectedWeapons) {
      const attribution = session.attributeWeapon(spec, member, weapon, oneSpear)!;
      const attributed = attribution.baseline + attribution.lifts.reduce((sum, lift) => sum + lift.delta, 0) + attribution.residual;
      expect(attributed).toBeCloseTo(weapon.damage, 9);
    }
  });
});
