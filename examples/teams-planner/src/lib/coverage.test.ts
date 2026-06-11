import { describe, expect, it } from "vitest";
import {
  candidateDetachments,
  factionOptions,
  playerCoverage,
  teamCoverage,
  type Player,
  type TeamPlan,
} from "./coverage";

function player(over: Partial<Player>): Player {
  return {
    id: "x",
    name: "P",
    factionIds: ["world-eaters"],
    detachmentIds: null,
    intent: {},
    ...over,
  };
}

// World Eaters span all five dispositions across their detachments, so they're
// a stable fixture for both "covers everything" and "narrowed to a gap".
//   goretrack-onslaught → take-and-hold
//   butchers-of-khorne  → disruption
//   khorne-daemonkin    → reconnaissance
//   vessels-of-wrath    → priority-assets
//   berzerker-warband   → purge-the-foe

describe("playerCoverage", () => {
  it("covers every disposition a faction's detachments grant when unnarrowed", () => {
    const cov = playerCoverage(player({}));
    expect([...cov].sort()).toEqual(
      ["disruption", "priority-assets", "purge-the-foe", "reconnaissance", "take-and-hold"].sort(),
    );
  });

  it("narrows coverage to exactly the chosen detachment's dispositions", () => {
    const cov = playerCoverage(player({ detachmentIds: ["goretrack-onslaught"] }));
    expect([...cov]).toEqual(["take-and-hold"]);
  });

  it("an empty narrowing list covers nothing", () => {
    expect(playerCoverage(player({ detachmentIds: [] })).size).toBe(0);
  });

  it("unions dispositions across multiple narrowed detachments", () => {
    const cov = playerCoverage(
      player({ detachmentIds: ["goretrack-onslaught", "butchers-of-khorne"] }),
    );
    expect([...cov].sort()).toEqual(["disruption", "take-and-hold"]);
  });
});

describe("candidateDetachments", () => {
  it("ignores narrowed ids that don't belong to the player's factions", () => {
    const cand = candidateDetachments(
      player({ detachmentIds: ["goretrack-onslaught", "not-a-real-detachment"] }),
    );
    expect(cand.map((d) => d.id)).toEqual(["goretrack-onslaught"]);
  });

  it("returns narrowed detachments in the player's rank order, not name order", () => {
    // Name order would be [butchers-of-khorne, goretrack-onslaught]; the rank
    // (detachmentIds order) is the reverse, and that's what must come back.
    const cand = candidateDetachments(
      player({ detachmentIds: ["goretrack-onslaught", "butchers-of-khorne"] }),
    );
    expect(cand.map((d) => d.id)).toEqual(["goretrack-onslaught", "butchers-of-khorne"]);
  });
});

describe("teamCoverage", () => {
  it("flags gaps and marks the team not ready when a disposition is uncovered", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [player({ id: "a", detachmentIds: ["khorne-daemonkin"] })], // reconnaissance only
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
      players: [player({ id: "a" })], // unnarrowed World Eaters → all five
    };
    const cov = teamCoverage(plan);
    expect(cov.ready).toBe(true);
    expect(cov.gaps).toEqual([]);
    expect(cov.perPlayer.get("a")?.size).toBe(5);
  });

  it("attributes each disposition to every player who can field it", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 8,
      players: [
        player({ id: "a", detachmentIds: ["goretrack-onslaught"] }), // take-and-hold
        player({ id: "b" }), // all five
      ],
    };
    const cov = teamCoverage(plan);
    expect(cov.byDisposition["take-and-hold"].map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(cov.byDisposition["disruption"].map((p) => p.id)).toEqual(["b"]);
  });
});

describe("teamCoverage intent rollup", () => {
  it("groups players by stated intent per disposition", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        player({ id: "a", intent: { "take-and-hold": "prefer", disruption: "leaning" } }),
        player({ id: "b", intent: { "take-and-hold": "leaning" } }),
      ],
    };
    const r = teamCoverage(plan).intentByDisposition;
    expect(r["take-and-hold"].prefer.map((p) => p.id)).toEqual(["a"]);
    expect(r["take-and-hold"].leaning.map((p) => p.id)).toEqual(["b"]);
    expect(r["disruption"].leaning.map((p) => p.id)).toEqual(["a"]);
    expect(r["reconnaissance"]).toEqual({ prefer: [], leaning: [] });
  });

  it("ignores intent for a disposition the player can't actually field", () => {
    const plan: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        // Narrowed to take-and-hold only, but states a reconnaissance preference.
        player({
          id: "a",
          detachmentIds: ["goretrack-onslaught"],
          intent: { "take-and-hold": "prefer", reconnaissance: "prefer" },
        }),
      ],
    };
    const r = teamCoverage(plan).intentByDisposition;
    expect(r["take-and-hold"].prefer.map((p) => p.id)).toEqual(["a"]);
    expect(r["reconnaissance"].prefer).toEqual([]);
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
