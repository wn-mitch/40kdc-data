import { describe, it, expect } from "vitest";
import {
  resolveLayout,
  polygonCentroid,
  footprintVertices,
  type TerrainTemplate,
  type TerrainLayout,
  type Vec2,
} from "../src/terrain/resolve.js";

const close = (a: number, b: number, eps = 5e-4) => Math.abs(a - b) <= eps;
const closeVec = (a: Vec2, b: Vec2) => close(a.x, b.x) && close(a.y, b.y);

function centroidOf(verts: Vec2[]): Vec2 {
  return polygonCentroid(verts);
}

describe("polygonCentroid", () => {
  it("rectangle centroid is its geometric center", () => {
    const c = polygonCentroid(footprintVertices({ type: "rectangle", width: 11.5, height: 7 }));
    expect(closeVec(c, { x: 5.75, y: 3.5 })).toBe(true);
  });

  it("right-triangle centroid is (w/3, h/3)", () => {
    const c = polygonCentroid(footprintVertices({ type: "right-triangle", width: 8, height: 11.5 }));
    expect(closeVec(c, { x: 8 / 3, y: 11.5 / 3 })).toBe(true);
  });

  it("trapezoid area centroid (not the vertex mean)", () => {
    // Vertices (0,0),(8,0),(2,11.5),(0,11.5). Vertex mean would be (2.5, 5.75);
    // the area centroid is pulled toward the wider base.
    const verts = footprintVertices({
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 2, y: 11.5 },
        { x: 0, y: 11.5 },
      ],
    });
    const c = polygonCentroid(verts);
    // Computed independently via the shoelace centroid formula (area = 57.5).
    expect(closeVec(c, { x: 2.8, y: 4.6 })).toBe(true);
    // And it is NOT the naive vertex mean.
    expect(closeVec(c, { x: 2.5, y: 5.75 })).toBe(false);
  });
});

const RECT_6x4: TerrainTemplate = {
  id: "r6x4",
  kind: "area",
  footprint: { type: "rectangle", width: 6, height: 4 },
};

function layoutWith(piece: Partial<TerrainLayout["pieces"][number]> & { position: Vec2 }): TerrainLayout {
  return {
    id: "t",
    name: "t",
    pieces: [{ template: "r6x4", ...piece }],
  };
}

describe("resolveLayout placement", () => {
  it("identity placement centers the footprint on position", () => {
    const [p] = resolveLayout(layoutWith({ position: { x: 30, y: 22 } }), [RECT_6x4]);
    expect(p.vertices).toEqual([
      { x: 27, y: 20 },
      { x: 33, y: 20 },
      { x: 33, y: 24 },
      { x: 27, y: 24 },
    ]);
  });

  it("rotates 90 degrees clockwise in the y-down frame", () => {
    const [p] = resolveLayout(layoutWith({ position: { x: 30, y: 22 }, rotation_degrees: 90 }), [RECT_6x4]);
    // 6(x)×4(y) becomes 4(x)×6(y), still centered at (30,22).
    expect(p.vertices).toEqual([
      { x: 32, y: 19 },
      { x: 32, y: 25 },
      { x: 28, y: 25 },
      { x: 28, y: 19 },
    ]);
  });

  it("position is the centroid, invariant under rotation and mirror", () => {
    const trapezoid: TerrainTemplate = {
      id: "trap",
      kind: "area",
      footprint: {
        type: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 2, y: 11.5 },
          { x: 0, y: 11.5 },
        ],
      },
    };
    const pos = { x: 40, y: 18 };
    for (const rotation_degrees of [0, 37, 90, 180, 235, 312]) {
      for (const mirror of ["none", "horizontal", "vertical"] as const) {
        const [p] = resolveLayout(
          { id: "t", name: "t", pieces: [{ template: "trap", position: pos, rotation_degrees, mirror }] },
          [trapezoid],
        );
        expect(closeVec(centroidOf(p.vertices), pos)).toBe(true);
      }
    }
  });

  it("inline footprint resolves identically to an equivalent template", () => {
    const viaTemplate = resolveLayout(layoutWith({ position: { x: 10, y: 10 }, rotation_degrees: 45 }), [RECT_6x4]);
    const viaInline = resolveLayout(
      {
        id: "t",
        name: "t",
        pieces: [{ footprint: { type: "rectangle", width: 6, height: 4 }, position: { x: 10, y: 10 }, rotation_degrees: 45 }],
      },
      [],
    );
    expect(viaInline[0].vertices).toEqual(viaTemplate[0].vertices);
  });
});

describe("composition and parenting", () => {
  const wall: TerrainTemplate = {
    id: "wall",
    name: "Wall",
    kind: "feature",
    footprint: { type: "rectangle", width: 7, height: 0.5 },
  };
  const composedArea: TerrainTemplate = {
    id: "ruin",
    name: "Ruin",
    kind: "area",
    footprint: { type: "rectangle", width: 11.5, height: 7 },
    features: [{ id: "back-wall", template: "wall", position: { x: 0, y: -3 } }],
  };

  it("emits composed features right after their area, in declaration order", () => {
    const resolved = resolveLayout(
      { id: "t", name: "t", pieces: [{ id: "a1", template: "ruin", position: { x: 30, y: 22 } }] },
      [composedArea, wall],
    );
    expect(resolved.map((r) => r.piece_type)).toEqual(["area", "feature"]);
    expect(resolved[1].id).toBe("back-wall");
    // The wall centroid sits at the area centroid offset by its area-local position (no rotation).
    expect(closeVec(centroidOf(resolved[1].vertices), { x: 30, y: 19 })).toBe(true);
  });

  it("an area template's composed feature equals the same feature parented explicitly", () => {
    const composed = resolveLayout(
      { id: "t", name: "t", pieces: [{ id: "a1", template: "ruin", position: { x: 30, y: 22 }, rotation_degrees: 90, mirror: "horizontal" }] },
      [composedArea, wall],
    );
    const explicit = resolveLayout(
      {
        id: "t",
        name: "t",
        pieces: [
          { id: "a1", template: "ruin-plain", position: { x: 30, y: 22 }, rotation_degrees: 90, mirror: "horizontal" },
          { id: "back-wall", template: "wall", parent_area_id: "a1", position: { x: 0, y: -3 } },
        ],
      },
      [{ ...composedArea, id: "ruin-plain", features: undefined }, wall],
    );
    const composedWall = composed.find((r) => r.piece_type === "feature")!;
    const explicitWall = explicit.find((r) => r.piece_type === "feature")!;
    expect(composedWall.vertices.length).toBe(explicitWall.vertices.length);
    for (let i = 0; i < composedWall.vertices.length; i++) {
      expect(closeVec(composedWall.vertices[i], explicitWall.vertices[i])).toBe(true);
    }
  });
});
