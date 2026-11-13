import { describe, expect, it } from "vitest";

import type { Buff } from "../src/cruncher/buffs.js";
import { Dataset } from "../src/data/dataset.js";
import { crunchProfileScorer, profileApplicableBuffs, unitLoadoutDamage } from "../src/stack-damage/unit-damage.js";

const ds = Dataset.embedded();
const nobz = ds.units.getAny("nobz")!.raw;
const target = ds.units.find("Intercessor Squad")!.raw;

const pairedKrumpaReroll = (wargearId?: string, modelScoped = false): Buff => ({
  source: {
    kind: "ability",
    abilityId: "paired-krumpas-orks",
    abilityKind: "unit",
    ...(wargearId ? { wargearId } : {}),
  },
  ...(modelScoped ? { applicableWhen: { modelScoped: true } } : {}),
  contribution: { type: "reroll", roll: "hit", subset: "all-failures" },
});

describe("unitLoadoutDamage model-borne wargear abilities", () => {
  it("applies a Paired Krumpas source only to its bearer group", () => {
    const input = {
      dataset: ds,
      unit: nobz,
      modelCount: 5,
      counts: new Map([
        ["kustom-krumpa", 5],
        ["kustom-shoota-nobz", 4],
        ["paired-krumpas", 1],
      ]),
      target: { unit: target, modelCount: 5 },
      context: { phase: "fight" as const },
      groups: [
        { model_name: "Nob", count: 1, weapons: [{ id: "kustom-krumpa", count: 1 }, { id: "paired-krumpas", count: 1 }] },
        { model_name: "Nob", count: 4, weapons: [{ id: "kustom-krumpa", count: 1 }, { id: "kustom-shoota-nobz", count: 1 }] },
      ],
    };

    const without = unitLoadoutDamage({ ...input, buffs: [] });
    const bearerOnly = unitLoadoutDamage({ ...input, buffs: [pairedKrumpaReroll("paired-krumpas", true)] });
    const sourceBoundUnitRule = unitLoadoutDamage({ ...input, buffs: [pairedKrumpaReroll("paired-krumpas")] });
    const allModels = unitLoadoutDamage({ ...input, buffs: [pairedKrumpaReroll()] });

    expect(bearerOnly.total).toBeGreaterThan(without.total);
    expect(bearerOnly.total).toBeLessThan(allModels.total);
    expect(sourceBoundUnitRule.total).toBe(allModels.total);
    expect(bearerOnly.selected.filter((profile) => profile.weaponId === "kustom-krumpa").map((profile) => profile.count).sort()).toEqual([1, 4]);
  });

  it("omits bearer-only buffs when a multi-model loadout has no groups", () => {
    const input = {
      dataset: ds,
      unit: nobz,
      modelCount: 5,
      counts: new Map([
        ["kustom-krumpa", 5],
        ["kustom-shoota-nobz", 4],
        ["paired-krumpas", 1],
      ]),
      target: { unit: target, modelCount: 5 },
      context: { phase: "fight" as const },
      groups: null,
    };
    const baseline = unitLoadoutDamage({ ...input, buffs: [] });
    const scored = unitLoadoutDamage({ ...input, buffs: [pairedKrumpaReroll("paired-krumpas", true)] });

    expect(scored.total).toBe(baseline.total);
    expect(scored.modelScopedWargearUnresolved).toEqual(["paired-krumpas"]);
  });

  it("rebuilds a custom scorer without omitted model buffs", () => {
    const modelBuff = pairedKrumpaReroll("paired-krumpas", true);
    const seen: (readonly Buff[])[] = [];
    unitLoadoutDamage({
      dataset: ds,
      unit: nobz,
      modelCount: 5,
      counts: new Map([["kustom-krumpa", 5], ["paired-krumpas", 1]]),
      target: { unit: target, modelCount: 5 },
      buffs: [modelBuff],
      context: { phase: "fight" },
      groups: null,
      scoreProfile: crunchProfileScorer(ds, { unit: target, modelCount: 5 }, [modelBuff]),
      scoreProfileForBuffs: (buffs) => {
        seen.push(buffs);
        return crunchProfileScorer(ds, { unit: target, modelCount: 5 }, buffs);
      },
    });

    expect(seen).toEqual([[]]);
  });

  it("scores every bearer in an identified multi-model group", () => {
    const input = {
      dataset: ds,
      unit: nobz,
      modelCount: 2,
      counts: new Map([["kustom-krumpa", 2], ["paired-krumpas", 2]]),
      target: { unit: target, modelCount: 5 },
      context: { phase: "fight" as const },
      groups: [{ model_name: "Nob", count: 2, weapons: [{ id: "kustom-krumpa", count: 1 }, { id: "paired-krumpas", count: 1 }] }],
    };
    const baseline = unitLoadoutDamage({ ...input, buffs: [] });
    const scored = unitLoadoutDamage({ ...input, buffs: [pairedKrumpaReroll("paired-krumpas", true)] });

    expect(scored.modelScopedWargearUnresolved).toBeUndefined();
    expect(scored.total).toBeGreaterThan(baseline.total);
    expect(scored.selected[0]?.modelWargear).toContain("paired-krumpas");
  });

  it("keeps singleton bearer metadata available to attribution", () => {
    const buff = pairedKrumpaReroll("paired-krumpas", true);
    const result = unitLoadoutDamage({
      dataset: ds,
      unit: nobz,
      modelCount: 1,
      counts: new Map([["kustom-krumpa", 1], ["paired-krumpas", 1]]),
      target: { unit: target, modelCount: 5 },
      buffs: [buff],
      context: { phase: "fight" },
      groups: null,
    });

    expect(result.selected[0]?.modelWargear).toContain("paired-krumpas");
    expect(profileApplicableBuffs([buff], result.selected[0]!)).toEqual([buff]);
  });

  it("does not apply a singleton's wargear ability when the item is absent", () => {
    const buff = pairedKrumpaReroll("paired-krumpas", true);
    const input = {
      dataset: ds,
      unit: nobz,
      modelCount: 1,
      counts: new Map([["kustom-krumpa", 1]]),
      target: { unit: target, modelCount: 5 },
      context: { phase: "fight" as const },
      groups: null,
    };
    const baseline = unitLoadoutDamage({ ...input, buffs: [] });
    const result = unitLoadoutDamage({ ...input, buffs: [buff] });
    expect(result.total).toBe(baseline.total);
    expect(profileApplicableBuffs([buff], result.selected[0]!)).toEqual([]);
  });

  it("spends a unit reroll-one permission once across bearer groups", () => {
    const input = {
      dataset: ds,
      unit: nobz,
      modelCount: 5,
      counts: new Map([
        ["kustom-krumpa", 5],
        ["kustom-shoota-nobz", 4],
        ["paired-krumpas", 1],
      ]),
      target: { unit: target, modelCount: 5 },
      context: { phase: "fight" as const },
      groups: [
        { model_name: "Nob", count: 1, weapons: [{ id: "kustom-krumpa", count: 1 }, { id: "paired-krumpas", count: 1 }] },
        { model_name: "Nob", count: 4, weapons: [{ id: "kustom-krumpa", count: 1 }, { id: "kustom-shoota-nobz", count: 1 }] },
      ],
    };
    const modelReroll = pairedKrumpaReroll("paired-krumpas", true);
    const rerollOne: Buff = {
      source: { kind: "manual", label: "unit reroll" },
      contribution: { type: "reroll-one", roll: "hit" },
    };
    const without = unitLoadoutDamage({ ...input, buffs: [modelReroll] });
    const withOne = unitLoadoutDamage({ ...input, buffs: [modelReroll, rerollOne] });

    expect(withOne.total).toBeGreaterThan(without.total);
    expect(withOne.selected.filter((profile, index) => profile.damage !== without.selected[index]!.damage)).toHaveLength(1);
  });

  it("keeps the real Paired Krumpas buffs on one Nob's Kustom Krumpa", () => {
    const buffs = ds
      .buffsFor({ unitId: "nobz", factionId: "orks" }, { phase: "fight" })
      .filter((buff) => buff.source.kind === "ability" && buff.source.abilityId === "paired-krumpas-orks");
    const input = {
      dataset: ds,
      unit: nobz,
      modelCount: 5,
      counts: new Map([
        ["kustom-krumpa", 5],
        ["kustom-shoota-nobz", 4],
        ["paired-krumpas", 1],
      ]),
      target: { unit: target, modelCount: 5 },
      context: { phase: "fight" as const },
      groups: [
        { model_name: "Nob", count: 1, weapons: [{ id: "kustom-krumpa", count: 1 }, { id: "paired-krumpas", count: 1 }] },
        { model_name: "Nob", count: 4, weapons: [{ id: "kustom-krumpa", count: 1 }, { id: "kustom-shoota-nobz", count: 1 }] },
      ],
    };
    const bearerOnly = unitLoadoutDamage({ ...input, buffs });
    const unitWide = unitLoadoutDamage({
      ...input,
      buffs: buffs.map((buff) => buff.source.kind === "ability"
        ? { ...buff, source: { ...buff.source, wargearId: undefined } }
        : buff),
    });

    expect(buffs).toHaveLength(2);
    expect(buffs.map((buff) => buff.source.kind === "ability" ? buff.source.wargearId : undefined)).toEqual(["paired-krumpas", "paired-krumpas"]);
    expect(buffs.map((buff) => buff.applicableWhen?.modelScoped)).toEqual([true, true]);
    expect(bearerOnly.selected.find((profile) => profile.count === 1)?.modelWargear).toContain("paired-krumpas");
    expect(bearerOnly.selected.find((profile) => profile.count === 4)?.modelWargear).not.toContain("paired-krumpas");
    expect(bearerOnly.total).toBeLessThan(unitWide.total);
    expect(bearerOnly.selected.filter((profile) => profile.weaponId === "kustom-krumpa").map((profile) => profile.count).sort()).toEqual([1, 4]);
  });
});
