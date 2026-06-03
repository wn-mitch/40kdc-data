import { describe, it, expect } from "vitest";

import {
  parseBaseSize,
  foldName,
  buildGuideIndex,
  buildBevyIndex,
  assignBaseSizes,
  type GuideRow,
  type UnitInput,
} from "../src/converters/base-size-bridge.js";

describe("parseBaseSize", () => {
  it("parses round bases, including decimals and loose spacing", () => {
    expect(parseBaseSize("32mm")).toEqual({ ok: true, base: { shape: "round", diameter: 32 } });
    expect(parseBaseSize("28.5mm")).toEqual({ ok: true, base: { shape: "round", diameter: 28.5 } });
    expect(parseBaseSize("  60 mm ")).toEqual({ ok: true, base: { shape: "round", diameter: 60 } });
  });

  it("parses oval bases with x/×, decimals, and the 'Oval Base' suffix", () => {
    expect(parseBaseSize("60 x 35.5mm Oval Base")).toEqual({
      ok: true,
      base: { shape: "oval", width: 60, length: 35.5 },
    });
    expect(parseBaseSize("120x92mm")).toEqual({ ok: true, base: { shape: "oval", width: 120, length: 92 } });
    expect(parseBaseSize("105×70mm")).toEqual({ ok: true, base: { shape: "oval", width: 105, length: 70 } });
  });

  it("maps categories to draft entries; large flying base gets its attested oval", () => {
    expect(parseBaseSize("Hull")).toEqual({ ok: true, base: { shape: "hull", draft: true } });
    expect(parseBaseSize("Unique")).toEqual({ ok: true, base: { shape: "unique", draft: true } });
    expect(parseBaseSize("Small Flying Base")).toEqual({
      ok: true,
      base: { shape: "flying-base", size: "small", draft: true },
    });
    expect(parseBaseSize("Large Flying Base")).toEqual({
      ok: true,
      base: { shape: "flying-base", size: "large", draft: true, width: 120, length: 92 },
    });
  });

  it("reports empty and unparseable strings distinctly", () => {
    expect(parseBaseSize("")).toEqual({ ok: false, reason: "empty" });
    expect(parseBaseSize("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseBaseSize("see datasheet")).toEqual({ ok: false, reason: "unparseable" });
  });
});

describe("foldName", () => {
  it("matches the id-generator fold (diacritics, apostrophes, kebab)", () => {
    expect(foldName("Jakhals")).toBe("jakhals");
    expect(foldName("T’au Empire")).toBe("tau-empire");
    expect(foldName("Brôkhyr Iron-master")).toBe("brokhyr-iron-master");
  });
});

describe("buildGuideIndex", () => {
  it("records a bare row as the default and a 'Unit: Model' row as an override", () => {
    const rows: GuideRow[] = [
      { unit: "Jakhals", raw: "28.5mm" },
      { unit: "Jakhals", model: "Dishonoured", raw: "40mm" },
    ];
    const { byUnit } = buildGuideIndex(rows);
    const entry = byUnit.get("jakhals")!;
    expect(entry.default).toEqual({ shape: "round", diameter: 28.5 });
    expect(entry.overrides.get("dishonoured")).toEqual({ shape: "round", diameter: 40 });
  });

  it("splits shared 'A/B' rows across both units", () => {
    const rows: GuideRow[] = [{ unit: "Skitarii Rangers/Skitarii Vanguard", raw: "25mm" }];
    const { byUnit } = buildGuideIndex(rows);
    expect(byUnit.get("skitarii-rangers")!.default).toEqual({ shape: "round", diameter: 25 });
    expect(byUnit.get("skitarii-vanguard")!.default).toEqual({ shape: "round", diameter: 25 });
  });
});

describe("buildBevyIndex", () => {
  it("keeps a unit only when its model rows agree on a single base", () => {
    const index = buildBevyIndex({
      datasheets: [
        { id: "a", name: "Sicaran Battle Tank" },
        { id: "b", name: "Wolf Scouts" },
      ],
      models: [
        { datasheet_id: "a", base_size: "Hull" },
        { datasheet_id: "b", base_size: "32mm" },
        { datasheet_id: "b", base_size: "32mm" },
      ],
    });
    expect(index.get("wolf-scouts")).toEqual({ shape: "round", diameter: 32 });
    expect(index.get("sicaran-battle-tank")).toEqual({ shape: "hull", draft: true });
  });

  it("omits a unit whose rows disagree", () => {
    const index = buildBevyIndex({
      datasheets: [{ id: "a", name: "Mixed Squad" }],
      models: [
        { datasheet_id: "a", base_size: "32mm" },
        { datasheet_id: "a", base_size: "40mm" },
      ],
    });
    expect(index.has("mixed-squad")).toBe(false);
  });
});

describe("assignBaseSizes", () => {
  const jakhals: UnitInput = {
    id: "jakhals",
    models: [
      { name: "Jakhal Pack Leader", min: 1, max: 1, is_leader_model: true },
      { name: "Dishonoured", min: 1, max: 2 },
      { name: "Jakhal", min: 8, max: 17 },
    ],
  };

  it("resolves a mixed squad per-model and picks the bulk model as representative", () => {
    const guide = buildGuideIndex([
      { unit: "Jakhals", raw: "28.5mm" },
      { unit: "Jakhals", model: "Dishonoured", raw: "40mm" },
    ]);
    const { assignments, report } = assignBaseSizes([jakhals], guide, new Map());
    const a = assignments.get("jakhals")!;
    // Bulk model (Jakhal, max 17) drives the representative base.
    expect(a.unitBase).toEqual({ shape: "round", diameter: 28.5 });
    expect(a.source).toBe("guide");
    expect(a.modelBases.get("Dishonoured")).toEqual({ shape: "round", diameter: 40 });
    expect(a.modelBases.get("Jakhal Pack Leader")).toEqual({ shape: "round", diameter: 28.5 });
    expect(a.modelBases.get("Jakhal")).toEqual({ shape: "round", diameter: 28.5 });
    expect(report.unmatched).toHaveLength(0);
    expect(report.unresolvedModels).toHaveLength(0);
  });

  it("falls back to bevy when the guide omits a unit, and records it", () => {
    const unit: UnitInput = { id: "wolf-scouts", models: [{ name: "Wolf Scout", min: 5, max: 10 }] };
    const guide = buildGuideIndex([]);
    const bevy = new Map([["wolf-scouts", { shape: "round" as const, diameter: 32 }]]);
    const { assignments, report } = assignBaseSizes([unit], guide, bevy);
    expect(assignments.get("wolf-scouts")!.unitBase).toEqual({ shape: "round", diameter: 32 });
    expect(assignments.get("wolf-scouts")!.source).toBe("bevy");
    expect(report.bevyFallback).toContain("wolf-scouts");
  });

  it("leaves a unit unmatched when no source has it", () => {
    const unit: UnitInput = { id: "homebrew", models: [{ name: "Homebrew", min: 1, max: 1 }] };
    const { assignments, report } = assignBaseSizes([unit], buildGuideIndex([]), new Map());
    expect(assignments.get("homebrew")!.unitBase).toBeUndefined();
    expect(report.unmatched).toContain("homebrew");
    expect(report.unresolvedModels).toContain("homebrew: Homebrew");
  });

  it("carries the draft flag from a flying-base model to the representative", () => {
    const unit: UnitInput = { id: "windriders", models: [{ name: "Windrider", min: 3, max: 6 }] };
    const guide = buildGuideIndex([{ unit: "Windriders", raw: "Small Flying Base" }]);
    const { assignments } = assignBaseSizes([unit], guide, new Map());
    expect(assignments.get("windriders")!.unitBase).toEqual({
      shape: "flying-base",
      size: "small",
      draft: true,
    });
  });
});
