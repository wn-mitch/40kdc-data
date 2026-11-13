import { describe, expect, it } from "vitest";
import { warlordViolations, type WarlordUnit } from "../src/data/roster-warlord.js";

const row = (flags: Record<string, boolean> = {}) => ({ name: "M", min: 1, max: 1, ...flags });
const unit = (unitId: string, over: Partial<WarlordUnit> = {}): WarlordUnit => ({
  unitId,
  isWarlord: false,
  isCharacter: true,
  rows: [row()],
  ...over,
});
const codes = (units: (WarlordUnit | undefined)[], named: string[] = []) =>
  warlordViolations(units, new Set(named)).map((v) => `${v.code}:${v.id}`);

// Paths no current dataset record reaches (the Titan datasheets that carry
// can_be_non_character_warlord are not in the repo; no model is both flagged).
describe("warlordViolations", () => {
  it("accepts a non-CHARACTER Warlord whose model carries can_be_non_character_warlord", () => {
    const titan = unit("titan", { isWarlord: true, isCharacter: false, rows: [row({ can_be_non_character_warlord: true })] });
    expect(codes([titan])).toEqual([]);
    expect(codes([{ ...titan, rows: [row()] }])).toEqual(["warlord-not-character:titan"]);
  });

  it("lets a unit with one model free of cannot_be_warlord lead", () => {
    const mixed = unit("mixed", { isWarlord: true, rows: [row({ cannot_be_warlord: true }), row()] });
    expect(codes([mixed])).toEqual([]);
  });

  it("drops the Supreme Commander requirement for a model that also cannot be Warlord", () => {
    const both = unit("both", { rows: [row({ is_supreme_commander: true, cannot_be_warlord: true })] });
    expect(codes([both, unit("captain", { isWarlord: true })])).toEqual([]);
  });

  it("lifts cannot_be_warlord for a unit a selected detachment names", () => {
    const jester = unit("jester", { isWarlord: true, rows: [row({ cannot_be_warlord: true })] });
    expect(codes([jester])).toEqual(["cannot-be-warlord:jester"]);
    expect(codes([jester], ["jester"])).toEqual([]);
  });

  it("skips the Supreme Commander check when no Warlord is chosen", () => {
    expect(codes([unit("sc", { rows: [row({ is_supreme_commander: true })] })])).toEqual([]);
  });
});
