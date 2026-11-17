import { describe, expect, it } from "vitest";

import { applyStatlineSource } from "../src/mfm/model-flags.js";
import { attributeStatlines, parseDumpStat, profileStatline, statlineNameKey } from "../src/mfm/unit-stats.js";

// Fabricated statlines and names; only the dump's string formats are kept.
const line = (M: string, T = "4") => ({ M, T, W: "2", Sv: "3+", Ld: "6+", OC: "1" });

describe("parseDumpStat", () => {
  it("reads Move inches, Save and Leadership pluses, and bare digits", () => {
    expect(parseDumpStat('12"')).toBe(12);
    expect(parseDumpStat("3+")).toBe(3);
    expect(parseDumpStat("10")).toBe(10);
  });

  it("prints no number for a dash, N/A or nothing", () => {
    for (const raw of ["-", "N/A", "", null, undefined]) expect(parseDumpStat(raw)).toBeNull();
  });
});

describe("profileStatline", () => {
  it("takes the miniature with the profile's name, whatever the apostrophe or case", () => {
    expect(statlineNameKey("Lord Al’Vex")).toBe(statlineNameKey("lord al'vex"));
    const visible = [{ name: "Trooper", statline: line('6"') }, { name: "Lord Al'Vex", statline: line('8"', "5") }];
    expect(profileStatline({ name: "Lord Al’Vex" }, 2, visible)).toEqual(line('8"', "5"));
  });

  it("gives a one-profile unit the statline its miniatures share, but not one they disagree on", () => {
    const shared = [{ name: "Leader", statline: line('6"') }, { name: "Trooper", statline: line('6"') }];
    expect(profileStatline({ name: "Squad" }, 1, shared)).toEqual(line('6"'));
    const split = [{ name: "Leader", statline: line('6"', "5") }, { name: "Trooper", statline: line('6"') }];
    expect(profileStatline({ name: "Squad" }, 1, split)).toBeNull();
  });

  it("does not guess a profile of a several-profile unit that no miniature names", () => {
    // A unit with a second profile the dump no longer prints keeps it, unattributed.
    expect(profileStatline({ name: "Handler" }, 2, [{ name: "Grot", statline: line('6"') }])).toBeNull();
  });
});

describe("attributeStatlines", () => {
  it("renames the one profile no miniature names to the one miniature no profile names", () => {
    const visible = [{ name: "Trooper", statline: line('6"') }, { name: "Veteran Leader", statline: line('6"', "5") }];
    expect(attributeStatlines([{ name: "Trooper" }, { name: "Leader" }], visible)).toEqual([
      { statline: line('6"') },
      { statline: line('6"', "5"), rename: "Veteran Leader" },
    ]);
  });

  it("does not pair when two profiles or two miniatures are left over", () => {
    const visible = [{ name: "A", statline: line('6"') }, { name: "B", statline: line('7"') }];
    expect(attributeStatlines([{ name: "X" }, { name: "Y" }], visible)).toEqual([{ statline: null }, { statline: null }]);
    expect(attributeStatlines([{ name: "A2" }, { name: "Z" }], [...visible, { name: "C", statline: line('8"') }]).every((e) => e.rename === undefined)).toBe(true);
  });
});

describe("applyStatlineSource", () => {
  const profiles = new Set(["Trooper", "Sergeant"]);

  it("points a row that repeats another model's statline at that model's profile", () => {
    const row: { name: string; profile_name?: string | null } = { name: "Champion" };
    expect(applyStatlineSource(row, new Map([["Champion", "Trooper"]]), profiles)).toBe(true);
    expect(row.profile_name).toBe("Trooper");
  });

  it("drops a profile_name naming another model when the row prints its own statline, and keeps a redundant one", () => {
    const stale: { name: string; profile_name?: string | null } = { name: "Sergeant", profile_name: "Trooper" };
    expect(applyStatlineSource(stale, new Map([["Sergeant", "Sergeant"]]), profiles)).toBe(true);
    expect(stale.profile_name).toBeUndefined();
    const redundant = { name: "Sergeant", profile_name: "Sergeant" };
    expect(applyStatlineSource(redundant, new Map([["Sergeant", "Sergeant"]]), profiles)).toBe(false);
    expect(redundant.profile_name).toBe("Sergeant");
  });

  it("leaves the row alone when the dump names no source or one the unit has no profile for", () => {
    const row = { name: "Champion", profile_name: "Trooper" };
    expect(applyStatlineSource(row, new Map(), profiles)).toBe(false);
    expect(applyStatlineSource(row, new Map([["Champion", "Ghost"]]), profiles)).toBe(false);
    expect(row.profile_name).toBe("Trooper");
  });
});
