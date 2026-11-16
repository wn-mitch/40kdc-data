import { describe, expect, it } from "vitest";

import { parseDumpStat, profileStatline, statlineNameKey } from "../src/mfm/unit-stats.js";

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
