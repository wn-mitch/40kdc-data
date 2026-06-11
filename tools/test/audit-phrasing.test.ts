import { describe, expect, it } from "vitest";
import {
  classifyPhrasing,
  auditPhrasing,
  loadFactions,
  type PhrasingFlag,
} from "../src/audit-phrasing.js";

describe("classifyPhrasing", () => {
  it("returns no flags for clean prose", () => {
    expect(classifyPhrasing("+1 to hit rolls for the unit")).toEqual([]);
  });

  it("flags an empty / whitespace string as empty and nothing else", () => {
    expect(classifyPhrasing("")).toEqual<PhrasingFlag[]>(["empty"]);
    expect(classifyPhrasing("   \n  ")).toEqual<PhrasingFlag[]>(["empty"]);
  });

  it("flags a leftover ? placeholder", () => {
    expect(classifyPhrasing("modify OC of unit by ?")).toContain("placeholder");
  });

  it("flags an unmapped [type] fallback", () => {
    expect(classifyPhrasing("the unit gains [grant]")).toContain("type_fallback");
  });

  it("flags a raw snake_case identifier that leaked into prose", () => {
    expect(classifyPhrasing("reduce invuln_sv of the unit")).toContain("snake_case_leftover");
  });

  it("flags doubled prepositions", () => {
    expect(classifyPhrasing("at on model destroyed:")).toContain("doubled_preposition");
  });

  it("flags 0-inch movement noise", () => {
    expect(classifyPhrasing('move up to 0" toward the nearest enemy')).toContain("zero_inch");
  });

  it("flags (s) pluralization stubs", () => {
    expect(classifyPhrasing("no more model(s)")).toContain("paren_plural");
  });

  it("can flag multiple defects on one string, in union order", () => {
    // placeholder before snake_case_leftover before paren_plural per PhrasingFlag order
    expect(classifyPhrasing("modify invuln_sv by ? per model(s)")).toEqual<PhrasingFlag[]>([
      "placeholder",
      "snake_case_leftover",
      "paren_plural",
    ]);
  });
});

describe("auditPhrasing", () => {
  it("catalogues one row per ability and aggregates per faction + per flag", () => {
    const report = auditPhrasing([
      {
        faction: "test-b",
        abilities: [
          // Empty modifier → describer renders "reduce incoming damage to self by ?".
          {
            ability_id: "broken-grant",
            effect: { type: "damage-reduction", target: "self", modifier: {} } as never,
          },
        ],
      },
      {
        faction: "test-a",
        abilities: [
          { ability_id: "clean-deep-strike", effect: { type: "deep-strike" } as never },
          { ability_id: "another-clean", effect: { type: "deep-strike" } as never },
        ],
      },
    ]);

    expect(report.total).toBe(3);
    expect(report.byFaction).toHaveLength(2);
    // faction-sorted
    expect(report.byFaction.map((f) => f.faction)).toEqual(["test-a", "test-b"]);
    expect(report.byFaction.find((f) => f.faction === "test-b")?.flagged).toBe(1);
    expect(report.byFaction.find((f) => f.faction === "test-a")?.flagged).toBe(0);

    // rows sorted by faction then ability_id
    expect(report.rows.map((r) => r.ability_id)).toEqual([
      "another-clean",
      "clean-deep-strike",
      "broken-grant",
    ]);

    const broken = report.rows.find((r) => r.ability_id === "broken-grant")!;
    expect(broken.flags).toContain("placeholder");
    expect(report.flagged).toBe(1);
    expect(report.byFlag.find((b) => b.flag === "placeholder")?.count).toBe(1);
  });

  it("names a missing ability by its id", () => {
    const report = auditPhrasing([
      { faction: "f", abilities: [{ ability_id: "nameless", effect: { type: "deep-strike" } as never }] },
    ]);
    expect(report.rows[0].name).toBe("nameless");
  });
});

describe("auditPhrasing over the real enrichment corpus", () => {
  const report = auditPhrasing(loadFactions());

  it("catalogues the full corpus (one row per authored ability)", () => {
    const expected = loadFactions().reduce((n, f) => n + f.abilities.length, 0);
    expect(report.total).toBe(expected);
    expect(report.total).toBeGreaterThan(2000); // ~3,194 today; guards against an empty walk
  });

  it("keeps per-faction totals internally consistent with the rows", () => {
    const rowsByFaction = new Map<string, number>();
    for (const r of report.rows) rowsByFaction.set(r.faction, (rowsByFaction.get(r.faction) ?? 0) + 1);
    for (const f of report.byFaction) expect(rowsByFaction.get(f.faction)).toBe(f.total);
    const summed = report.byFaction.reduce((n, f) => n + f.total, 0);
    expect(summed).toBe(report.total);
  });

  it("produces a real worklist — there are phrasing defects to fix on main today", () => {
    expect(report.flagged).toBeGreaterThan(0);
    expect(report.byFlag.length).toBeGreaterThan(0);
    // every row carries the full identity + text the CSV/JSON artifacts depend on
    for (const r of report.rows.slice(0, 50)) {
      expect(typeof r.text).toBe("string");
      expect(r.ability_id.length).toBeGreaterThan(0);
    }
  });
});
