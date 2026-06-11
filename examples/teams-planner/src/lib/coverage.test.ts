import { describe, expect, it } from "vitest";
import {
  armyDetachmentPoints,
  armyDispositions,
  columnFull,
  effectivePlacement,
  factionOptions,
  LOCK_CAP,
  placementKey,
  playerCoverage,
  reorder,
  reorderPlacements,
  setPlacementTier,
  syncPreferences,
  teamCoverage,
  type Army,
  type Placement,
  type Player,
  type TeamPlan,
} from "./coverage";

// World Eaters span all five dispositions across their detachments, so they're
// a stable fixture for both "covers everything" and "narrowed to a gap".
//   goretrack-onslaught → take-and-hold      (2 DP)
//   butchers-of-khorne  → disruption         (1 DP)
//   khorne-daemonkin    → reconnaissance     (2 DP)
//   vessels-of-wrath    → priority-assets    (1 DP)
//   berzerker-warband   → purge-the-foe      (3 DP)
//   brazen-engines      → purge-the-foe      (1 DP)

function army(over: Partial<Army>): Army {
  return { id: "a1", name: "Army 1", detachmentIds: [], ...over };
}

function player(over: Partial<Player>): Player {
  const base: Player = {
    id: "x",
    name: "P",
    factionIds: ["world-eaters"],
    armies: [],
    preferences: [],
    locked: {},
  };
  const merged = { ...base, ...over };
  // Default: keep preferences in sync with the pool unless the test set them.
  if (!over.preferences) merged.preferences = syncPreferences(merged);
  return merged;
}

describe("armyDispositions / armyDetachmentPoints", () => {
  it("unions the dispositions a combo's detachments grant", () => {
    const a = army({ detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] });
    expect([...armyDispositions(a)].sort()).toEqual(["reconnaissance", "take-and-hold"].sort());
  });

  it("sums detachment points across the combo", () => {
    // khorne-daemonkin (2) + goretrack-onslaught (2) = 4 (over the soft cap)
    expect(armyDetachmentPoints(army({ detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] }))).toBe(4);
    expect(armyDetachmentPoints(army({ detachmentIds: ["butchers-of-khorne"] }))).toBe(1);
    expect(armyDetachmentPoints(army({ detachmentIds: [] }))).toBe(0);
  });

  it("ignores unknown detachment ids in both", () => {
    const a = army({ detachmentIds: ["not-real", "butchers-of-khorne"] });
    expect([...armyDispositions(a)]).toEqual(["disruption"]);
    expect(armyDetachmentPoints(a)).toBe(1);
  });
});

describe("playerCoverage", () => {
  it("unions dispositions across the whole army pool", () => {
    const cov = playerCoverage(
      player({
        armies: [
          army({ id: "a1", detachmentIds: ["goretrack-onslaught"] }), // take-and-hold
          army({ id: "a2", detachmentIds: ["khorne-daemonkin", "butchers-of-khorne"] }), // recon + disruption
        ],
      }),
    );
    expect([...cov].sort()).toEqual(["disruption", "reconnaissance", "take-and-hold"].sort());
  });

  it("an empty pool covers nothing", () => {
    expect(playerCoverage(player({ armies: [] })).size).toBe(0);
  });
});

describe("syncPreferences", () => {
  it("creates one could-tier placement per (army, disposition) capability", () => {
    const p = player({
      armies: [army({ id: "a1", detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] })],
      preferences: [],
    });
    const prefs = syncPreferences(p);
    expect(prefs).toHaveLength(2);
    expect(prefs.every((pl) => pl.tier === "could")).toBe(true);
    expect(prefs.map((pl) => pl.disposition).sort()).toEqual(["reconnaissance", "take-and-hold"].sort());
  });

  it("preserves existing tier and relative order, appending only new capabilities", () => {
    const existing: Placement[] = [
      { armyId: "a1", disposition: "reconnaissance", tier: "want" },
    ];
    const p = player({
      armies: [army({ id: "a1", detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] })],
      preferences: existing,
    });
    const prefs = syncPreferences(p);
    expect(prefs[0]).toEqual({ armyId: "a1", disposition: "reconnaissance", tier: "want" });
    expect(prefs[1]).toEqual({ armyId: "a1", disposition: "take-and-hold", tier: "could" });
  });

  it("drops placements whose army or capability is gone", () => {
    const p = player({
      armies: [army({ id: "a1", detachmentIds: ["goretrack-onslaught"] })], // only take-and-hold
      preferences: [
        { armyId: "a1", disposition: "take-and-hold", tier: "want" },
        { armyId: "a1", disposition: "reconnaissance", tier: "want" }, // no longer fieldable
        { armyId: "ghost", disposition: "take-and-hold", tier: "want" }, // army gone
      ],
    });
    const prefs = syncPreferences(p);
    expect(prefs).toEqual([{ armyId: "a1", disposition: "take-and-hold", tier: "want" }]);
  });
});

describe("effectivePlacement", () => {
  // The user's worked example: two armies, both can field reconnaissance and
  // take-and-hold among them; Houndpack/IL-style "vastly prefer recon".
  const houndpackIL = army({ id: "hil", name: "Houndpack + Infernal Lance", detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] }); // recon + t&h
  const kdkBrazen = army({ id: "kb", name: "KdK + Brazen", detachmentIds: ["khorne-daemonkin", "brazen-engines"] }); // recon + purge

  it("returns the highest-banded copy, so the example reads recon=want, t&h=pref", () => {
    const p = player({
      armies: [houndpackIL, kdkBrazen],
      preferences: [
        { armyId: "hil", disposition: "reconnaissance", tier: "want" },
        { armyId: "hil", disposition: "take-and-hold", tier: "pref" },
        { armyId: "kb", disposition: "reconnaissance", tier: "pref" },
        { armyId: "kb", disposition: "purge-the-foe", tier: "could" },
      ],
    });
    expect(effectivePlacement(p, "reconnaissance")).toMatchObject({ armyId: "hil", tier: "want" });
    expect(effectivePlacement(p, "take-and-hold")).toMatchObject({ armyId: "hil", tier: "pref" });
    expect(effectivePlacement(p, "purge-the-foe")).toMatchObject({ armyId: "kb", tier: "could" });
    expect(effectivePlacement(p, "disruption")).toBeNull();
  });

  it("breaks tier ties by rank (earliest placement wins)", () => {
    const p = player({
      armies: [houndpackIL, kdkBrazen],
      preferences: [
        { armyId: "kb", disposition: "reconnaissance", tier: "want" },
        { armyId: "hil", disposition: "reconnaissance", tier: "want" },
      ],
    });
    expect(effectivePlacement(p, "reconnaissance")?.armyId).toBe("kb");
  });
});

describe("teamCoverage", () => {
  const wholePool = [
    army({ id: "a1", detachmentIds: ["goretrack-onslaught"] }), // take-and-hold
    army({ id: "a2", detachmentIds: ["butchers-of-khorne"] }), // disruption
    army({ id: "a3", detachmentIds: ["khorne-daemonkin"] }), // reconnaissance
    army({ id: "a4", detachmentIds: ["vessels-of-wrath"] }), // priority-assets
    army({ id: "a5", detachmentIds: ["berzerker-warband"] }), // purge-the-foe
  ];

  it("flags gaps and marks the team not ready when a disposition is uncovered", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [player({ id: "a", armies: [army({ id: "a3", detachmentIds: ["khorne-daemonkin"] })] })], // recon only
    };
    const cov = teamCoverage(plan);
    expect(cov.ready).toBe(false);
    expect(cov.byDisposition["reconnaissance"].map((p) => p.id)).toEqual(["a"]);
    expect(cov.gaps.sort()).toEqual(
      ["disruption", "priority-assets", "purge-the-foe", "take-and-hold"].sort(),
    );
  });

  it("is ready once every disposition has a covering player", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [player({ id: "a", armies: wholePool })],
    };
    const cov = teamCoverage(plan);
    expect(cov.ready).toBe(true);
    expect(cov.gaps).toEqual([]);
    expect(cov.perPlayer.get("a")?.size).toBe(5);
  });

  it("buckets players by their effective tier per disposition", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        player({
          id: "a",
          armies: [army({ id: "a1", detachmentIds: ["goretrack-onslaught", "butchers-of-khorne"] })],
          preferences: [
            { armyId: "a1", disposition: "take-and-hold", tier: "want" },
            { armyId: "a1", disposition: "disruption", tier: "could" },
          ],
        }),
        player({
          id: "b",
          armies: [army({ id: "b1", detachmentIds: ["goretrack-onslaught"] })],
          preferences: [{ armyId: "b1", disposition: "take-and-hold", tier: "pref" }],
        }),
      ],
    };
    const r = teamCoverage(plan).tierByDisposition;
    expect(r["take-and-hold"].want.map((p) => p.id)).toEqual(["a"]);
    expect(r["take-and-hold"].pref.map((p) => p.id)).toEqual(["b"]);
    expect(r["disruption"].could.map((p) => p.id)).toEqual(["a"]);
    expect(r["reconnaissance"]).toEqual({ want: [], pref: [], could: [] });
  });
});

describe("locks and column capacity", () => {
  function locker(id: string): Player {
    return player({
      id,
      armies: [army({ id: `${id}-army`, detachmentIds: ["goretrack-onslaught"] })],
      locked: { "take-and-hold": `${id}-army` },
    });
  }

  it("counts a lock only when the locked army still fields the disposition", () => {
    const valid = locker("a");
    const stale = player({
      id: "b",
      armies: [army({ id: "b-army", detachmentIds: ["khorne-daemonkin"] })], // recon, not t&h
      locked: { "take-and-hold": "b-army" }, // dangling lock
    });
    const cov = teamCoverage({ teamName: "T", size: 5, players: [valid, stale] });
    expect(cov.lockedByDisposition["take-and-hold"].map((p) => p.id)).toEqual(["a"]);
  });

  it("marks a column full once LOCK_CAP players have locked it", () => {
    const players = Array.from({ length: LOCK_CAP }, (_, i) => locker(`p${i}`));
    const cov = teamCoverage({ teamName: "T", size: 5, players });
    expect(cov.lockedByDisposition["take-and-hold"]).toHaveLength(LOCK_CAP);
    expect(columnFull(cov, "take-and-hold")).toBe(true);
    expect(columnFull(cov, "reconnaissance")).toBe(false);
  });
});

describe("reorder primitive", () => {
  const ids = ["a", "b", "c", "d"];
  const id = (s: string) => s;

  it("moves an id down to occupy a later slot, shifting the rest up", () => {
    expect(reorder(ids, "a", "c", id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an id up to occupy an earlier slot, shifting the rest down", () => {
    expect(reorder(ids, "d", "b", id)).toEqual(["a", "d", "b", "c"]);
  });

  it("treats an adjacent move as a swap", () => {
    expect(reorder(ids, "b", "a", id)).toEqual(["b", "a", "c", "d"]);
    expect(reorder(ids, "b", "c", id)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns the input unchanged when the keys are equal or absent", () => {
    expect(reorder(ids, "b", "b", id)).toBe(ids);
    expect(reorder(ids, "z", "a", id)).toBe(ids);
    expect(reorder(ids, "a", "z", id)).toBe(ids);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    reorder(input, "a", "c", id);
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("reorderPlacements / setPlacementTier", () => {
  const prefs: Placement[] = [
    { armyId: "a", disposition: "reconnaissance", tier: "could" },
    { armyId: "a", disposition: "take-and-hold", tier: "could" },
    { armyId: "b", disposition: "purge-the-foe", tier: "could" },
  ];

  it("reorders by placement key", () => {
    const out = reorderPlacements(prefs, "b purge-the-foe", "a reconnaissance");
    expect(out.map(placementKey)).toEqual(["b purge-the-foe", "a reconnaissance", "a take-and-hold"]);
  });

  it("retiers and moves before the target key", () => {
    const out = setPlacementTier(prefs, "b purge-the-foe", "want", "a take-and-hold");
    const moved = out.find((pl) => placementKey(pl) === "b purge-the-foe");
    expect(moved?.tier).toBe("want");
    expect(out.map(placementKey)).toEqual(["a reconnaissance", "b purge-the-foe", "a take-and-hold"]);
  });

  it("retiers and appends when no target key is given", () => {
    const out = setPlacementTier(prefs, "a reconnaissance", "want", null);
    expect(out.map(placementKey)).toEqual(["a take-and-hold", "b purge-the-foe", "a reconnaissance"]);
    expect(out.at(-1)?.tier).toBe("want");
  });

  it("leaves the list unchanged for an unknown key", () => {
    expect(setPlacementTier(prefs, "ghost x", "want")).toBe(prefs);
  });
});

describe("factionOptions", () => {
  it("lists only factions with detachments, sorted by name, including World Eaters", () => {
    const opts = factionOptions();
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((o) => o.id === "world-eaters")).toBe(true);
    const names = opts.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
