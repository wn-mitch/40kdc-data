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
import { orientedOffsets, type Footprint, type Mirror, type Vec2 } from "./resolve.js";

/** A board edge a card dimension is measured from. left/right pin x; top/bottom pin y. */
export type BoardEdge = "left" | "right" | "top" | "bottom";

/**
 * Which feature of the placed area a dimension line reaches: a specific
 * footprint vertex (by index, in {@link footprintVertices} order), or one of
 * the placed area's axis-aligned bounding faces ("the left face", etc.).
 */
export type FeatureRef =
  | { kind: "vertex"; index: number }
  | { kind: "face"; side: "min-x" | "max-x" | "min-y" | "max-y" };

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
