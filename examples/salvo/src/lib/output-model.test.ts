import { describe, expect, it } from "vitest";
import { Dataset, type EngineContext } from "@alpaca-software/40kdc-data";

import { crunchLine, enabledLeverBuffs, memberUnits, synthTarget, targetDefences } from "./output-model.js";
import { DEFAULT_TARGET } from "./store.svelte.js";
import { weaponLines } from "./weapon-lines.js";

const ds = Dataset.embedded();
const shooting: EngineContext = { phase: "shooting" };
const noBuild = { detachmentId: null, stratagemIds: [], enhancementId: null };

describe("output pane derivations", () => {
  it("resolves a shared chassis to the selected faction's copy and skips unknown members", () => {
    const [member, ...rest] = memberUnits(ds, "chaos-space-marines", ["chaos-land-raider", null, "no-such-unit"]);
    expect(rest).toEqual([]);
    expect(member!.unit.raw.faction_id).toBe("chaos-space-marines");
    expect(member!.loadout.unit).toBe(member!.unit.raw);
  });

  it("reports an unknown target unit instead of dropping its defences silently", () => {
    expect(targetDefences(ds, null, noBuild, shooting)).toEqual({ buffs: [] });
    expect(targetDefences(ds, "no-such-unit", noBuild, shooting).error).toContain("no-such-unit");
  });

  it("never shares weapon-keyword levers across lines", () => {
    const unit = ds.units.getInFaction("broadside-battlesuits", "tau-empire")!;
    const levers = ds.stackableBuffsFor({
      unitId: unit.id,
      factionId: "tau-empire",
      weaponProfiles: unit.weapons.flatMap((w) => w.raw.profiles.map((_, profileIndex) => ({ weaponId: w.id, profileIndex }))),
    }, shooting).buffs;
    expect(levers.some((lever) => lever.source.kind === "weapon-keyword")).toBe(true);
    const all = enabledLeverBuffs(levers, () => true);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((buff) => buff.source.kind === "weapon-keyword")).toBe(false);
    expect(enabledLeverBuffs(levers, () => false)).toEqual([]);
  });

  it("applies the owner's Big Guns Never Tire penalty to an engaged vehicle's line", () => {
    const [defiler] = memberUnits(ds, "chaos-space-marines", ["defiler"]);
    const line = weaponLines([{ memberId: "defiler", name: "Defiler", weapons: defiler!.unit.weapons.map((w) => w.raw) }], "ranged")
      .find((candidate) => !candidate.weaponRaw.profiles[candidate.profileIndex]!.keywords?.some((k) => k.keyword_id === "pistol"))!;
    const engaged: EngineContext = { phase: "shooting", attackerStates: ["engaged"] };
    const target = { unit: synthTarget(DEFAULT_TARGET), modelCount: DEFAULT_TARGET.modelCount };
    const hits = (owner: typeof defiler.unit.raw | undefined) =>
      crunchLine({ ds, line, owner, models: 1, target, buffs: [], context: engaged }).attributed.find((s) => s.name === "hits")!.expected;
    expect(hits(defiler!.unit.raw)).toBeLessThan(hits(undefined));
    expect(crunchLine({ ds, line, owner: defiler!.unit.raw, models: 0, target, buffs: [], context: engaged }).error).toBe("no models carry this weapon");
  });
});
