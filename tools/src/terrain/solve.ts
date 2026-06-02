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
