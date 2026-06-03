import { describe, it, expect } from "vitest";
import { resolveLayout, type Footprint, type Mirror, type Vec2 } from "../src/terrain/resolve.js";
import {
  solveCentroid,
  solveCentroidTriangulated,
  type BoardEdge,
  type FeatureRef,
} from "../src/terrain/solve.js";

const BOARD = { width: 60, height: 44 };
// The resolver rounds vertices to 4 dp, so a centroid recovered from resolved
// vertices carries up to ~5e-5 of rounding error. The solver itself is exact.
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3;

/**
 * Round-trip: place a template at a known centroid, read where a chosen feature
 * actually lands (via the resolver), turn that into the dimension line a card
 * would print, then assert the solver recovers the original centroid. If the
 * solver and resolver agree, this holds for any orientation and any reference.
 */
function roundTrip(
  footprint: Footprint,
  rotation: number,
  mirror: Mirror,
  centroid: Vec2,
  xLine: { edge: "left" | "right"; feature: FeatureRef },
  yLine: { edge: "top" | "bottom"; feature: FeatureRef },
): Vec2 {
  const [piece] = resolveLayout(
    { id: "t", name: "t", pieces: [{ id: "p", footprint, position: centroid, rotation_degrees: rotation, mirror }] },
    [],
  );
  const v = piece.vertices;
  const coord = (f: FeatureRef, axis: "x" | "y"): number => {
    if (f.kind === "vertex") return axis === "x" ? v[f.index].x : v[f.index].y;
    const xs = v.map((p) => p.x);
    const ys = v.map((p) => p.y);
    return f.side === "min-x" ? Math.min(...xs) : f.side === "max-x" ? Math.max(...xs) : f.side === "min-y" ? Math.min(...ys) : Math.max(...ys);
  };
  const distFor = (edge: BoardEdge, f: FeatureRef): number => {
    const axis = edge === "left" || edge === "right" ? "x" : "y";
    const c = coord(f, axis);
    if (edge === "left") return c;
    if (edge === "right") return BOARD.width - c;
    if (edge === "top") return c;
    return BOARD.height - c;
  };
  return solveCentroid({
    footprint,
    rotation,
    mirror,
    board: BOARD,
    lines: [
      { edge: xLine.edge, distance: distFor(xLine.edge, xLine.feature), feature: xLine.feature },
      { edge: yLine.edge, distance: distFor(yLine.edge, yLine.feature), feature: yLine.feature },
    ],
  });
}

const RECT: Footprint = { type: "rectangle", width: 11.5, height: 7 };
const TRAP: Footprint = {
  type: "polygon",
  points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 2, y: 11.5 }, { x: 0, y: 11.5 }],
};

describe("solveCentroid (inverse of the resolver)", () => {
  it("recovers the centroid from face references at rotation 0", () => {
    const c = roundTrip(RECT, 0, "none", { x: 30, y: 22 }, { edge: "left", feature: { kind: "face", side: "min-x" } }, { edge: "top", feature: { kind: "face", side: "min-y" } });
    expect(close(c.x, 30) && close(c.y, 22)).toBe(true);
  });

  it("recovers the centroid from vertex references under rotation + mirror", () => {
    const c = roundTrip(TRAP, 235, "horizontal", { x: 35.75, y: 27 }, { edge: "right", feature: { kind: "vertex", index: 2 } }, { edge: "bottom", feature: { kind: "vertex", index: 1 } });
    expect(close(c.x, 35.75) && close(c.y, 27)).toBe(true);
  });

  it("recovers the centroid with mixed references (card x off one vertex, y off a face)", () => {
    const c = roundTrip(RECT, 55, "none", { x: 18.4, y: 31.2 }, { edge: "left", feature: { kind: "vertex", index: 0 } }, { edge: "bottom", feature: { kind: "face", side: "max-y" } });
    expect(close(c.x, 18.4) && close(c.y, 31.2)).toBe(true);
  });

  it("rejects two dimension lines on the same axis", () => {
    expect(() =>
      solveCentroid({ footprint: RECT, rotation: 0, mirror: "none", board: BOARD, lines: [
        { edge: "left", distance: 10, feature: { kind: "face", side: "min-x" } },
        { edge: "right", distance: 10, feature: { kind: "face", side: "max-x" } },
      ] }),
    ).toThrow();
  });
});

/**
 * Round-trip for the 3-corner triangulation solver: place a piece at a known
 * centroid AND rotation, read where three chosen corners actually land, turn
 * those into the corner-to-edge distances a card would print, then assert the
 * solver recovers both the centroid and the rotation.
 */
function triRoundTrip(
  footprint: Footprint,
  rotation: number,
  mirror: Mirror,
  centroid: Vec2,
  lines: { edge: BoardEdge; vertex: number }[],
  rotationHint = rotation,
): { x: number; y: number; rotation: number } {
  const [piece] = resolveLayout(
    { id: "t", name: "t", pieces: [{ id: "p", footprint, position: centroid, rotation_degrees: rotation, mirror }] },
    [],
  );
  const v = piece.vertices;
  const distFor = (edge: BoardEdge, vertex: number): number => {
    const c = edge === "left" || edge === "right" ? v[vertex].x : v[vertex].y;
    if (edge === "left") return c;
    if (edge === "right") return BOARD.width - c;
    if (edge === "top") return c;
    return BOARD.height - c;
  };
  return solveCentroidTriangulated({
    footprint,
    mirror,
    board: BOARD,
    lines: lines.map((l) => ({ edge: l.edge, distance: distFor(l.edge, l.vertex), vertex: l.vertex })) as never,
    rotationHint,
  });
}

const closeAng = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return Math.min(d, 360 - d) <= 1e-2;
};

describe("solveCentroidTriangulated (centroid + rotation from three corners)", () => {
  it("recovers centroid and angle from 2 left-edge + 1 top-edge corner measurements", () => {
    const r = triRoundTrip(RECT, 37, "none", { x: 30, y: 22 }, [
      { edge: "left", vertex: 0 },
      { edge: "left", vertex: 2 },
      { edge: "top", vertex: 0 },
    ]);
    expect(close(r.x, 30) && close(r.y, 22) && closeAng(r.rotation, 37)).toBe(true);
  });

  it("recovers a mirrored trapezoid at a non-90° angle (2 top + 1 left)", () => {
    const r = triRoundTrip(TRAP, 113, "horizontal", { x: 28.5, y: 19.25 }, [
      { edge: "top", vertex: 0 },
      { edge: "top", vertex: 2 },
      { edge: "left", vertex: 1 },
    ]);
    expect(close(r.x, 28.5) && close(r.y, 19.25) && closeAng(r.rotation, 113)).toBe(true);
  });

  it("picks the angle root nearest the hint", () => {
    const r = triRoundTrip(
      TRAP,
      200,
      "none",
      { x: 32, y: 24 },
      [
        { edge: "right", vertex: 1 },
        { edge: "right", vertex: 3 },
        { edge: "bottom", vertex: 2 },
      ],
      190, // approximate angle the author set; closer to 200 than the other root
    );
    expect(close(r.x, 32) && close(r.y, 24) && closeAng(r.rotation, 200)).toBe(true);
  });

  it("rejects three measurements that don't span both axes", () => {
    expect(() =>
      solveCentroidTriangulated({
        footprint: RECT,
        mirror: "none",
        board: BOARD,
        lines: [
          { edge: "left", distance: 10, vertex: 0 },
          { edge: "left", distance: 12, vertex: 1 },
          { edge: "right", distance: 8, vertex: 2 },
        ],
      }),
    ).toThrow();
  });
});
