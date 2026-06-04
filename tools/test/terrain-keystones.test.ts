import { describe, expect, it } from "vitest";
import {
  keystoneMeasurements,
  BOARD_INCHES,
  TerrainKeystoneError,
} from "../src/terrain/keystones.js";
import type { TerrainLayout, TerrainTemplate } from "../src/terrain/resolve.js";

// Error-path coverage for keystone derivation. The happy paths (all four
// edges, vertex + face refs, rotation/mirror/parenting, custom boards) are
// pinned by the conformance corpus in conformance.test.ts.

const TEMPLATES: TerrainTemplate[] = [
  {
    id: "area-medium",
    name: "Medium Area",
    kind: "area",
    footprint: { type: "rectangle", width: 6, height: 4 },
  },
];

const layoutWith = (keystones: object[]): TerrainLayout =>
  ({
    id: "c",
    name: "c",
    pieces: [{ id: "p", template: "area-medium", position: { x: 30, y: 22 }, keystones }],
  }) as TerrainLayout;

describe("keystoneMeasurements error handling", () => {
  it("rejects a vertex index past the footprint's vertex count", () => {
    const layout = layoutWith([{ edge: "left", ref: { kind: "vertex", index: 4 } }]);
    expect(() => keystoneMeasurements(layout, TEMPLATES)).toThrowError(TerrainKeystoneError);
    expect(() => keystoneMeasurements(layout, TEMPLATES)).toThrowError(/index 4 out of range/);
  });

  it("rejects a face whose axis disagrees with the edge", () => {
    const layout = layoutWith([{ edge: "left", ref: { kind: "face", side: "min-y" } }]);
    expect(() => keystoneMeasurements(layout, TEMPLATES)).toThrowError(/axis mismatch/);
  });

  it("propagates resolver errors for an unknown template", () => {
    const layout: TerrainLayout = {
      id: "c",
      name: "c",
      pieces: [{ id: "p", template: "nope", position: { x: 1, y: 1 } }],
    };
    expect(() => keystoneMeasurements(layout, TEMPLATES)).toThrowError(/unknown template/);
  });

  it("returns an empty list when no piece has keystones", () => {
    const layout: TerrainLayout = {
      id: "c",
      name: "c",
      pieces: [{ id: "p", template: "area-medium", position: { x: 30, y: 22 } }],
    };
    expect(keystoneMeasurements(layout, TEMPLATES, BOARD_INCHES)).toEqual([]);
  });

  it("keeps measurements aligned with composed-feature emission", () => {
    // An area whose template embeds a composed feature: the keystone on the
    // NEXT explicit piece must not read the composed feature's vertices.
    const templates: TerrainTemplate[] = [
      {
        id: "ruin",
        name: "Ruin",
        kind: "area",
        footprint: { type: "rectangle", width: 6, height: 4 },
        features: [{ id: "wall", template: "wall", position: { x: 0, y: -1 } }],
      },
      { id: "wall", name: "Wall", kind: "feature", footprint: { type: "rectangle", width: 5, height: 0.25 } },
      ...TEMPLATES,
    ];
    const layout: TerrainLayout = {
      id: "c",
      name: "c",
      pieces: [
        { id: "a", template: "ruin", position: { x: 10, y: 10 } },
        {
          id: "b",
          template: "area-medium",
          position: { x: 40, y: 30 },
          keystones: [{ edge: "left", ref: { kind: "face", side: "min-x" } }],
        },
      ],
    };
    const [m] = keystoneMeasurements(layout, templates);
    expect(m?.piece_id).toBe("b");
    expect(m?.piece_index).toBe(1);
    // area-medium is 6 wide at x=40 → min-x face at 37.
    expect(m?.distance).toBe(37);
  });
});
