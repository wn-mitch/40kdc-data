/**
 * Pure polygon math for the hull tracer. Kept local (not imported from the
 * dataset's internal terrain helpers) so it is independently unit-tested and
 * the tool has no runtime dependency on the package. All functions are
 * coordinate-system agnostic — the caller decides whether `Vec2`s are pixels
 * or inches.
 */
import type { Vec2 } from "./types.js";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounding box of a point set. Returns null for an empty set. */
export function boundingBox(points: readonly Vec2[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Width and height of the bounding box; zeros for an empty set. */
export function boundsSize(points: readonly Vec2[]): { width: number; height: number } {
  const b = boundingBox(points);
  if (!b) return { width: 0, height: 0 };
  return { width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/**
 * Area-weighted centroid of a (closed) polygon via the shoelace formula. For a
 * degenerate polygon (fewer than 3 points, or zero signed area — e.g. all
 * points collinear) it falls back to the arithmetic mean of the vertices so
 * the result is always finite.
 */
export function polygonCentroid(points: readonly Vec2[]): Vec2 {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n < 3) return meanPoint(points);

  let area2 = 0; // twice the signed area
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (area2 === 0) return meanPoint(points);
  return { x: cx / (3 * area2), y: cy / (3 * area2) };
}

function meanPoint(points: readonly Vec2[]): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/** Round to a fixed number of decimal places, normalising -0 to 0. */
export function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
}

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The on-screen scale of an image drawn into a viewport with
 * `preserveAspectRatio="xMidYMid meet"` — i.e. uniformly scaled to fit, letter-
 * boxed on the longer axis. Returns the single fit factor: one user-space unit
 * (image pixel) maps to this many CSS pixels on screen. Guards against a
 * zero/degenerate viewport or image (returns 1, the identity scale) so callers
 * never divide by it and get NaN/Infinity.
 */
export function displayScale(
  viewportW: number,
  viewportH: number,
  imageW: number,
  imageH: number,
): number {
  if (viewportW <= 0 || viewportH <= 0 || imageW <= 0 || imageH <= 0) return 1;
  return Math.min(viewportW / imageW, viewportH / imageH);
}

/**
 * The user-space radius that renders at `targetPx` CSS pixels on screen, given
 * the current {@link displayScale}. SVG `<circle r>` is in user space and scales
 * with the content group (unlike `stroke-width` under `non-scaling-stroke`), so
 * to hold a constant on-screen handle size we divide the target by the scale.
 * A non-positive scale falls back to `targetPx` (identity) rather than blowing
 * up to Infinity.
 */
export function screenToUserRadius(targetPx: number, scale: number): number {
  if (!(scale > 0)) return targetPx;
  return targetPx / scale;
}

/**
 * Rotate a point about the origin by `degrees`. Coordinates are y-down (image /
 * board convention), so a positive angle reads as clockwise on screen.
 */
export function rotatePoint(p: Vec2, degrees: number): Vec2 {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** Rotate every point about the origin (see {@link rotatePoint}). A whole-turn
 * angle returns a copy unchanged (avoids floating-point drift at 0/360). */
export function rotatePoints(points: readonly Vec2[], degrees: number): Vec2[] {
  if (degrees % 360 === 0) return points.map((p) => ({ x: p.x, y: p.y }));
  return points.map((p) => rotatePoint(p, degrees));
}

/**
 * Scale traced pixel points to inches and recenter them on the polygon's area
 * centroid — the same origin convention `export.ts` uses for the stored hull,
 * so the preview's model matches what gets exported. A non-positive
 * `pxPerInch` returns the points unchanged (caller gates on a real scale).
 */
export function toCenteredInches(pixelPoints: readonly Vec2[], pxPerInch: number): Vec2[] {
  if (!(pxPerInch > 0)) return pixelPoints.map((p) => ({ x: p.x, y: p.y }));
  const inches = pixelPoints.map((p) => ({ x: p.x / pxPerInch, y: p.y / pxPerInch }));
  const c = polygonCentroid(inches);
  return inches.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

/** The entity-id contract: kebab-case, 2–128 chars, no leading/trailing dash. */
const ENTITY_ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export function isValidEntityId(id: string): boolean {
  return id.length >= 2 && id.length <= 128 && ENTITY_ID_RE.test(id);
}

/**
 * Derive a candidate entity id from a free-text name: lowercase, runs of
 * non-alphanumerics collapsed to a single dash, leading/trailing dashes
 * trimmed, clamped to 128 chars. May still be invalid (e.g. empty, or a single
 * character) — callers should check {@link isValidEntityId}.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128)
    .replace(/-+$/g, "");
}
