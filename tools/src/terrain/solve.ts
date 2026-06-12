/**
 * Card-measurement centroid solver — the inverse of the resolver's placement.
 *
 * Reference cards locate a terrain area by dimension lines: "this feature of the
 * area is D inches from a board edge". The feature referenced varies per card
 * and per piece, which is exactly why a single canonical anchor (the centroid)
 * is hard to read off a card directly. This solver lets a user transcribe the
 * card verbatim — pick the template, set the orientation shown, then enter one
 * horizontal and one vertical dimension line against whatever feature the card
 * happens to draw — and back-solves the centroid `position` the schema stores.
 *
 * Because the centroid is rotation- and mirror-invariant, orientation is fixed
 * first; each dimension line then pins one axis of the centroid in closed form.
 */
import {
  orientedOffsets,
  type BoardEdge,
  type FeatureRef,
  type Footprint,
  type Mirror,
  type Vec2,
} from "./resolve.js";

// The edge/feature vocabulary lives in resolve.ts (shared with keystones);
// re-exported here so existing solver imports keep working.
export type { BoardEdge, FeatureRef } from "./resolve.js";

/** One card dimension line: `distance` inches from `edge` to `feature`. */
export interface DimensionLine {
  edge: BoardEdge;
  distance: number;
  feature: FeatureRef;
}

export interface SolveInput {
  footprint: Footprint;
  rotation: number;
  mirror: Mirror;
  /** Board extents in inches (40kdc standard is 60 × 44). */
  board: { width: number; height: number };
  /** Two perpendicular dimension lines: exactly one must pin x, one must pin y. */
  lines: [DimensionLine, DimensionLine];
}

export class TerrainSolveError extends Error {}

/** The signed offset (from the centroid) the given feature resolves to, on its axis. */
function featureOffset(offsets: Vec2[], feature: FeatureRef, axis: "x" | "y"): number {
  if (feature.kind === "vertex") {
    const o = offsets[feature.index];
    if (!o) throw new TerrainSolveError(`vertex index ${feature.index} out of range`);
    return axis === "x" ? o.x : o.y;
  }
  const xs = offsets.map((o) => o.x);
  const ys = offsets.map((o) => o.y);
  switch (feature.side) {
    case "min-x":
      return Math.min(...xs);
    case "max-x":
      return Math.max(...xs);
    case "min-y":
      return Math.min(...ys);
    case "max-y":
      return Math.max(...ys);
  }
}

function axisOfEdge(edge: BoardEdge): "x" | "y" {
  return edge === "left" || edge === "right" ? "x" : "y";
}

/** Solve one axis of the centroid from a single dimension line. */
function solveAxis(line: DimensionLine, offsets: Vec2[], board: { width: number; height: number }): { axis: "x" | "y"; value: number } {
  const axis = axisOfEdge(line.edge);
  const o = featureOffset(offsets, line.feature, axis);
  // edge → centroid:  near-side edges measure from 0; far-side from the extent.
  let value: number;
  switch (line.edge) {
    case "left":
      value = line.distance - o;
      break;
    case "right":
      value = board.width - line.distance - o;
      break;
    case "top":
      value = line.distance - o;
      break;
    case "bottom":
      value = board.height - line.distance - o;
      break;
  }
  return { axis, value };
}

/**
 * Back-solve the centroid `position` from a template, its orientation, and two
 * perpendicular card dimension lines. Closed form — one x-line and one y-line
 * pin the two unknowns directly.
 */
export function solveCentroid(input: SolveInput): Vec2 {
  const offsets = orientedOffsets(input.footprint, input.rotation, input.mirror);
  const a = solveAxis(input.lines[0], offsets, input.board);
  const b = solveAxis(input.lines[1], offsets, input.board);
  if (a.axis === b.axis) {
    throw new TerrainSolveError(
      "the two dimension lines must pin different axes (one of left/right, one of top/bottom)",
    );
  }
  const x = a.axis === "x" ? a.value : b.value;
  const y = a.axis === "y" ? a.value : b.value;
  return { x, y };
}

/**
 * One triangulation measurement: `distance` inches from board `edge` to a
 * specific footprint vertex (corner). Faces are intentionally excluded — an
 * arbitrarily-rotated piece has no axis-aligned face to measure to.
 */
export interface TriangulationLine {
  edge: BoardEdge;
  distance: number;
  vertex: number;
}

export interface TriangulateInput {
  footprint: Footprint;
  mirror: Mirror;
  board: { width: number; height: number };
  /**
   * Three corner measurements. At least two must share an axis (left/right or
   * top/bottom) to fix the angle, and at least one must pin the other axis.
   */
  lines: [TriangulationLine, TriangulationLine, TriangulationLine];
  /** Current rotation in degrees, used to choose between the two angle roots. */
  rotationHint?: number;
}

const TWO_PI = Math.PI * 2;
/** Smallest absolute angular separation between two radian angles. */
function angularGap(a: number, b: number): number {
  const d = (((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

/**
 * Back-solve a piece's centroid AND rotation from three card measurements to
 * specific footprint corners — the inverse needed for pieces at non-90° angles,
 * where the card pins three corner-to-edge distances rather than one per axis.
 *
 * Closed form: with the (unknown) rotation θ, each corner `v` resolves to
 * `centroid + R(θ)·v`. Subtracting two same-axis measurements cancels the
 * centroid and leaves `A·cosθ + B·sinθ = C`, solved as `θ = atan2(B,A) ±
 * acos(C/√(A²+B²))`; the root nearest `rotationHint` is chosen. One measurement
 * on each axis then pins the centroid.
 */
export function solveCentroidTriangulated(
  input: TriangulateInput,
): { x: number; y: number; rotation: number } {
  // Mirror-applied, pre-rotation offsets (θ is the unknown we're solving for).
  const offsets = orientedOffsets(input.footprint, 0, input.mirror);
  const items = input.lines.map((l) => {
    const o = offsets[l.vertex];
    if (!o) throw new TerrainSolveError(`vertex index ${l.vertex} out of range`);
    const axis = axisOfEdge(l.edge);
    let target: number;
    switch (l.edge) {
      case "left":
        target = l.distance;
        break;
      case "right":
        target = input.board.width - l.distance;
        break;
      case "top":
        target = l.distance;
        break;
      case "bottom":
        target = input.board.height - l.distance;
        break;
    }
    return { axis, target, o };
  });
  const xs = items.filter((i) => i.axis === "x");
  const ys = items.filter((i) => i.axis === "y");

  let pivot: typeof items;
  let pivotAxis: "x" | "y";
  if (xs.length >= 2 && ys.length >= 1) {
    pivot = xs;
    pivotAxis = "x";
  } else if (ys.length >= 2 && xs.length >= 1) {
    pivot = ys;
    pivotAxis = "y";
  } else {
    throw new TerrainSolveError(
      "triangulation needs two measurements from one pair of edges (left/right or top/bottom) and one from the other",
    );
  }

  // Best-conditioned pair on the pivot axis (corners that are furthest apart).
  let a = pivot[0];
  let b = pivot[1];
  let spread = -1;
  for (let i = 0; i < pivot.length; i++) {
    for (let j = i + 1; j < pivot.length; j++) {
      const d = Math.hypot(pivot[i].o.x - pivot[j].o.x, pivot[i].o.y - pivot[j].o.y);
      if (d > spread) {
        spread = d;
        a = pivot[i];
        b = pivot[j];
      }
    }
  }

  // Subtract the two same-axis equations → A·cosθ + B·sinθ = C.
  //   x-axis vertex eq: cx + (cosθ·o.x − sinθ·o.y) = target
  //   y-axis vertex eq: cy + (sinθ·o.x + cosθ·o.y) = target
  const dx = a.o.x - b.o.x;
  const dy = a.o.y - b.o.y;
  const C = a.target - b.target;
  const A = pivotAxis === "x" ? dx : dy;
  const B = pivotAxis === "x" ? -dy : dx;
  const R = Math.hypot(A, B);
  if (R < 1e-9) {
    throw new TerrainSolveError("the two same-edge measurements must reference different corners");
  }
  const ratio = C / R;
  if (ratio > 1 + 1e-6 || ratio < -1 - 1e-6) {
    throw new TerrainSolveError("measurements are inconsistent — no orientation fits");
  }
  const phi = Math.atan2(B, A);
  const base = Math.acos(Math.max(-1, Math.min(1, ratio)));
  const hint = ((input.rotationHint ?? 0) * Math.PI) / 180;
  const theta = [phi + base, phi - base].reduce((best, c) =>
    angularGap(c, hint) < angularGap(best, hint) ? c : best,
  );

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const xLine = xs[0];
  const yLine = ys[0];
  const x = xLine.target - (cos * xLine.o.x - sin * xLine.o.y);
  const y = yLine.target - (sin * yLine.o.x + cos * yLine.o.y);
  const rotation = (((theta * 180) / Math.PI) % 360 + 360) % 360;
  return { x, y, rotation };
}

/**
 * One card dimension line in an attachment solve: `distance` inches from board
 * `edge` to the piece's lock vertex. No feature ref — both of a piece's lines
 * reach the same locked vertex (the card pattern this solver exists for).
 */
export interface AttachLine {
  edge: BoardEdge;
  distance: number;
}

/**
 * One piece of a two-body attachment solve. The card pins exactly ONE vertex
 * (the keystone anchor) with two perpendicular dimension lines; the piece is
 * otherwise free to rotate about that point. The `attach` feature is what
 * connects it to the other piece and removes that rotational freedom.
 */
export interface AttachPiece {
  footprint: Footprint;
  mirror: Mirror;
  /** The vertex pinned by `lines` — the piece's keystone anchor vertex. */
  lockVertex: number;
  /** Two perpendicular card lines pinning the lock vertex: one must pin x, one y. */
  lines: [AttachLine, AttachLine];
  /**
   * The attached feature: a specific vertex, or the footprint edge running
   * from vertex `index` to vertex `index + 1` (wrapping).
   */
  attach: { kind: "vertex" | "edge"; index: number };
  /** Current rotation in degrees, used to pick among the candidate roots. */
  rotationHint?: number;
}

export interface AttachInput {
  /** Board extents in inches (40kdc standard is 60 × 44). */
  board: { width: number; height: number };
  /** The piece being placed. */
  a: AttachPiece;
  /** The piece it attaches to. */
  b: AttachPiece;
}

/** How far apart attached corners may be (measurement noise) before the solve refuses. */
const ATTACH_TOLERANCE = 0.1;

const cross = (p: Vec2, q: Vec2): number => p.x * q.y - p.y * q.x;
const angle = (v: Vec2): number => Math.atan2(v.y, v.x);

/** The board point a pair of perpendicular lock lines pins. */
function lockPoint(lines: [AttachLine, AttachLine], board: { width: number; height: number }): Vec2 {
  const coord = (l: AttachLine): { axis: "x" | "y"; value: number } => {
    switch (l.edge) {
      case "left":
        return { axis: "x", value: l.distance };
      case "right":
        return { axis: "x", value: board.width - l.distance };
      case "top":
        return { axis: "y", value: l.distance };
      case "bottom":
        return { axis: "y", value: board.height - l.distance };
    }
  };
  const a = coord(lines[0]);
  const b = coord(lines[1]);
  if (a.axis === b.axis) {
    throw new TerrainSolveError(
      "the two lock lines must pin different axes (one of left/right, one of top/bottom)",
    );
  }
  return { x: a.axis === "x" ? a.value : b.value, y: a.axis === "y" ? a.value : b.value };
}

interface AttachPrepared {
  /** Fixed board position of the lock vertex. */
  P: Vec2;
  /** Mirror-applied, pre-rotation offset of the lock vertex from the centroid. */
  lockOffset: Vec2;
  /** Mirror-applied, pre-rotation offsets of every vertex from the centroid. */
  offsets: Vec2[];
  hint: number;
}

function prepAttach(piece: AttachPiece, board: { width: number; height: number }): AttachPrepared {
  const offsets = orientedOffsets(piece.footprint, 0, piece.mirror);
  const lockOffset = offsets[piece.lockVertex];
  if (!lockOffset) throw new TerrainSolveError(`lock vertex index ${piece.lockVertex} out of range`);
  const n = offsets.length;
  if (piece.attach.index < 0 || piece.attach.index >= n) {
    throw new TerrainSolveError(`attach ${piece.attach.kind} index ${piece.attach.index} out of range`);
  }
  return {
    P: lockPoint(piece.lines, board),
    lockOffset,
    offsets,
    hint: ((piece.rotationHint ?? 0) * Math.PI) / 180,
  };
}

/** A candidate rotation pair (radians) for the two pieces. */
type AttachCandidate = { thetaA: number; thetaB: number };

/**
 * Vertex ↔ vertex (corners coincide; the joint pivots): each attach vertex
 * traces a circle about its lock point with the rigid lock→attach radius, so
 * the shared corner is a circle–circle intersection — two candidate points.
 */
function vertexCandidates(
  a: AttachPrepared,
  b: AttachPrepared,
  attachA: number,
  attachB: number,
): AttachCandidate[] {
  const relA = { x: a.offsets[attachA].x - a.lockOffset.x, y: a.offsets[attachA].y - a.lockOffset.y };
  const relB = { x: b.offsets[attachB].x - b.lockOffset.x, y: b.offsets[attachB].y - b.lockOffset.y };
  const r1 = Math.hypot(relA.x, relA.y);
  const r2 = Math.hypot(relB.x, relB.y);
  if (r1 < 1e-9 || r2 < 1e-9) {
    throw new TerrainSolveError("the attach vertex must differ from the lock vertex");
  }
  const D = { x: b.P.x - a.P.x, y: b.P.y - a.P.y };
  const d = Math.hypot(D.x, D.y);
  if (d < 1e-9) throw new TerrainSolveError("the two lock points coincide — nothing to attach across");
  const miss = Math.max(d - (r1 + r2), Math.abs(r1 - r2) - d);
  if (miss > ATTACH_TOLERANCE) {
    throw new TerrainSolveError(
      `attached corners cannot meet: the lock points are ${round2(d)}″ apart but the corner radii are ${round2(r1)}″ and ${round2(r2)}″`,
    );
  }
  // Circle–circle intersection; a tiny miss (measurement noise) clamps to tangent.
  const along = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const u = { x: D.x / d, y: D.y / d };
  const foot = { x: a.P.x + along * u.x, y: a.P.y + along * u.y };
  const points: Vec2[] =
    h < 1e-9
      ? [foot]
      : [
          { x: foot.x - h * u.y, y: foot.y + h * u.x },
          { x: foot.x + h * u.y, y: foot.y - h * u.x },
        ];
  return points.map((X) => ({
    thetaA: angle({ x: X.x - a.P.x, y: X.y - a.P.y }) - angle(relA),
    thetaB: angle({ x: X.x - b.P.x, y: X.y - b.P.y }) - angle(relB),
  }));
}

/**
 * Edge ↔ edge (edges flush; the contact slides): the signed perpendicular
 * offset of a lock vertex from its own edge line is rotation-invariant, so the
 * shared line is a common tangent of the two circles those offsets define.
 * With line direction `t̂(ψ)`: `cross(t̂, P_a − P_b) = σ_a − ε·σ_b` for the two
 * relative edge senses ε — up to four candidate orientations.
 */
function edgeCandidates(
  a: AttachPrepared,
  b: AttachPrepared,
  edgeA: number,
  edgeB: number,
): AttachCandidate[] {
  const edgeGeom = (p: AttachPrepared, e: number): { uAng: number; sigma: number } => {
    const v0 = p.offsets[e];
    const v1 = p.offsets[(e + 1) % p.offsets.length];
    const a0 = { x: v0.x - p.lockOffset.x, y: v0.y - p.lockOffset.y };
    const u = { x: v1.x - v0.x, y: v1.y - v0.y };
    const len = Math.hypot(u.x, u.y);
    if (len < 1e-9) throw new TerrainSolveError(`edge ${e} is degenerate (zero length)`);
    const uHat = { x: u.x / len, y: u.y / len };
    // Signed distance of the lock vertex from the (lock-relative) edge line.
    return { uAng: angle(uHat), sigma: cross(uHat, { x: -a0.x, y: -a0.y }) };
  };
  const ga = edgeGeom(a, edgeA);
  const gb = edgeGeom(b, edgeB);
  const D = { x: a.P.x - b.P.x, y: a.P.y - b.P.y };
  const d = Math.hypot(D.x, D.y);
  if (d < 1e-9) throw new TerrainSolveError("the two lock points coincide — nothing to attach across");
  const beta = angle(D);
  const out: AttachCandidate[] = [];
  for (const eps of [1, -1]) {
    const k = ga.sigma - eps * gb.sigma;
    const s = k / d;
    if (s > 1 + 1e-9 || s < -1 - 1e-9) continue;
    const asin = Math.asin(Math.max(-1, Math.min(1, s)));
    for (const psi of [beta - asin, beta - (Math.PI - asin)]) {
      out.push({
        thetaA: psi - ga.uAng,
        thetaB: psi - gb.uAng + (eps < 0 ? Math.PI : 0),
      });
    }
  }
  if (out.length === 0) {
    throw new TerrainSolveError(
      `attached edges cannot lie on a common line: the lock points are ${round2(d)}″ apart but the edge offsets are ${round2(ga.sigma)}″ and ${round2(gb.sigma)}″`,
    );
  }
  return out;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function attachPose(p: AttachPrepared, theta: number): { x: number; y: number; rotation: number } {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: p.P.x - (cos * p.lockOffset.x - sin * p.lockOffset.y),
    y: p.P.y - (sin * p.lockOffset.x + cos * p.lockOffset.y),
    rotation: ((((theta * 180) / Math.PI) % 360) + 360) % 360,
  };
}

/**
 * Back-solve the centroid AND rotation of TWO pieces at once from the cluster
 * card pattern: each piece's card prints exactly two dimension lines, both to
 * one vertex — pinning that vertex's board position but not the rotation. The
 * rotations come from the pieces' attachment to each other: matched vertices
 * coincide (the pair pivots), or matched edges lie on one line (the contact
 * slides — each piece's position along the line is fixed by its lock vertex).
 *
 * Closed form: with each lock vertex pinned, one rotation per piece is the
 * only unknown. Vertex mode intersects the two circles the attach vertices
 * sweep; edge mode finds the common line via the rotation-invariant signed
 * offset of each lock vertex from its own edge. Both yield a small candidate
 * set; the pair nearest the pieces' current rotations is chosen — rough both
 * pieces in first.
 */
export function solveCentroidAttached(input: AttachInput): {
  a: { x: number; y: number; rotation: number };
  b: { x: number; y: number; rotation: number };
} {
  const { a, b } = input;
  if (a.attach.kind !== b.attach.kind) {
    throw new TerrainSolveError(
      "attachment kinds must match: vertex pairs pivot, edge pairs slide — no mixing",
    );
  }
  const pa = prepAttach(a, input.board);
  const pb = prepAttach(b, input.board);
  const candidates =
    a.attach.kind === "vertex"
      ? vertexCandidates(pa, pb, a.attach.index, b.attach.index)
      : edgeCandidates(pa, pb, a.attach.index, b.attach.index);
  const best = candidates.reduce((bestSoFar, c) =>
    angularGap(c.thetaA, pa.hint) + angularGap(c.thetaB, pb.hint) <
    angularGap(bestSoFar.thetaA, pa.hint) + angularGap(bestSoFar.thetaB, pb.hint)
      ? c
      : bestSoFar,
  );
  return { a: attachPose(pa, best.thetaA), b: attachPose(pb, best.thetaB) };
}

/**
 * One card dimension line in a fixed-anchor solve: `distance` inches from board
 * `edge` to a specific footprint `vertex` of the moving piece. This single line
 * pins the one degree of freedom the attachment to the fixed anchor leaves.
 */
export interface FixedLockLine {
  edge: BoardEdge;
  distance: number;
  vertex: number;
}

/**
 * The already-placed piece the moving piece attaches to. Its pose is taken as
 * given — `vertices` are its resolved board-space polygon vertices (the
 * orientation-only offsets from {@link orientedOffsets} added to the piece's
 * board centroid) — and the solve never moves it.
 */
export interface FixedAnchor {
  vertices: Vec2[];
  /**
   * The anchor feature the moving piece contacts: a specific vertex, or the
   * footprint edge running from vertex `index` to vertex `index + 1` (wrapping).
   */
  attach: { kind: "vertex" | "edge"; index: number };
}

/** The piece being placed against a {@link FixedAnchor}. */
export interface MovingAttachPiece {
  footprint: Footprint;
  mirror: Mirror;
  /**
   * The moving feature that meets the anchor: a vertex (coincides with the
   * anchor vertex — the joint pivots), or the edge `index → index + 1` (lies
   * flush on the anchor edge — the contact slides). Must match the anchor's kind.
   */
  attach: { kind: "vertex" | "edge"; index: number };
  /** The single card line pinning the remaining freedom. */
  line: FixedLockLine;
  /** Current rotation in degrees, used to pick among the candidate roots. */
  rotationHint?: number;
}

export interface SolveAgainstFixedInput {
  /** Board extents in inches (40kdc standard is 60 × 44). */
  board: { width: number; height: number };
  moving: MovingAttachPiece;
  fixed: FixedAnchor;
}

/** The board coordinate (and axis) a single edge measurement pins. */
function edgeTarget(
  edge: BoardEdge,
  distance: number,
  board: { width: number; height: number },
): { axis: "x" | "y"; value: number } {
  switch (edge) {
    case "left":
      return { axis: "x", value: distance };
    case "right":
      return { axis: "x", value: board.width - distance };
    case "top":
      return { axis: "y", value: distance };
    case "bottom":
      return { axis: "y", value: board.height - distance };
  }
}

/**
 * Back-solve the centroid AND rotation of ONE piece against an already-placed
 * anchor. The attachment removes two degrees of freedom — corners coincide
 * (the joint pivots) or edges lie flush (the contact slides) — so a single card
 * dimension line pins what remains. The anchor is given by its resolved
 * board-space `vertices` and never moves.
 *
 * Closed form:
 * - **vertex mode** — the moving attach vertex equals the fixed point `P`, so
 *   `centroid = P − R(θ)·o_att`. The lock line to vertex `j` resolves to
 *   `P + R(θ)·(o_j − o_att)`; pinning one axis gives `A·cosθ + B·sinθ = C`,
 *   solved `θ = atan2(B,A) ± acos(C/√(A²+B²))`, the root nearest `rotationHint`.
 * - **edge mode** — flush forces the moving edge parallel to the anchor edge
 *   (two senses → two θ), and for each θ the centroid solves from a 2×2 linear
 *   system: the flush line equation plus the single lock line. The candidate
 *   nearest `rotationHint` wins.
 */
export function solveCentroidAgainstFixed(
  input: SolveAgainstFixedInput,
): { x: number; y: number; rotation: number } {
  const { moving, fixed, board } = input;
  if (moving.attach.kind !== fixed.attach.kind) {
    throw new TerrainSolveError(
      "attachment kinds must match: a vertex pins to a vertex, an edge lies flush on an edge — no mixing",
    );
  }
  // Mirror-applied, pre-rotation offsets (θ is the unknown we solve for).
  const offsets = orientedOffsets(moving.footprint, 0, moving.mirror);
  const n = offsets.length;
  const m = fixed.vertices.length;
  if (moving.attach.index < 0 || moving.attach.index >= n) {
    throw new TerrainSolveError(`moving attach ${moving.attach.kind} index ${moving.attach.index} out of range`);
  }
  if (fixed.attach.index < 0 || fixed.attach.index >= m) {
    throw new TerrainSolveError(`fixed attach ${fixed.attach.kind} index ${fixed.attach.index} out of range`);
  }
  const oj = offsets[moving.line.vertex];
  if (!oj) throw new TerrainSolveError(`lock line vertex index ${moving.line.vertex} out of range`);
  const hint = ((moving.rotationHint ?? 0) * Math.PI) / 180;
  const target = edgeTarget(moving.line.edge, moving.line.distance, board);

  const pose = (theta: number, centroid: Vec2): { x: number; y: number; rotation: number } => ({
    x: centroid.x,
    y: centroid.y,
    rotation: ((((theta * 180) / Math.PI) % 360) + 360) % 360,
  });

  if (moving.attach.kind === "vertex") {
    const P = fixed.vertices[fixed.attach.index];
    const oAtt = offsets[moving.attach.index];
    const rel = { x: oj.x - oAtt.x, y: oj.y - oAtt.y };
    if (Math.hypot(rel.x, rel.y) < 1e-9) {
      throw new TerrainSolveError("the lock line must measure to a different vertex than the attach corner");
    }
    // P.axis + (R(θ)·rel).axis = target → A·cosθ + B·sinθ = C.
    const A = target.axis === "x" ? rel.x : rel.y;
    const B = target.axis === "x" ? -rel.y : rel.x;
    const C = target.value - (target.axis === "x" ? P.x : P.y);
    const R = Math.hypot(A, B);
    const ratio = C / R;
    if (ratio > 1 + 1e-6 || ratio < -1 - 1e-6) {
      throw new TerrainSolveError(
        `the locked corner is only ${round2(R)}″ from the attach corner — it cannot reach that measurement`,
      );
    }
    const phi = Math.atan2(B, A);
    const baseAcos = Math.acos(Math.max(-1, Math.min(1, ratio)));
    const theta = [phi + baseAcos, phi - baseAcos].reduce((best, c) =>
      angularGap(c, hint) < angularGap(best, hint) ? c : best,
    );
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // centroid = P − R(θ)·o_att.
    const centroid = {
      x: P.x - (cos * oAtt.x - sin * oAtt.y),
      y: P.y - (sin * oAtt.x + cos * oAtt.y),
    };
    return pose(theta, centroid);
  }

  // Edge mode: the moving edge ei→ei+1 lies flush on the anchor edge fi→fi+1.
  const ei = moving.attach.index;
  const oe = offsets[ei];
  const oe1 = offsets[(ei + 1) % n];
  const u = { x: oe1.x - oe.x, y: oe1.y - oe.y };
  if (Math.hypot(u.x, u.y) < 1e-9) {
    throw new TerrainSolveError(`moving edge ${ei} is degenerate (zero length)`);
  }
  const fi = fixed.attach.index;
  const F0 = fixed.vertices[fi];
  const F1 = fixed.vertices[(fi + 1) % m];
  const t = { x: F1.x - F0.x, y: F1.y - F0.y };
  const tLen = Math.hypot(t.x, t.y);
  if (tLen < 1e-9) {
    throw new TerrainSolveError(`anchor edge ${fi} is degenerate (zero length)`);
  }
  const tHat = { x: t.x / tLen, y: t.y / tLen };
  const uAng = angle(u);
  const tAng = angle(tHat);
  // angle(R(θ)·u) = angle(u) + θ, so parallel ⇒ θ = tAng − uAng (same sense) or +π (opposite).
  const candidates = [tAng - uAng, tAng + Math.PI - uAng];

  let best: { theta: number; centroid: Vec2 } | null = null;
  for (const theta of candidates) {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rot = (v: Vec2): Vec2 => ({ x: cos * v.x - sin * v.y, y: sin * v.x + cos * v.y });
    // Flush: cross(t̂, c + R(θ)·o_e − F0) = 0.
    //   (−t̂.y)·cx + (t̂.x)·cy = t̂.y·q.x − t̂.x·q.y,  q = R(θ)·o_e − F0
    const q = rot(oe);
    q.x -= F0.x;
    q.y -= F0.y;
    const a1 = -tHat.y;
    const b1 = tHat.x;
    const d1 = tHat.y * q.x - tHat.x * q.y;
    // Lock line: pins one axis of (c + R(θ)·o_j).
    const rj = rot(oj);
    const a2 = target.axis === "x" ? 1 : 0;
    const b2 = target.axis === "x" ? 0 : 1;
    const d2 = target.value - (target.axis === "x" ? rj.x : rj.y);
    const det = a1 * b2 - b1 * a2;
    if (Math.abs(det) < 1e-9) continue; // lock line parallel to the contact edge for this θ
    const centroid = {
      x: (d1 * b2 - b1 * d2) / det,
      y: (a1 * d2 - d1 * a2) / det,
    };
    if (best === null || angularGap(theta, hint) < angularGap(best.theta, hint)) {
      best = { theta, centroid };
    }
  }
  if (best === null) {
    throw new TerrainSolveError(
      "the lock line is parallel to the contact edge — measure to the other axis (left/right vs top/bottom)",
    );
  }
  return pose(best.theta, best.centroid);
}
