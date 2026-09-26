import { describe, it, expect } from "vitest";

import { Dataset } from "../src/data/dataset.js";

/**
 * Guards the base_size_mm population against regression. Thresholds are absolute
 * floors (~3% below the current populated counts) so adding or retiring a handful
 * of units won't make the suite flaky, while a broken reconcile — which would drop
 * counts sharply — still fails. The residual is what the dump cannot express: its
 * Hull / Flying Base / Unique categories, its bare multi-value lists, and units
 * with no datasheet at all (see data/core/_reports/mfm-base-sizes.md).
 */
describe("base_size_mm coverage", () => {
  const ds = Dataset.embedded();
  const units = ds.units.all.map((u) => u.raw);
  const isVehicle = (u: (typeof units)[number]) =>
    (u.keywords ?? []).some((k) => /vehicle|aircraft/i.test(k));

  const populated = units.filter((u) => u.base_size_mm != null);
  const nonVehicle = units.filter((u) => !isVehicle(u));
  const nonVehiclePopulated = nonVehicle.filter((u) => u.base_size_mm != null);
  const authoritative = populated.filter((u) => !u.base_size_mm?.draft);

  it("populates most units (categorical)", () => {
    // Current: 1073/1096 unique. Floor set below to guard regression, not drift.
    expect(populated.length).toBeGreaterThanOrEqual(1040);
  });

  it("populates the large majority of non-vehicle units", () => {
    // Current: 771/788 ≈ 97.8%; the residual is Hull/Flying-Base categories and bare lists.
    expect(nonVehiclePopulated.length).toBeGreaterThanOrEqual(745);
    expect(nonVehiclePopulated.length / nonVehicle.length).toBeGreaterThanOrEqual(0.95);
  });

  it("most populated bases are authoritative (non-draft) round/oval values", () => {
    // Current: 918 authoritative.
    expect(authoritative.length).toBeGreaterThanOrEqual(890);
  });

  it("carries provisional flying/hull/unique bases as draft for later authoring", () => {
    const draft = populated.filter((u) => u.base_size_mm?.draft);
    expect(draft.length).toBeGreaterThanOrEqual(100);
    // Every draft unit is a category, never a plain round/oval authoritative value.
    for (const u of draft) {
      expect(["flying-base", "hull", "unique", "round", "oval"]).toContain(u.base_size_mm!.shape);
    }
  });

  it("matches known authoritative sizes", () => {
    const base = (id: string) => ds.units.getAny(id)?.raw.base_size_mm;
    expect(base("intercessor-squad")).toEqual({ shape: "round", diameter: 32 });
    expect(base("vertus-praetors")).toEqual({ shape: "oval", width: 75, length: 42 });
    expect(base("windriders")).toEqual({ shape: "flying-base", size: "small", draft: true });
    // Re-authored from the MFM dump, which has it at 90mm (the guide said 40mm).
    expect(base("ctan-shard-of-the-nightbringer")).toEqual({ shape: "round", diameter: 90 });
  });

  it("resolves mixed squads per-model via composition", () => {
    const comp = ds.unitCompositions.find((c) => c.unit_id === "jakhals");
    const byName = new Map(comp!.models.map((m) => [m.name, m.base_size_mm]));
    expect(byName.get("Dishonoured")).toEqual({ shape: "round", diameter: 40 });
    expect(byName.get("Jakhal")).toEqual({ shape: "round", diameter: 28.5 });
    // Representative unit-level base is the bulk model (Jakhal), not the 40mm Dishonoured.
    expect(ds.units.getAny("jakhals")?.raw.base_size_mm).toEqual({ shape: "round", diameter: 28.5 });
  });
});
