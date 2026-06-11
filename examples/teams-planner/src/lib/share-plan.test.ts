import { describe, expect, it } from "vitest";
import { decodePlan, encodePlan } from "./share-plan";
import type { TeamPlan } from "./coverage";

const plan: TeamPlan = {
  teamName: "The Houndpack",
  size: 8,
  players: [
    { id: "a", name: "Will", factionIds: ["world-eaters"], detachmentIds: null },
    {
      id: "b",
      name: "Matt",
      factionIds: ["world-eaters"],
      detachmentIds: ["goretrack-onslaught"],
    },
  ],
};

describe("encode/decode round trip", () => {
  it("round-trips a plan losslessly with nothing dropped", () => {
    const result = decodePlan(encodePlan(plan));
    expect(result).not.toBeNull();
    expect(result!.plan).toEqual(plan);
    expect(result!.dropped).toEqual([]);
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
      players: [{ id: "a", name: "P", factionIds: ["world-eaters", "squats-1998"], detachmentIds: null }],
    };
    const result = decodePlan(encodePlan(stale))!;
    expect(result.plan.players[0].factionIds).toEqual(["world-eaters"]);
    expect(result.dropped).toContain("squats-1998");
  });

  it("drops narrowed detachment ids that don't resolve in the surviving factions", () => {
    const stale: TeamPlan = {
      teamName: "T",
      size: 5,
      players: [
        {
          id: "a",
          name: "P",
          factionIds: ["world-eaters"],
          detachmentIds: ["goretrack-onslaught", "made-up-detachment"],
        },
      ],
    };
    const result = decodePlan(encodePlan(stale))!;
    expect(result.plan.players[0].detachmentIds).toEqual(["goretrack-onslaught"]);
    expect(result.dropped).toContain("made-up-detachment");
  });
});
