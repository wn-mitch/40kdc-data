import { describe, expect, it } from "vitest";
import { decodePlan, encodePlan, sanitizePlan } from "./share-plan";
import type { Placement, TeamPlan } from "./coverage";

const plan: TeamPlan = {
  teamName: "The Houndpack",
  size: 8,
  players: [
    {
      id: "a",
      name: "Will",
      factionIds: ["world-eaters"],
      armies: [{ id: "hil", name: "Houndpack + Infernal Lance", detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] }],
      preferences: [
        { armyId: "hil", disposition: "reconnaissance", tier: "want" },
        { armyId: "hil", disposition: "take-and-hold", tier: "pref" },
      ],
      locked: { reconnaissance: "hil" },
    },
    {
      id: "b",
      name: "Matt",
      factionIds: ["world-eaters"],
      armies: [{ id: "w", name: "Warband", detachmentIds: ["berzerker-warband"] }],
      preferences: [{ armyId: "w", disposition: "purge-the-foe", tier: "could" }],
      locked: {},
    },
  ],
};

describe("encode/decode round trip", () => {
  it("round-trips armies, preferences, and locks losslessly", () => {
    const result = decodePlan(encodePlan(plan));
    expect(result).not.toBeNull();
    expect(result!.plan).toEqual(plan);
    expect(result!.dropped).toEqual([]);
  });

  it("preserves preference band + rank order across a round trip", () => {
    const result = decodePlan(encodePlan(plan))!;
    expect(result.plan.players[0].preferences).toEqual([
      { armyId: "hil", disposition: "reconnaissance", tier: "want" },
      { armyId: "hil", disposition: "take-and-hold", tier: "pref" },
    ]);
  });
});

describe("defensive decode", () => {
  it("returns null on a garbage token", () => {
    expect(decodePlan("this-is-not-a-valid-token!!!")).toBeNull();
  });

  it("returns null when the payload has no players array", () => {
    const token = encodePlan({ teamName: "x", size: 5 } as unknown as TeamPlan);
    expect(decodePlan(token)).toBeNull();
  });

  it("drops unknown faction ids and reports them", () => {
    const stale: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        { id: "a", name: "P", factionIds: ["world-eaters", "squats-1998"], armies: [], preferences: [], locked: {} },
      ],
    };
    const result = decodePlan(encodePlan(stale))!;
    expect(result.plan.players[0].factionIds).toEqual(["world-eaters"]);
    expect(result.dropped).toContain("squats-1998");
  });

  it("drops army detachments that don't resolve, then prunes empty armies", () => {
    const stale: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        {
          id: "a",
          name: "P",
          factionIds: ["world-eaters"],
          armies: [
            { id: "a1", name: "Mix", detachmentIds: ["goretrack-onslaught", "made-up-detachment"] },
            { id: "a2", name: "Empty", detachmentIds: ["also-fake"] },
          ],
          preferences: [],
          locked: {},
        },
      ],
    };
    const result = decodePlan(encodePlan(stale))!;
    expect(result.plan.players[0].armies).toEqual([
      { id: "a1", name: "Mix", detachmentIds: ["goretrack-onslaught"] },
    ]);
    expect(result.dropped).toEqual(expect.arrayContaining(["made-up-detachment", "also-fake"]));
  });

  it("backfills missing placements and drops stale ones via syncPreferences", () => {
    const raw = {
      teamName: "T",
      size: 5,
      players: [
        {
          id: "a",
          name: "P",
          factionIds: ["world-eaters"],
          armies: [{ id: "a1", name: "A", detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] }],
          // Only one of the two capabilities placed; the other must be backfilled.
          preferences: [{ armyId: "a1", disposition: "reconnaissance", tier: "want" }],
          locked: {},
        },
      ],
    };
    const prefs = decodePlan(encodePlan(raw as unknown as TeamPlan))!.plan.players[0].preferences;
    expect(prefs).toContainEqual({ armyId: "a1", disposition: "reconnaissance", tier: "want" });
    expect(prefs).toContainEqual({ armyId: "a1", disposition: "take-and-hold", tier: "could" });
  });

  it("drops a lock whose army can't field the disposition", () => {
    const raw = {
      teamName: "T",
      size: 5,
      players: [
        {
          id: "a",
          name: "P",
          factionIds: ["world-eaters"],
          armies: [{ id: "a1", name: "A", detachmentIds: ["goretrack-onslaught"] }], // take-and-hold only
          preferences: [],
          locked: { "take-and-hold": "a1", reconnaissance: "a1" }, // recon lock is invalid
        },
      ],
    };
    const result = decodePlan(encodePlan(raw as unknown as TeamPlan))!;
    expect(result.plan.players[0].locked).toEqual({ "take-and-hold": "a1" });
  });

  it("drops invalid placement tiers and reports unknown disposition keys", () => {
    const raw = {
      teamName: "T",
      size: 5,
      players: [
        {
          id: "a",
          name: "P",
          factionIds: ["world-eaters"],
          armies: [{ id: "a1", name: "A", detachmentIds: ["goretrack-onslaught"] }],
          preferences: [
            { armyId: "a1", disposition: "take-and-hold", tier: "bogus" },
            { armyId: "a1", disposition: "not-a-disposition", tier: "want" },
          ],
          locked: {},
        },
      ],
    };
    const result = decodePlan(encodePlan(raw as unknown as TeamPlan))!;
    // bogus tier dropped; syncPreferences backfills take-and-hold as could.
    expect(result.plan.players[0].preferences).toEqual([
      { armyId: "a1", disposition: "take-and-hold", tier: "could" },
    ]);
    expect(result.dropped).toContain("not-a-disposition");
  });
});

describe("legacy migration (pre-army v1 plans)", () => {
  it("turns an unnarrowed legacy player into one army covering every faction detachment", () => {
    const legacy = {
      teamName: "Old",
      size: 5,
      players: [{ id: "a", name: "P", factionIds: ["world-eaters"], detachmentIds: null, intent: {} }],
    };
    const result = sanitizePlan(legacy)!;
    const p = result.plan.players[0];
    expect(p.armies).toHaveLength(1);
    expect(p.armies[0].name).toBe("Army 1");
    // World Eaters span all five dispositions, so the migrated army does too.
    const dispos = new Set(p.preferences.map((pl) => pl.disposition));
    expect(dispos.size).toBe(5);
  });

  it("maps legacy intent (prefer→want, leaning→pref) onto the migrated army", () => {
    const legacy = {
      teamName: "Old",
      size: 5,
      players: [
        {
          id: "a",
          name: "P",
          factionIds: ["world-eaters"],
          detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"],
          intent: { reconnaissance: "prefer", "take-and-hold": "leaning" },
        },
      ],
    };
    const p = sanitizePlan(legacy)!.plan.players[0];
    const byDispo = Object.fromEntries(p.preferences.map((pl: Placement) => [pl.disposition, pl.tier]));
    expect(byDispo["reconnaissance"]).toBe("want");
    expect(byDispo["take-and-hold"]).toBe("pref");
    expect(p.armies[0].detachmentIds).toEqual(["khorne-daemonkin", "goretrack-onslaught"]);
    expect(p.locked).toEqual({});
  });
});
