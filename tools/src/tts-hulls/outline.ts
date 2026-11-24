/**
 * Turn a Tabletop Simulator model mesh into a `hull-shape` record: place the
 * mesh upright the way TTS does, project it straight down, rasterise the
 * projection, drop overhangs thinner than a few millimetres (aerials, thin
 * barrels, chains), and trace and simplify the outline.
 *
 * Every step is deterministic: the same mesh bytes and placement always give
 * the same record. The output follows the hull tracer's conventions
 * (`examples/hull-tracer/src/lib/export.ts`): inches, y-down, centred on the
 * polygon's area centroid, 3 dp, cached bounds. Only geometry and identity
 * leave this module; the mesh itself never enters the dataset.
 *
 * Coordinate conventions. TTS is a Unity game: world Y is up, one world unit is
 * one inch on the 40k tables, and Unity's OBJ import negates X to go from the
 * file's right-handed axes to Unity's left-handed ones. Looking straight down,
 * world +X is screen right and world +Z is screen up, so the y-down outline is
 * (X, -Z). Unity applies Euler angles in Z, X, Y order; the placement's yaw (Y)
 * only spins the model on the table, so it is dropped and the outline is
 * instead turned so its longer side runs along y.
 */
import type { HullShape } from "../generated.js";
import { polygonCentroid, type Vec2 } from "../terrain/resolve.js";

export interface Mesh {
  /** x, y, z per vertex, in file units. */
  positions: Float64Array;
  /** Three vertex indices per triangle. */
  triangles: Uint32Array;
}

/** How the model sits on the TTS table, from its saved Transform. */
export interface Placement {
  /** Uniform Transform scale (TTS world inches per file unit). */
  scale: number;
  /** Transform rotX / rotZ in degrees; nonzero when the file is not Y-up. */
  rotXDeg: number;
  rotZDeg: number;
  /**
   * Inches above the placed mesh's lowest point. Triangles lying entirely at or
   * below it are dropped before projecting: set it just above the top of a
   * display base modelled into the mesh, so the outline is the model, not the base.
   */
  dropBelowIn?: number;
}

export interface OutlineOptions {
  /** Raster cell size in inches. */
  cellIn: number;
  /** Overhangs narrower than twice this radius (inches) are not hull. */
  openingRadiusIn: number;
  /** Douglas-Peucker tolerance in inches; raised until the vertex budget holds. */
  simplifyIn: number;
  maxVertices: number;
}

export const DEFAULT_OUTLINE: OutlineOptions = {
  cellIn: 0.01,
  // 2 mm: drops anything under 4 mm wide (aerials, chains, thin barrels) and
  // keeps track units, sponsons and the heavy guns a player measures to.
  openingRadiusIn: 2 / 25.4,
  simplifyIn: 0.015,
  maxVertices: 96,
};

/** Parse the geometry of a Wavefront OBJ: `v` lines and `f` lines (polygons fan-triangulated). */
export function parseObj(text: string): Mesh {
  const pos: number[] = [];
  const tri: number[] = [];
  let count = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const p = line.split(/\s+/);
      pos.push(Number(p[1]), Number(p[2]), Number(p[3]));
      count++;
    } else if (line.startsWith("f ")) {
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((tok) => {
          const n = parseInt(tok.split("/")[0], 10);
          return n < 0 ? count + n : n - 1;
        });
      for (let i = 1; i + 1 < idx.length; i++) tri.push(idx[0], idx[i], idx[i + 1]);
    }
  }
  for (const v of pos) if (!Number.isFinite(v)) throw new Error("OBJ has a non-numeric vertex");
  for (const i of tri) if (i < 0 || i >= count) throw new Error(`OBJ face index ${i + 1} out of range`);
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tri) };
}

type Vec3 = [number, number, number];

/** One piece of a model: the parent mesh, or a child object with its Transform local to the parent. */
export interface Part {
  mesh: Mesh;
  position?: Vec3;
  /** Euler degrees, as TTS saves them. */
  rotation?: Vec3;
  scale?: Vec3;
}

/**
 * Join a model's parts into one mesh in the parent's file units. TTS keeps
 * turrets, sponsons and weapons as `ChildObjects` whose Transform is local to the
 * parent, so a model's footprint is the union of every part. Each part is moved
 * into Unity space (x mirrored), scaled, rotated Z then X then Y, offset, and
 * mirrored back so {@link projectTopDown} treats the result like any file mesh.
 */
export function joinParts(parts: Part[]): Mesh {
  const pos: number[] = [];
  const tri: number[] = [];
  for (const part of parts) {
    const base = pos.length / 3;
    const [px, py, pz] = part.position ?? [0, 0, 0];
    const [sx, sy, sz] = part.scale ?? [1, 1, 1];
    const [rx, ry, rz] = (part.rotation ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      let x = -p[i] * sx, y = p[i + 1] * sy, z = p[i + 2] * sz;
      [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
      [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
      pos.push(-(x + px), y + py, z + pz);
    }
    for (const t of part.mesh.triangles) tri.push(t + base);
  }
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tri) };
}

/** Top-down (x, y-down) inches and height above the table for every vertex of the placed mesh. */
export function projectTopDown(mesh: Mesh, placement: Placement): { xy: Float64Array; height: Float64Array } {
  const ax = (placement.rotXDeg * Math.PI) / 180;
  const az = (placement.rotZDeg * Math.PI) / 180;
  const [cx, sx, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(az), Math.sin(az)];
  const n = mesh.positions.length / 3;
  const out = new Float64Array(n * 2);
  const height = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let x = -mesh.positions[i * 3] * placement.scale;
    let y = mesh.positions[i * 3 + 1] * placement.scale;
    let z = mesh.positions[i * 3 + 2] * placement.scale;
    // Unity Z then X rotation (left-handed, so these are Unity's matrices).
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    out[i * 2] = x;
    out[i * 2 + 1] = -z;
    height[i] = y;
  }
  return { xy: out, height };
}

/** The mesh without the triangles lying entirely at or below `drop` inches above its lowest point. */
function dropBase(mesh: Mesh, height: Float64Array, drop: number): Mesh {
  let floor = Infinity;
  for (const h of height) floor = Math.min(floor, h);
  const t = mesh.triangles;
  const kept: number[] = [];
  for (let k = 0; k < t.length; k += 3) {
    if (Math.max(height[t[k]], height[t[k + 1]], height[t[k + 2]]) > floor + drop) kept.push(t[k], t[k + 1], t[k + 2]);
  }
  return { positions: mesh.positions, triangles: Uint32Array.from(kept) };
}

interface Grid {
  w: number;
  h: number;
  cells: Uint8Array;
  /** Inches of the grid's (0, 0) corner. */
  x0: number;
  y0: number;
  cell: number;
}

/** Fill every cell whose centre lies inside a projected triangle. */
function rasterise(mesh: Mesh, xy: Float64Array, cell: number, pad: number): Grid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < mesh.triangles.length; i++) {
    const v = mesh.triangles[i];
    minX = Math.min(minX, xy[v * 2]);
    maxX = Math.max(maxX, xy[v * 2]);
    minY = Math.min(minY, xy[v * 2 + 1]);
    maxY = Math.max(maxY, xy[v * 2 + 1]);
  }
  if (!Number.isFinite(minX)) throw new Error("mesh has no faces");
  const x0 = minX - pad * cell;
  const y0 = minY - pad * cell;
  const w = Math.ceil((maxX - minX) / cell) + 2 * pad + 1;
  const h = Math.ceil((maxY - minY) / cell) + 2 * pad + 1;
  if (w * h > 20_000_000) throw new Error(`projection too large (${w}x${h} cells)`);
  const cells = new Uint8Array(w * h);
  const t = mesh.triangles;
  for (let k = 0; k < t.length; k += 3) {
    const ax = (xy[t[k] * 2] - x0) / cell, ay = (xy[t[k] * 2 + 1] - y0) / cell;
    const bx = (xy[t[k + 1] * 2] - x0) / cell, by = (xy[t[k + 1] * 2 + 1] - y0) / cell;
    const cx = (xy[t[k + 2] * 2] - x0) / cell, cy = (xy[t[k + 2] * 2 + 1] - y0) / cell;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const s = area > 0 ? 1 : -1;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
    const i1 = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
    const j1 = Math.min(h - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    for (let j = j0; j <= j1; j++) {
      const py = j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const px = i + 0.5;
        const e0 = s * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
        const e1 = s * ((cx - bx) * (py - by) - (cy - by) * (px - bx));
        const e2 = s * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx));
        if (e0 >= 0 && e1 >= 0 && e2 >= 0) cells[j * w + i] = 1;
      }
    }
  }
  return { w, h, cells, x0, y0, cell };
}

/** Squared Euclidean distance (in cells) from each cell to the nearest cell where `isSeed` holds. */
function distanceSquared(w: number, h: number, isSeed: (k: number) => boolean): Float64Array {
  const INF = 1e20;
  const d = new Float64Array(w * h);
  for (let k = 0; k < w * h; k++) d[k] = isSeed(k) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), out = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  // Felzenszwalb & Huttenlocher's 1-D lower envelope, run over columns then rows.
  const pass = (len: number, get: (q: number) => number, set: (q: number, x: number) => void) => {
    for (let q = 0; q < len; q++) f[q] = get(q);
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    for (let q = 0; q < len; q++) set(q, out[q]);
  };
  for (let i = 0; i < w; i++) pass(h, (q) => d[q * w + i], (q, x) => (d[q * w + i] = x));
  for (let j = 0; j < h; j++) pass(w, (q) => d[j * w + q], (q, x) => (d[j * w + q] = x));
  return d;
}

/** Morphological opening with a disc: erase every part a disc of radius `r` cells cannot reach. */
function open(w: number, h: number, cells: Uint8Array, r: number): Uint8Array {
  const r2 = r * r;
  const toEmpty = distanceSquared(w, h, (k) => cells[k] === 0);
  const toCore = distanceSquared(w, h, (k) => toEmpty[k] > r2);
  const out = new Uint8Array(w * h);
  for (let k = 0; k < out.length; k++) out[k] = toCore[k] <= r2 ? 1 : 0;
  return out;
}

/** Morphological closing with a disc: seal gaps narrower than 2r cells (unwelded seams, open hatches). */
function close(w: number, h: number, cells: Uint8Array, r: number): Uint8Array {
  const r2 = r * r;
  const toFilled = distanceSquared(w, h, (k) => cells[k] === 1);
  const toOutside = distanceSquared(w, h, (k) => toFilled[k] > r2);
  const out = new Uint8Array(w * h);
  for (let k = 0; k < out.length; k++) out[k] = toOutside[k] > r2 ? 1 : 0;
  return out;
}

/** Fill every empty region the border cannot reach. */
function fillHoles(w: number, h: number, cells: Uint8Array): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let k = 0; k < w * h; k++) {
    const i = k % w, j = (k - i) / w;
    if ((i === 0 || j === 0 || i === w - 1 || j === h - 1) && !cells[k]) {
      outside[k] = 1;
      stack.push(k);
    }
  }
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % w, j = (k - i) / w;
    for (const n of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1]) {
      if (n >= 0 && !outside[n] && !cells[n]) {
        outside[n] = 1;
        stack.push(n);
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) out[k] = outside[k] ? 0 : 1;
  return out;
}

/** Keep the largest 4-connected component and fill its holes. */
function largestSolid(w: number, h: number, cells: Uint8Array): Uint8Array {
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  let best = -1, bestSize = 0, next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!cells[start] || label[start] >= 0) continue;
    let size = 0;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const i = k % w, j = (k - i) / w;
      for (const n of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1]) {
        if (n >= 0 && cells[n] && label[n] < 0) {
          label[n] = next;
          stack.push(n);
        }
      }
    }
    if (size > bestSize) [best, bestSize] = [next, size];
    next++;
  }
  if (best < 0) throw new Error("projection is empty after removing thin overhangs");
  const kept = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) kept[k] = label[k] === best ? 1 : 0;
  return fillHoles(w, h, kept);
}

/** The outer boundary of a solid region, as cell-corner points (clockwise on screen). */
function traceOuter(w: number, h: number, solid: Uint8Array): Vec2[] {
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && solid[j * w + i] === 1;
  // Directed boundary edges with the solid on the right; key = corner index.
  const W = w + 1;
  const out = new Map<number, number[]>();
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const a = ay * W + ax;
    const list = out.get(a);
    if (list) list.push(by * W + bx);
    else out.set(a, [by * W + bx]);
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) edge(i, j, i + 1, j);
      if (!filled(i + 1, j)) edge(i + 1, j, i + 1, j + 1);
      if (!filled(i, j + 1)) edge(i + 1, j + 1, i, j + 1);
      if (!filled(i - 1, j)) edge(i, j + 1, i, j);
    }
  }
  let best: number[] = [];
  let bestArea = 0;
  for (const start of [...out.keys()].sort((a, b) => a - b)) {
    while ((out.get(start)?.length ?? 0) > 0) {
      const loop = [start];
      let prev = start;
      let cur = out.get(start)!.shift()!;
      while (cur !== start) {
        loop.push(cur);
        const options = out.get(cur)!;
        // At a pinch corner, take the sharpest right turn so diagonal-touching cells stay split.
        let pick = 0;
        if (options.length > 1) {
          const dx = (cur % W) - (prev % W), dy = Math.floor(cur / W) - Math.floor(prev / W);
          pick = options.findIndex((n) => {
            const ex = (n % W) - (cur % W), ey = Math.floor(n / W) - Math.floor(cur / W);
            return dx * ey - dy * ex > 0;
          });
          if (pick < 0) pick = 0;
        }
        prev = cur;
        cur = options.splice(pick, 1)[0];
      }
      let area = 0;
      for (let k = 0; k < loop.length; k++) {
        const a = loop[k], b = loop[(k + 1) % loop.length];
        area += (a % W) * Math.floor(b / W) - (b % W) * Math.floor(a / W);
      }
      if (Math.abs(area) > bestArea) [best, bestArea] = [loop, Math.abs(area)];
    }
  }
  return best.map((c) => ({ x: c % W, y: Math.floor(c / W) }));
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdp(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  let worst = 0, at = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const d = segmentDistance(pts[k], pts[0], pts[pts.length - 1]);
    if (d > worst) [worst, at] = [d, k];
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, at + 1), tol);
  return left.slice(0, -1).concat(rdp(pts.slice(at), tol));
}

/** Simplify a closed loop, splitting it at its first point and the point farthest from it. */
function simplifyClosed(loop: Vec2[], tol: number): Vec2[] {
  let far = 0, farD = -1;
  for (let k = 0; k < loop.length; k++) {
    const d = Math.hypot(loop[k].x - loop[0].x, loop[k].y - loop[0].y);
    if (d > farD) [far, farD] = [k, d];
  }
  const a = rdp(loop.slice(0, far + 1), tol);
  const b = rdp(loop.slice(far).concat([loop[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** The simplified top-down hull outline of a placed mesh, in inches (y-down, uncentred). */
export function meshOutline(mesh: Mesh, placement: Placement, opts: OutlineOptions = DEFAULT_OUTLINE): Vec2[] {
  const r = opts.openingRadiusIn / opts.cellIn;
  const { xy, height } = projectTopDown(mesh, placement);
  const body = placement.dropBelowIn ? dropBase(mesh, height, placement.dropBelowIn) : mesh;
  const g = rasterise(body, xy, opts.cellIn, Math.ceil(r) + 2);
  // Seal seams and fill the interior first, so a hollow shell mesh still projects
  // as solid; then drop the thin overhangs.
  const sealed = fillHoles(g.w, g.h, r > 0 ? close(g.w, g.h, g.cells, r) : g.cells);
  const solid = largestSolid(g.w, g.h, r > 0 ? open(g.w, g.h, sealed, r) : sealed);
  let loop = traceOuter(g.w, g.h, solid).map((p) => ({ x: g.x0 + p.x * g.cell, y: g.y0 + p.y * g.cell }));
  // Turn the outline so its longer side runs along y.
  const xs = loop.map((p) => p.x), ys = loop.map((p) => p.y);
  if (Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys)) {
    loop = loop.map((p) => ({ x: -p.y, y: p.x }));
  }
  let tol = opts.simplifyIn;
  let pts = simplifyClosed(loop, tol);
  while (pts.length > opts.maxVertices) {
    tol *= 1.25;
    pts = simplifyClosed(loop, tol);
  }
  return pts;
}

const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

/** Centre an inch outline on its area centroid and wrap it as a schema-shaped hull-shape record. */
export function hullShapeRecord(
  id: string,
  name: string,
  outline: Vec2[],
  gameVersion: { edition: string; dataslate: string },
): HullShape {
  const c = polygonCentroid(outline);
  const points: Vec2[] = [];
  for (const p of outline) {
    const q = { x: round3(p.x - c.x), y: round3(p.y - c.y) };
    const last = points[points.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) points.push(q);
  }
  if (points.length > 1 && points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y) {
    points.pop();
  }
  if (points.length < 3) throw new Error(`${id}: outline collapsed to ${points.length} points`);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return {
    id,
    name,
    points: points as [Vec2, Vec2, Vec2, ...Vec2[]],
    bounds_width_in: round3(Math.max(...xs) - Math.min(...xs)),
    bounds_height_in: round3(Math.max(...ys) - Math.min(...ys)),
    game_version: gameVersion,
  };
}
