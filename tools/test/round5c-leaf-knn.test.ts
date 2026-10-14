import { describe, expect, it } from "vitest";

import { mutualKnnClusters, topK, vote } from "../src/round5c/leaf-knn.js";

const unit = (...values: number[]) => {
  const length = Math.hypot(...values);
  return new Float32Array(values.map((value) => value / length));
};

describe("Round 5C leaf kNN", () => {
  it("ranks neighbours by similarity, keeping pool order on ties, and can skip the query itself", () => {
    const pool = [unit(1, 0), unit(0, 1), unit(1, 0), unit(1, 1)];
    expect(topK(unit(1, 0), pool, 3).map((item) => item.index)).toEqual([0, 2, 3]);
    expect(topK(pool[0]!, pool, 2, 0).map((item) => item.index)).toEqual([2, 3]);
  });

  it("weights votes by similarity and reports the closest example of the winner", () => {
    const items = ["reroll", "grant", "grant"];
    const result = vote([{ index: 0, sim: 0.9 }, { index: 1, sim: 0.5 }, { index: 2, sim: 0.6 }], items, (item) => item);
    // Two weaker grant neighbours outvote one closer re-roll: 1.1 against 0.9.
    expect(result).toMatchObject({ label: "grant", best: { index: 2, sim: 0.6 } });
    expect(result!.share).toBeCloseTo(1.1 / 2);
  });

  it("breaks an even vote toward the closer example, not toward map order", () => {
    const items = ["a", "b"];
    expect(vote([{ index: 0, sim: 0.5 }, { index: 1, sim: 0.5 }], items, (item) => item)!.label).toBe("a");
    expect(vote([{ index: 1, sim: 0.7 }, { index: 0, sim: 0.3 }, { index: 0, sim: 0.4 }], ["a", "b"], (item) => item)!.label).toBe("b");
    expect(vote([], items, (item) => item)).toBeNull();
  });

  it("does not let a bridge between two tight groups merge them", () => {
    // Two tight groups on the x and y axes, and one wording halfway between.
    const vectors = [unit(1, 0.02), unit(1, 0.04), unit(1, 0.06), unit(0.02, 1), unit(0.04, 1), unit(0.06, 1), unit(1, 1)];
    const clusters = mutualKnnClusters(vectors, 2, 0.5);
    expect(clusters.map((cluster) => cluster.members)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    // The medoid is the member most like the rest of its group.
    expect(clusters[0]!.medoid).toBe(1);
  });

  it("links nothing below the similarity floor", () => {
    expect(mutualKnnClusters([unit(1, 0), unit(0, 1)], 1, 0.5).map((cluster) => cluster.members)).toEqual([[0], [1]]);
  });
});
