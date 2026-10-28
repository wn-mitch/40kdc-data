import { describe, expect, it } from "vitest";
import { Dataset, type EngineContext } from "@alpaca-software/40kdc-data";

import { crunchLine, enabledLeverBuffs, memberMortalSources, memberUnits, mortalSourceKey, mortalSourceLine, synthTarget, targetDefences } from "./output-model.js";
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

describe("mortal wounds outside the attack", () => {
  const manual = (contribution: import("@alpaca-software/40kdc-data").Buff["contribution"]) => ({ source: { kind: "manual" as const, label: "t" }, contribution });
  const source = (key: string, expected: number) => ({ key, id: key, moment: null, expected, needs: [], abilityId: key, label: key });

  it("totals only the ticked sources and applies both Feel No Pains to them", () => {
    const sources = [source("a", 2), source("b", 3)];
    const fnp = [manual({ type: "feel-no-pain", threshold: 5 }), manual({ type: "feel-no-pain", threshold: 4, scope: "mortal" })];
    const line = mortalSourceLine(sources, new Set(["b"]), fnp, shooting);
    expect(line.damage).toBe(3);
    // Survives a 5+ (4/6) and then a 4+ against mortal wounds (3/6).
    expect(line.afterFnp).toBeCloseTo(3 * (4 / 6) * (3 / 6), 12);
    expect(mortalSourceLine(sources, new Set(), fnp, shooting)).toEqual({ damage: 0, afterFnp: 0 });
  });

  it("reads a unit's charge mortal wounds with the unit's model count and keys them by moment", () => {
    const unit = ds.units.all.find((entry) => entry.raw.ability_ids?.some((ref) => (typeof ref === "string" ? ref : ref.id) === "krushin-impetus-orks"));
    expect(unit).toBeDefined();
    const { sources, error } = memberMortalSources(ds, { unitId: unit!.id, factionId: unit!.raw.faction_id, detachmentId: null, attachedUnitIds: [], supportUnitIds: [] }, shooting);
    expect(error).toBeUndefined();
    const krushin = sources.find((entry) => entry.abilityId === "krushin-impetus-orks");
    expect(krushin?.key).toBe(mortalSourceKey(krushin!));
    expect(krushin?.moment).toBe("move-ended:charge");
    // One die per model: the expectation grows with the unit's default model count.
    const more = memberMortalSources(ds, { unitId: unit!.id, factionId: unit!.raw.faction_id, detachmentId: null, attachedUnitIds: [], supportUnitIds: [] }, { ...shooting, attackerModelCount: 100 });
    expect(more.sources.find((entry) => entry.abilityId === "krushin-impetus-orks")!.expected).toBeGreaterThan(krushin!.expected);
  });
});
