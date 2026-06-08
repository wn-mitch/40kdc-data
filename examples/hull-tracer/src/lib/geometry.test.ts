import { describe, it, expect } from "vitest";
import {
  boundingBox,
  boundsSize,
  polygonCentroid,
  round,
  distance,
  isValidEntityId,
  slugify,
} from "./geometry.js";
import type { Vec2 } from "./types.js";

const SQUARE: Vec2[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

describe("boundingBox / boundsSize", () => {
  it("returns null for an empty set", () => {
    expect(boundingBox([])).toBeNull();
    expect(boundsSize([])).toEqual({ width: 0, height: 0 });
  });

  it("measures a centered square", () => {
    expect(boundingBox(SQUARE)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(boundsSize(SQUARE)).toEqual({ width: 2, height: 2 });
  });

  it("measures an offset rectangle", () => {
    const rect: Vec2[] = [
      { x: 2, y: 3 },
      { x: 5, y: 3 },
      { x: 5, y: 9 },
      { x: 2, y: 9 },
    ];
    expect(boundsSize(rect)).toEqual({ width: 3, height: 6 });
  });
});

describe("polygonCentroid", () => {
  it("finds the center of a symmetric square", () => {
    const c = polygonCentroid(SQUARE);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
  });

  it("is translation-equivariant", () => {
    const shifted = SQUARE.map((p) => ({ x: p.x + 10, y: p.y - 4 }));
    const c = polygonCentroid(shifted);
    expect(c.x).toBeCloseTo(10);
    expect(c.y).toBeCloseTo(-4);
  });

  it("weights by area, not vertex count (dense edge does not pull the centroid)", () => {
    // A unit square with an extra vertex midway along the bottom edge. The
    // arithmetic mean of vertices would drift toward that edge; the area
    // centroid stays at the true center.
    const withMidpoint: Vec2[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const c = polygonCentroid(withMidpoint);
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
  });

  it("falls back to the mean for collinear (zero-area) points", () => {
    const line: Vec2[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ];
    const c = polygonCentroid(line);
    expect(c.x).toBeCloseTo(2);
    expect(c.y).toBeCloseTo(0);
  });
});

describe("round", () => {
  it("rounds to 3 dp by default and normalises -0", () => {
    expect(round(1.23456)).toBe(1.235);
    expect(round(-0.0001)).toBe(0);
    expect(Object.is(round(-0.0001), -0)).toBe(false);
  });
});

describe("distance", () => {
  it("is the Euclidean norm", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("isValidEntityId", () => {
  it("accepts kebab-case ids", () => {
    expect(isValidEntityId("rhino-chassis")).toBe(true);
    expect(isValidEntityId("a1")).toBe(true);
  });

  it("rejects empties, uppercase, leading/trailing dashes, and over-long ids", () => {
    expect(isValidEntityId("")).toBe(false);
    expect(isValidEntityId("a")).toBe(false);
    expect(isValidEntityId("Rhino")).toBe(false);
    expect(isValidEntityId("-rhino")).toBe(false);
    expect(isValidEntityId("rhino-")).toBe(false);
    expect(isValidEntityId("a".repeat(129))).toBe(false);
  });
});

describe("slugify", () => {
  it("produces a valid id from a display name", () => {
    expect(slugify("Battle Hauler Chassis")).toBe("battle-hauler-chassis");
    expect(slugify("  Rhino (Mk II)!! ")).toBe("rhino-mk-ii");
  });

  it("collapses punctuation runs and trims dashes", () => {
    const s = slugify("A — B___C");
    expect(s).toBe("a-b-c");
    expect(isValidEntityId(s)).toBe(true);
  });
});
