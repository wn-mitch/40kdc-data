import { describe, it, expect } from "vitest";
import {
  resolveLayout,
  orientedOffsets,
  type Footprint,
  type Mirror,
  type Vec2,
} from "../src/terrain/resolve.js";
import {
  solveCentroid,
  solveCentroidTriangulated,
  solveCentroidAttached,
  solveCentroidAgainstFixed,
  type AttachLine,
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

/** A piece's board-space vertices from a pose (exact — no resolver rounding). */
function poseVerts(fp: Footprint, rotation: number, mirror: Mirror, centroid: Vec2): Vec2[] {
  return orientedOffsets(fp, rotation, mirror).map((o) => ({ x: centroid.x + o.x, y: centroid.y + o.y }));
}

/** The two perpendicular card lines that pin a board point (varied edges for coverage). */
function linesFor(P: Vec2, fromFar = false): [AttachLine, AttachLine] {
  return fromFar
    ? [
        { edge: "right", distance: BOARD.width - P.x },
        { edge: "bottom", distance: BOARD.height - P.y },
      ]
    : [
        { edge: "left", distance: P.x },
        { edge: "top", distance: P.y },
      ];
}

describe("solveCentroidAttached (two-body lock + attach)", () => {
  /**
   * Vertex-mode round-trip. Build the truth constructively: place A, land B so
   * the chosen attach vertices coincide, derive each piece's two lock lines
   * from where its lock vertex actually sits, then assert the solver recovers
   * BOTH poses from only those four card lines (+ rough rotation hints).
   */
  function vertexRoundTrip(opts: {
    rotA: number;
    rotB: number;
    mirA?: Mirror;
    mirB?: Mirror;
    hintA?: number;
    hintB?: number;
  }) {
    const mirA = opts.mirA ?? "none";
    const mirB = opts.mirB ?? "none";
    const cA = { x: 24, y: 18 };
    const attachA = 1;
    const attachB = 0;
    const lockA = 3;
    const lockB = 2;
    const vertsA = poseVerts(RECT, opts.rotA, mirA, cA);
    const X = vertsA[attachA]; // the shared corner
    const offB = orientedOffsets(TRAP, opts.rotB, mirB);
    const cB = { x: X.x - offB[attachB].x, y: X.y - offB[attachB].y };
    const vertsB = poseVerts(TRAP, opts.rotB, mirB, cB);
    const res = solveCentroidAttached({
      board: BOARD,
      a: {
        footprint: RECT,
        mirror: mirA,
        lockVertex: lockA,
        lines: linesFor(vertsA[lockA]),
        attach: { kind: "vertex", index: attachA },
        rotationHint: opts.hintA ?? opts.rotA,
      },
      b: {
        footprint: TRAP,
        mirror: mirB,
        lockVertex: lockB,
        lines: linesFor(vertsB[lockB], true),
        attach: { kind: "vertex", index: attachB },
        rotationHint: opts.hintB ?? opts.rotB,
      },
    });
    return { res, cA, cB };
  }

  it("recovers both poses when corners meet (rotated pieces)", () => {
    const { res, cA, cB } = vertexRoundTrip({ rotA: 41.81, rotB: 339, hintA: 45, hintB: 330 });
    expect(close(res.a.x, cA.x) && close(res.a.y, cA.y) && closeAng(res.a.rotation, 41.81)).toBe(true);
    expect(close(res.b.x, cB.x) && close(res.b.y, cB.y) && closeAng(res.b.rotation, 339)).toBe(true);
  });

  it("recovers both poses with a mirrored piece", () => {
    const { res, cA, cB } = vertexRoundTrip({ rotA: 217, rotB: 55, mirB: "horizontal" });
    expect(close(res.a.x, cA.x) && close(res.a.y, cA.y) && closeAng(res.a.rotation, 217)).toBe(true);
    expect(close(res.b.x, cB.x) && close(res.b.y, cB.y) && closeAng(res.b.rotation, 55)).toBe(true);
  });

  it("the two circle roots are both reachable; the hints pick between them", () => {
    const truth = vertexRoundTrip({ rotA: 30, rotB: 290 });
    // Same card lines, hints far from the truth: the solver lands on the OTHER
    // root — still a valid attachment (corners coincide), different rotations.
    const other = vertexRoundTrip({ rotA: 30, rotB: 290, hintA: 30 + 180, hintB: 290 + 180 });
    expect(closeAng(other.res.a.rotation, truth.res.a.rotation)).toBe(false);
    const va = poseVerts(RECT, other.res.a.rotation, "none", { x: other.res.a.x, y: other.res.a.y })[1];
    const vb = poseVerts(TRAP, other.res.b.rotation, "none", { x: other.res.b.x, y: other.res.b.y })[0];
    expect(close(va.x, vb.x) && close(va.y, vb.y)).toBe(true);
  });

  /**
   * Edge-mode round-trip. Build the truth on a shared line L through Q at
   * angle psi: each piece's rotation aligns its edge with L (B anti-parallel —
   * the flush case), and each slides to its own offset along L.
   */
  function edgeRoundTrip(psiDeg: number, hintNudge = 0) {
    const Q = { x: 28, y: 20 };
    const psi = (psiDeg * Math.PI) / 180;
    const t = { x: Math.cos(psi), y: Math.sin(psi) };
    const edgeA = 1; // RECT v1→v2
    const edgeB = 2; // TRAP v2→v3
    const lockA = 0;
    const lockB = 1;
    const place = (fp: Footprint, edge: number, antiParallel: boolean, slide: number) => {
      const off0 = orientedOffsets(fp, 0, "none");
      const u = {
        x: off0[(edge + 1) % off0.length].x - off0[edge].x,
        y: off0[(edge + 1) % off0.length].y - off0[edge].y,
      };
      const rot =
        ((psiDeg - (Math.atan2(u.y, u.x) * 180) / Math.PI + (antiParallel ? 180 : 0)) % 360 + 360) % 360;
      const off = orientedOffsets(fp, rot, "none");
      // Put the edge's start vertex at Q + slide·t̂ — the whole edge then lies on L.
      const c = { x: Q.x + slide * t.x - off[edge].x, y: Q.y + slide * t.y - off[edge].y };
      return { rot, c };
    };
    const A = place(RECT, edgeA, false, 1.5);
    const B = place(TRAP, edgeB, true, 7);
    const vertsA = poseVerts(RECT, A.rot, "none", A.c);
    const vertsB = poseVerts(TRAP, B.rot, "none", B.c);
    const res = solveCentroidAttached({
      board: BOARD,
      a: {
        footprint: RECT,
        mirror: "none",
        lockVertex: lockA,
        lines: linesFor(vertsA[lockA]),
        attach: { kind: "edge", index: edgeA },
        rotationHint: A.rot + hintNudge,
      },
      b: {
        footprint: TRAP,
        mirror: "none",
        lockVertex: lockB,
        lines: linesFor(vertsB[lockB], true),
        attach: { kind: "edge", index: edgeB },
        rotationHint: B.rot + hintNudge,
      },
    });
    return { res, A, B };
  }

  it("recovers both poses when edges lie flush on a common line", () => {
    const { res, A, B } = edgeRoundTrip(28.6);
    expect(close(res.a.x, A.c.x) && close(res.a.y, A.c.y) && closeAng(res.a.rotation, A.rot)).toBe(true);
    expect(close(res.b.x, B.c.x) && close(res.b.y, B.c.y) && closeAng(res.b.rotation, B.rot)).toBe(true);
  });

  it("tolerates rough rotation hints in edge mode", () => {
    const { res, A, B } = edgeRoundTrip(331, 12);
    expect(closeAng(res.a.rotation, A.rot) && closeAng(res.b.rotation, B.rot)).toBe(true);
  });

  const PIECE_A = {
    footprint: RECT,
    mirror: "none" as Mirror,
    lockVertex: 0,
    lines: linesFor({ x: 10, y: 10 }),
    attach: { kind: "vertex" as const, index: 1 },
  };

  it("rejects mixed attachment kinds", () => {
    expect(() =>
      solveCentroidAttached({
        board: BOARD,
        a: PIECE_A,
        b: { ...PIECE_A, lines: linesFor({ x: 20, y: 10 }), attach: { kind: "edge", index: 1 } },
      }),
    ).toThrow(/kinds must match/);
  });

  it("rejects lock lines that pin the same axis", () => {
    expect(() =>
      solveCentroidAttached({
        board: BOARD,
        a: {
          ...PIECE_A,
          lines: [
            { edge: "left", distance: 10 },
            { edge: "right", distance: 40 },
          ],
        },
        b: { ...PIECE_A, lines: linesFor({ x: 20, y: 10 }) },
      }),
    ).toThrow(/different axes/);
  });

  it("rejects an out-of-range lock vertex", () => {
    expect(() =>
      solveCentroidAttached({
        board: BOARD,
        a: { ...PIECE_A, lockVertex: 9 },
        b: { ...PIECE_A, lines: linesFor({ x: 20, y: 10 }) },
      }),
    ).toThrow(/out of range/);
  });

  it("rejects corners that cannot meet (lock points too far apart)", () => {
    expect(() =>
      solveCentroidAttached({
        board: BOARD,
        a: PIECE_A,
        b: { ...PIECE_A, lines: linesFor({ x: 50, y: 40 }) },
      }),
    ).toThrow(/cannot meet/);
  });

  it("rejects edges that cannot reach a common line", () => {
    // A's lock vertex sits ON its edge (offset 0); B's is 7″ off its edge; the
    // lock points are only 3″ apart — no line can satisfy both offsets.
    expect(() =>
      solveCentroidAttached({
        board: BOARD,
        a: { ...PIECE_A, lockVertex: 0, attach: { kind: "edge", index: 0 } },
        b: {
          ...PIECE_A,
          lockVertex: 2,
          lines: linesFor({ x: 13, y: 10 }),
          attach: { kind: "edge", index: 0 },
        },
      }),
    ).toThrow(/common line/);
  });
});

const DEG = Math.PI / 180;
/** Signed perpendicular distance of point X from the line through F0 with unit dir t̂. */
const offLine = (tHat: Vec2, F0: Vec2, X: Vec2): number =>
  tHat.x * (X.y - F0.y) - tHat.y * (X.x - F0.x);

describe("solveCentroidAgainstFixed (one piece against an already-placed anchor)", () => {
  /**
   * Vertex-mode round-trip. Place the anchor at a known pose, then place the
   * moving piece so its attach corner coincides with the anchor's attach
   * corner. Derive the single lock line from where a chosen moving vertex
   * actually sits, then assert the solver recovers the moving pose alone.
   */
  function vertexRoundTrip(opts: {
    movFp: Footprint;
    rotM: number;
    mirM?: Mirror;
    movAttach: number;
    lineVertex: number;
    lineEdge: BoardEdge;
    hintM?: number;
  }) {
    const mirM = opts.mirM ?? "none";
    const fixedVerts = poseVerts(RECT, 18, "none", { x: 40, y: 28 });
    const fixedAttach = 2;
    const P = fixedVerts[fixedAttach];
    const offM = orientedOffsets(opts.movFp, opts.rotM, mirM);
    const cM = { x: P.x - offM[opts.movAttach].x, y: P.y - offM[opts.movAttach].y };
    const vertsM = poseVerts(opts.movFp, opts.rotM, mirM, cM);
    const vj = vertsM[opts.lineVertex];
    const distance =
      opts.lineEdge === "left" ? vj.x
      : opts.lineEdge === "right" ? BOARD.width - vj.x
      : opts.lineEdge === "top" ? vj.y
      : BOARD.height - vj.y;
    const res = solveCentroidAgainstFixed({
      board: BOARD,
      moving: {
        footprint: opts.movFp,
        mirror: mirM,
        attach: { kind: "vertex", index: opts.movAttach },
        line: { edge: opts.lineEdge, distance, vertex: opts.lineVertex },
        rotationHint: opts.hintM ?? opts.rotM,
      },
      fixed: { vertices: fixedVerts, attach: { kind: "vertex", index: fixedAttach } },
    });
    return { res, cM, P };
  }

  it("recovers a rotated piece whose corner pins to the anchor's corner", () => {
    const { res, cM, P } = vertexRoundTrip({
      movFp: TRAP, rotM: 312, movAttach: 1, lineVertex: 3, lineEdge: "left",
    });
    expect(close(res.x, cM.x) && close(res.y, cM.y) && closeAng(res.rotation, 312)).toBe(true);
    // The attach corner really lands on the anchor point.
    const v = poseVerts(TRAP, res.rotation, "none", { x: res.x, y: res.y })[1];
    expect(close(v.x, P.x) && close(v.y, P.y)).toBe(true);
  });

  it("recovers a mirrored piece (vertex mode) using a top-edge lock line", () => {
    const { res, cM } = vertexRoundTrip({
      movFp: RECT, rotM: 64, mirM: "horizontal", movAttach: 3, lineVertex: 1, lineEdge: "top",
    });
    expect(close(res.x, cM.x) && close(res.y, cM.y) && closeAng(res.rotation, 64)).toBe(true);
  });

  it("the rotation hint picks between the two roots", () => {
    // Same geometry, hint near the mirror-image root → a different rotation that
    // still pins the attach corner to the anchor (a genuine alternative pose).
    const truth = vertexRoundTrip({ movFp: RECT, rotM: 25, movAttach: 1, lineVertex: 3, lineEdge: "left" });
    const flipped = vertexRoundTrip({
      movFp: RECT, rotM: 25, movAttach: 1, lineVertex: 3, lineEdge: "left", hintM: -150,
    });
    expect(closeAng(flipped.res.rotation, truth.res.rotation)).toBe(false);
    const v = poseVerts(RECT, flipped.res.rotation, "none", { x: flipped.res.x, y: flipped.res.y })[1];
    expect(close(v.x, truth.P.x) && close(v.y, truth.P.y)).toBe(true);
  });

  /**
   * Edge-mode round-trip. Place the anchor, take one of its edges as the contact
   * line, then place the moving piece with its chosen edge flush on that line at
   * some slide offset. Derive one lock line and assert the moving pose recovers.
   */
  function edgeRoundTrip(opts: {
    rotF: number;
    fixedEdge: number;
    movEdge: number;
    antiParallel: boolean;
    slide: number;
    lineVertex: number;
    hintNudge?: number;
  }) {
    const fixedVerts = poseVerts(RECT, opts.rotF, "none", { x: 38, y: 24 });
    const F0 = fixedVerts[opts.fixedEdge];
    const F1 = fixedVerts[(opts.fixedEdge + 1) % fixedVerts.length];
    const t = { x: F1.x - F0.x, y: F1.y - F0.y };
    const tLen = Math.hypot(t.x, t.y);
    const tHat = { x: t.x / tLen, y: t.y / tLen };
    const psiDeg = (Math.atan2(t.y, t.x) / DEG);
    const off0 = orientedOffsets(TRAP, 0, "none");
    const u0 = {
      x: off0[(opts.movEdge + 1) % off0.length].x - off0[opts.movEdge].x,
      y: off0[(opts.movEdge + 1) % off0.length].y - off0[opts.movEdge].y,
    };
    const u0Deg = Math.atan2(u0.y, u0.x) / DEG;
    const rotM = ((psiDeg - u0Deg + (opts.antiParallel ? 180 : 0)) % 360 + 360) % 360;
    const offM = orientedOffsets(TRAP, rotM, "none");
    // Slide the moving edge's start vertex along the line from F0.
    const cM = {
      x: F0.x + opts.slide * tHat.x - offM[opts.movEdge].x,
      y: F0.y + opts.slide * tHat.y - offM[opts.movEdge].y,
    };
    const vertsM = poseVerts(TRAP, rotM, "none", cM);
    const vj = vertsM[opts.lineVertex];
    const distance = vj.x; // left-edge lock line; fixed edge is oblique, never x-parallel
    const res = solveCentroidAgainstFixed({
      board: BOARD,
      moving: {
        footprint: TRAP,
        mirror: "none",
        attach: { kind: "edge", index: opts.movEdge },
        line: { edge: "left", distance, vertex: opts.lineVertex },
        rotationHint: rotM + (opts.hintNudge ?? 0),
      },
      fixed: { vertices: fixedVerts, attach: { kind: "edge", index: opts.fixedEdge } },
    });
    return { res, cM, rotM, tHat, F0 };
  }

  it("recovers a piece whose edge lies flush on the anchor edge", () => {
    const { res, cM, rotM, tHat, F0 } = edgeRoundTrip({
      rotF: 23, fixedEdge: 0, movEdge: 2, antiParallel: true, slide: 4, lineVertex: 0,
    });
    expect(close(res.x, cM.x) && close(res.y, cM.y) && closeAng(res.rotation, rotM)).toBe(true);
    // The moving attach edge's endpoints sit on the anchor edge line.
    const vm = poseVerts(TRAP, res.rotation, "none", { x: res.x, y: res.y });
    expect(Math.abs(offLine(tHat, F0, vm[2])) <= 1e-3).toBe(true);
    expect(Math.abs(offLine(tHat, F0, vm[3])) <= 1e-3).toBe(true);
  });

  it("recovers edge-flush with the same-sense parallel and a rough hint", () => {
    const { res, cM, rotM } = edgeRoundTrip({
      rotF: 41, fixedEdge: 1, movEdge: 0, antiParallel: false, slide: 2, lineVertex: 2, hintNudge: 9,
    });
    expect(close(res.x, cM.x) && close(res.y, cM.y) && closeAng(res.rotation, rotM)).toBe(true);
  });

  const SQUARE_ANCHOR: Vec2[] = [
    { x: 10, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 14 }, { x: 10, y: 14 },
  ];

  it("rejects mixed attachment kinds", () => {
    expect(() =>
      solveCentroidAgainstFixed({
        board: BOARD,
        moving: { footprint: RECT, mirror: "none", attach: { kind: "vertex", index: 1 }, line: { edge: "left", distance: 10, vertex: 0 } },
        fixed: { vertices: SQUARE_ANCHOR, attach: { kind: "edge", index: 0 } },
      }),
    ).toThrow(/kinds must match/);
  });

  it("rejects a lock line that measures to the attach corner (vertex mode)", () => {
    expect(() =>
      solveCentroidAgainstFixed({
        board: BOARD,
        moving: { footprint: RECT, mirror: "none", attach: { kind: "vertex", index: 1 }, line: { edge: "left", distance: 10, vertex: 1 } },
        fixed: { vertices: SQUARE_ANCHOR, attach: { kind: "vertex", index: 0 } },
      }),
    ).toThrow(/different vertex/);
  });

  it("rejects a measurement the pinned corner cannot reach (vertex mode)", () => {
    // RECT v0↔v1 are 11.5″ apart; demand a 20″ x-gap from the anchor point → infeasible.
    expect(() =>
      solveCentroidAgainstFixed({
        board: BOARD,
        moving: { footprint: RECT, mirror: "none", attach: { kind: "vertex", index: 1 }, line: { edge: "left", distance: 30, vertex: 0 } },
        fixed: { vertices: SQUARE_ANCHOR, attach: { kind: "vertex", index: 0 } }, // P.x = 10
      }),
    ).toThrow(/cannot reach/);
  });

  it("rejects a lock line parallel to the contact edge (edge mode singular)", () => {
    // Anchor edge 0→1 is horizontal; flush already pins y, so a top/bottom line
    // (also y) is redundant and leaves x — the slide — undetermined.
    expect(() =>
      solveCentroidAgainstFixed({
        board: BOARD,
        moving: { footprint: RECT, mirror: "none", attach: { kind: "edge", index: 0 }, line: { edge: "top", distance: 10, vertex: 2 } },
        fixed: { vertices: SQUARE_ANCHOR, attach: { kind: "edge", index: 0 } },
      }),
    ).toThrow(/parallel to the contact edge/);
  });

  it("rejects an out-of-range fixed attach index", () => {
    expect(() =>
      solveCentroidAgainstFixed({
        board: BOARD,
        moving: { footprint: RECT, mirror: "none", attach: { kind: "vertex", index: 1 }, line: { edge: "left", distance: 10, vertex: 0 } },
        fixed: { vertices: SQUARE_ANCHOR, attach: { kind: "vertex", index: 9 } },
      }),
    ).toThrow(/out of range/);
  });
});
