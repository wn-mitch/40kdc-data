import { describe, expect, it } from "vitest";
import {
  armyDetachmentPoints,
  armyDispositions,
  autoArmyName,
  columnFull,
  detachmentName,
  detachmentsForFactions,
  dispositionCap,
  factionFieldsDetachment,
  factionKeywordIdentity,
  fdAssignmentIssues,
  reconcileArmyName,
  effectivePlacement,
  factionOptions,
  placementKey,
  sanitizeTeamSize,
  teamLegalityIssues,
  TEAM_SIZES,
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
  return { id: "a1", name: "Army 1", factionId: "world-eaters", detachmentIds: [], ...over };
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
  // The user's worked example transposed onto World Eaters: two armies, between
  // them fielding reconnaissance and take-and-hold; "vastly prefer recon".
  const reconTah = army({ id: "hil", name: "Daemonkin + Goretrack", detachmentIds: ["khorne-daemonkin", "goretrack-onslaught"] }); // recon + t&h
  const reconPurge = army({ id: "kb", name: "Daemonkin + Brazen", detachmentIds: ["khorne-daemonkin", "brazen-engines"] }); // recon + purge

  it("returns the highest-banded copy, so the example reads recon=want, t&h=pref", () => {
    const p = player({
      armies: [reconTah, reconPurge],
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
      armies: [reconTah, reconPurge],
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

  it("marks a column full once dispositionCap players have locked it", () => {
    // Size 5 → cap 1: a single lock fills the column.
    const one = teamCoverage({ teamName: "T", size: 5, players: [locker("p0")] });
    expect(columnFull(5, one, "take-and-hold")).toBe(true);
    // Size 6 → cap 2: one lock leaves the column open, two fill it.
    expect(columnFull(6, one, "take-and-hold")).toBe(false);
    const two = teamCoverage({ teamName: "T", size: 6, players: [locker("p0"), locker("p1")] });
    expect(columnFull(6, two, "take-and-hold")).toBe(true);
    expect(columnFull(6, two, "reconnaissance")).toBe(false);
  });
});

describe("team sizes", () => {
  it("offers 3 through 8 and caps dispositions at ceil(size/5)", () => {
    expect(TEAM_SIZES).toEqual([3, 4, 5, 6, 7, 8]);
    expect(TEAM_SIZES.map(dispositionCap)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it("sanitizes untrusted sizes (legacy 5/6/8 unchanged, junk falls back to 5)", () => {
    for (const n of TEAM_SIZES) expect(sanitizeTeamSize(n)).toBe(n);
    expect(sanitizeTeamSize(9)).toBe(5);
    expect(sanitizeTeamSize(2)).toBe(5);
    expect(sanitizeTeamSize(6.5)).toBe(5);
    expect(sanitizeTeamSize("6")).toBe(5);
    expect(sanitizeTeamSize(undefined)).toBe(5);
  });
});

describe("fdAssignmentIssues", () => {
  it("accepts a distinct assignment at any size", () => {
    expect(fdAssignmentIssues(5, ["take-and-hold", "disruption", "purge-the-foe", "priority-assets", "reconnaissance"])).toEqual([]);
    expect(fdAssignmentIssues(3, ["take-and-hold", "disruption", "reconnaissance"])).toEqual([]);
  });

  it("rejects any repeat on a 3-5 player team", () => {
    const issues = fdAssignmentIssues(5, ["take-and-hold", "take-and-hold", "disruption", "purge-the-foe", "reconnaissance"]);
    expect(issues.map((i) => i.kind).sort()).toEqual(["fd-doubles-before-coverage", "fd-over-cap"]);
  });

  it("allows exactly size-5 repeats on a 6-8 player team", () => {
    const six = ["take-and-hold", "take-and-hold", "disruption", "purge-the-foe", "priority-assets", "reconnaissance"] as const;
    expect(fdAssignmentIssues(6, [...six])).toEqual([]);
    // Two doubles at 6 players means a disposition went uncovered before a repeat.
    const twoDoubles = ["take-and-hold", "take-and-hold", "disruption", "disruption", "purge-the-foe", "reconnaissance"] as const;
    expect(fdAssignmentIssues(6, [...twoDoubles]).map((i) => i.kind)).toEqual(["fd-doubles-before-coverage"]);
  });

  it("at 8 players forces full coverage before repeats", () => {
    const legal = [
      "take-and-hold", "disruption", "purge-the-foe", "priority-assets", "reconnaissance",
      "take-and-hold", "disruption", "purge-the-foe",
    ] as const;
    expect(fdAssignmentIssues(8, [...legal])).toEqual([]);
    // Reconnaissance uncovered while take-and-hold is tripled: both rules fire.
    const illegal = [
      "take-and-hold", "take-and-hold", "take-and-hold", "disruption", "disruption",
      "purge-the-foe", "purge-the-foe", "priority-assets",
    ] as const;
    const kinds = fdAssignmentIssues(8, [...illegal]).map((i) => i.kind);
    expect(kinds).toContain("fd-over-cap");
    expect(kinds).toContain("fd-doubles-before-coverage");
  });
});

describe("factionKeywordIdentity / teamLegalityIssues", () => {
  it("collapses sub-factions onto the parent faction keyword", () => {
    expect(factionKeywordIdentity("crimson-fists")).toBe("adeptus-astartes");
    expect(factionKeywordIdentity("adeptus-astartes")).toBe("adeptus-astartes");
    expect(factionKeywordIdentity("world-eaters")).toBe("world-eaters");
  });

  it("flags two players committed to the same faction keyword", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        player({ id: "a", name: "Ann", factionIds: ["crimson-fists"] }),
        player({ id: "b", name: "Bob", factionIds: ["adeptus-astartes"] }),
        player({ id: "c", name: "Cid", factionIds: ["world-eaters"] }),
      ],
    };
    const issues = teamLegalityIssues(plan);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("duplicate-faction-keyword");
    expect(issues[0].detail).toContain("Ann");
    expect(issues[0].detail).toContain("Bob");
  });

  it("does not flag a player still exploring several keywords", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        player({ id: "a", name: "Ann", factionIds: ["crimson-fists", "world-eaters"] }),
        player({ id: "b", name: "Bob", factionIds: ["adeptus-astartes"] }),
      ],
    };
    expect(teamLegalityIssues(plan)).toEqual([]);
  });

  it("flags locked dispositions over the size cap", () => {
    const lockers = ["a", "b"].map((id) =>
      player({
        id,
        name: id,
        armies: [army({ id: `${id}-army`, detachmentIds: ["goretrack-onslaught"] })],
        locked: { "take-and-hold": `${id}-army` },
      }),
    );
    // Distinct factions would still clash on keyword; keep it to the FD issue.
    lockers[1].factionIds = ["chaos-daemons"];
    const issues = teamLegalityIssues({ teamName: "T", size: 5, players: lockers });
    expect(issues.some((i) => i.kind === "fd-over-cap" && i.detail.includes("take-and-hold"))).toBe(true);
    // The same locks are legal on a 6-player team (cap 2).
    expect(teamLegalityIssues({ teamName: "T", size: 6, players: lockers }).some((i) => i.kind === "fd-over-cap")).toBe(false);
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

describe("autoArmyName / reconcileArmyName", () => {
  const a = "goretrack-onslaught";
  const b = "butchers-of-khorne";
  const nameA = detachmentName(a);
  const nameB = detachmentName(b);

  it("joins detachment names with ' / '", () => {
    expect(autoArmyName([a, b])).toBe(`${nameA} / ${nameB}`);
    expect(autoArmyName([a])).toBe(nameA);
    expect(autoArmyName([])).toBe("");
  });

  it("auto-fills a brand-new (empty) name", () => {
    expect(reconcileArmyName("", [], [a])).toBe(nameA);
  });

  it("keeps the prefix in sync when the name was pure auto", () => {
    expect(reconcileArmyName(nameA, [a], [a, b])).toBe(`${nameA} / ${nameB}`);
  });

  it("preserves appended notes across a combo change", () => {
    const current = `${nameA} (aggressive)`;
    expect(reconcileArmyName(current, [a], [a, b])).toBe(`${nameA} / ${nameB} (aggressive)`);
  });

  it("preserves notes when a detachment is removed", () => {
    const current = `${nameA} / ${nameB} (note)`;
    expect(reconcileArmyName(current, [a, b], [a])).toBe(`${nameA} (note)`);
  });

  it("leaves a fully hand-written name untouched", () => {
    expect(reconcileArmyName("My Custom Build", [], [a])).toBe("My Custom Build");
    expect(reconcileArmyName("Totally Different", [a], [a, b])).toBe("Totally Different");
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

describe("codex-supplement per-faction detachment views", () => {
  const ids = (faction: string) => new Set(detachmentsForFactions([faction]).map((d) => d.id));

  it("offers a Marine supplement the generic Codex detachments plus its own", () => {
    const sw = ids("space-wolves");
    // Generic Codex detachments are now fieldable by the supplement…
    expect(sw.has("gladius-task-force")).toBe(true);
    expect(sw.has("ironstorm-spearhead")).toBe(true);
    // …alongside its own signature detachments…
    expect(sw.has("champions-of-fenris")).toBe(true);
    // …but never another Chapter's locked detachment.
    expect(sw.has("spearpoint-task-force")).toBe(false); // White Scars
    expect(sw.has("hammer-of-avernii")).toBe(false); // Iron Hands
    expect(sw.has("blade-of-ultramar")).toBe(false); // Ultramarines
  });

  it("locks each chapter's signature detachment to that chapter", () => {
    expect(ids("white-scars").has("spearpoint-task-force")).toBe(true);
    expect(ids("raven-guard").has("shadowmark-talon")).toBe(true);
    expect(ids("ultramarines").has("blade-of-ultramar")).toBe(true);
    expect(ids("ultramarines").has("reclamation-force")).toBe(true);
    // The generic parent fields none of the chapter-locked detachments.
    expect(ids("adeptus-astartes").has("spearpoint-task-force")).toBe(false);
  });

  it("matches a shared generic detachment by faction membership, not owning id", () => {
    // gladius is shared, so getInFaction-backed membership is faction-correct…
    expect(factionFieldsDetachment("space-wolves", "gladius-task-force")).toBe(true);
    expect(factionFieldsDetachment("white-scars", "gladius-task-force")).toBe(true);
    // …while a chapter lock stays put.
    expect(factionFieldsDetachment("space-wolves", "spearpoint-task-force")).toBe(false);
  });
});
