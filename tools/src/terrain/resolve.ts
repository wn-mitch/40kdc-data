/**
 * Terrain layout resolver — turns a {@link TerrainLayout} (template references +
 * centroid-anchored placements + rotation/mirror) into absolute board-space
 * polygon vertices. This is the shared geometry contract pinned by the
 * `conformance/terrain-resolver` corpus; the Rust crate implements the same
 * function and must reproduce these vertices byte-for-byte (4-dp rounded).
 *
 * ## Transform contract
 *
 * Frames are board inches, origin at a board corner, **y-down** (per
 * `common.schema.json#/$defs/vec2`). A footprint is authored in natural local
 * y-down coordinates; the resolver derives its **polygon area centroid** and
 * treats local vertices as `(v - centroid)`, so `position` always denotes the
 * centroid and is invariant under rotation and mirror.
 *
 * Local → board, for an unparented piece, is `mirror → rotate → translate`:
 *
 *   board = position + R_cw(rotation) · M(mirror) · (v - centroid)
 *
 * with `M`: horizontal → (-x, y), vertical → (x, -y); and `R_cw(θ)` a clockwise
 * rotation in the y-down frame, `[[cosθ, -sinθ], [sinθ, cosθ]]`.
 *
 * A feature with a `parent_area_id` (or a template's composed feature) is first
 * placed in the parent area's **centroid-local frame** (origin at the area
 * centroid), then carried through the area's own placement:
 *
 *   board = T_area ∘ R_area ∘ M_area ( featurePos + R_feat · M_feat · (w - C_feat) )
 *
 * ## Emission order (a pinned invariant)
 *
 * Pieces are emitted in `layout.pieces` order. When a piece instances an area
 * template that carries composed `features`, those features are emitted
 * immediately after their area, in template-declaration order.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type Footprint =
  | { type: "rectangle"; width: number; height: number }
  | { type: "right-triangle"; width: number; height: number }
  | { type: "polygon"; points: Vec2[] };

export type Mirror = "none" | "horizontal" | "vertical";

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

/**
 * One authored measurement keystone: the dimension line a reference card
 * prints so a player can place the piece with a tape measure. Only the
 * selection is stored — the distance is always derived from resolved geometry
 * (see `keystoneMeasurements`), so a keystone can never disagree with the
 * layout.
 */
export interface Keystone {
  edge: BoardEdge;
  ref: FeatureRef;
}

export interface ComposedFeature {
  id?: string;
  template: string;
  position: Vec2;
  rotation_degrees?: number;
  mirror?: Mirror;
  floor?: number;
}

export interface TerrainTemplate {
  id: string;
  name?: string;
  kind: "area" | "feature";
  footprint: Footprint;
  default_height_inches?: number;
  default_blocking?: boolean;
  default_terrain_area_keywords?: string[];
  features?: ComposedFeature[];
  terrain_category?: string;
}

export interface LayoutPiece {
  id?: string;
  name?: string;
  piece_type?: "area" | "feature";
  template?: string;
  footprint?: Footprint;
  position: Vec2;
  rotation_degrees?: number;
  mirror?: Mirror;
  parent_area_id?: string;
  floor?: number;
  height_inches?: number;
  terrain_area_keywords?: string[];
  link_group?: string;
  keystones?: Keystone[];
}

export interface TerrainLayout {
  id: string;
  name: string;
  pieces?: LayoutPiece[];
}

export interface ResolvedPiece {
  /** Layout-local id when present, else the piece name, else null. */
  id: string | null;
  name: string | null;
  piece_type: "area" | "feature";
  floor: number;
  /** Absolute board-space polygon vertices, y-down. */
  vertices: Vec2[];
}

const DEG = Math.PI / 180;

/** A footprint's polygon vertices in natural local (y-down) coordinates. */
export function footprintVertices(fp: Footprint): Vec2[] {
  switch (fp.type) {
    case "rectangle":
      return [
        { x: 0, y: 0 },
        { x: fp.width, y: 0 },
        { x: fp.width, y: fp.height },
        { x: 0, y: fp.height },
      ];
    case "right-triangle":
      // Right angle at the local origin, legs along +x and +y.
      return [
        { x: 0, y: 0 },
        { x: fp.width, y: 0 },
        { x: 0, y: fp.height },
      ];
    case "polygon":
      return fp.points.map((p) => ({ x: p.x, y: p.y }));
    default: {
      const exhaustive: never = fp;
      throw new Error(`unknown footprint type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Polygon area centroid (shoelace). Falls back to the vertex mean when the
 * polygon is degenerate (zero signed area, e.g. collinear points) so the
 * resolver never divides by zero.
 */
export function polygonCentroid(verts: Vec2[]): Vec2 {
  const n = verts.length;
  if (n === 0) return { x: 0, y: 0 };
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (twiceArea === 0) {
    const mean = verts.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }), { x: 0, y: 0 });
    return { x: mean.x / n, y: mean.y / n };
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

function applyMirror(v: Vec2, m: Mirror): Vec2 {
  switch (m) {
    case "horizontal":
      return { x: -v.x, y: v.y };
    case "vertical":
      return { x: v.x, y: -v.y };
    default:
      return v;
  }
}

/** Clockwise rotation by `deg` degrees in the y-down frame. */
function rotateCw(v: Vec2, deg: number): Vec2 {
  if (deg === 0) return { x: v.x, y: v.y };
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/** mirror → rotate (no translation). The orientation-only part of a placement. */
function orient(v: Vec2, rotation: number, mirror: Mirror): Vec2 {
  return rotateCw(applyMirror(v, mirror), rotation);
}

/**
 * The board-space offset of each footprint vertex from the piece centroid,
 * after mirror + rotation but before translation. Adding `position` to each
 * gives the resolved board vertices; this is the orientation-only part a
 * card-measurement solver inverts to recover the centroid. Vertex order matches
 * {@link footprintVertices}.
 */
export function orientedOffsets(footprint: Footprint, rotation: number, mirror: Mirror): Vec2[] {
  const verts = footprintVertices(footprint);
  const c = polygonCentroid(verts);
  return verts.map((v) => orient({ x: v.x - c.x, y: v.y - c.y }, rotation, mirror));
}

/**
 * Place a footprint's local vertices into a target frame: recenter on the
 * footprint centroid, mirror, rotate, then translate so the centroid lands on
 * `position`. The target frame is board space for an area, or the parent area's
 * centroid-local frame for a composed/parented feature.
 */
function placeFootprint(
  fp: Footprint,
  position: Vec2,
  rotation: number,
  mirror: Mirror,
): Vec2[] {
  const verts = footprintVertices(fp);
  const c = polygonCentroid(verts);
  return verts.map((v) => {
    const o = orient({ x: v.x - c.x, y: v.y - c.y }, rotation, mirror);
    return { x: o.x + position.x, y: o.y + position.y };
  });
}

const TWO_DP_ROUND = 1e4;
function round4(v: Vec2): Vec2 {
  return { x: Math.round(v.x * TWO_DP_ROUND) / TWO_DP_ROUND, y: Math.round(v.y * TWO_DP_ROUND) / TWO_DP_ROUND };
}

function resolvedIdName(piece: { id?: string; name?: string }): { id: string | null; name: string | null } {
  return { id: piece.id ?? null, name: piece.name ?? null };
}

export class TerrainResolveError extends Error {}

/**
 * Resolve a layout to absolute board-space vertices per piece. `templates` is
 * the catalog a piece's `template` references resolve against.
 */
export function resolveLayout(layout: TerrainLayout, templates: TerrainTemplate[]): ResolvedPiece[] {
  const byId = new Map<string, TerrainTemplate>();
  for (const t of templates) byId.set(t.id, t);

  const pieces = layout.pieces ?? [];
  const areasById = new Map<string, LayoutPiece>();
  for (const p of pieces) if (p.id) areasById.set(p.id, p);

  const footprintOf = (piece: { template?: string; footprint?: Footprint }, where: string): Footprint => {
    if (piece.footprint) return piece.footprint;
    if (piece.template) {
      const t = byId.get(piece.template);
      if (!t) throw new TerrainResolveError(`${where}: unknown template "${piece.template}"`);
      return t.footprint;
    }
    throw new TerrainResolveError(`${where}: piece has neither footprint nor template`);
  };

  const out: ResolvedPiece[] = [];

  for (const piece of pieces) {
    const where = piece.id ?? piece.name ?? "<piece>";
    const fp = footprintOf(piece, where);
    const rotation = piece.rotation_degrees ?? 0;
    const mirror = piece.mirror ?? "none";
    const pieceType = piece.piece_type ?? (piece.parent_area_id ? "feature" : "area");

    if (piece.parent_area_id) {
      // Feature placed in its parent area's centroid-local frame.
      const parent = areasById.get(piece.parent_area_id);
      if (!parent) {
        throw new TerrainResolveError(`${where}: unknown parent_area_id "${piece.parent_area_id}"`);
      }
      const areaLocal = placeFootprint(fp, piece.position, rotation, mirror);
      const aRot = parent.rotation_degrees ?? 0;
      const aMirror = parent.mirror ?? "none";
      const vertices = areaLocal.map((p) => {
        const o = orient(p, aRot, aMirror);
        return round4({ x: o.x + parent.position.x, y: o.y + parent.position.y });
      });
      out.push({ ...resolvedIdName(piece), piece_type: pieceType, floor: piece.floor ?? 0, vertices });
      continue;
    }

    // Unparented area or feature: place directly in board space.
    const vertices = placeFootprint(fp, piece.position, rotation, mirror).map(round4);
    out.push({ ...resolvedIdName(piece), piece_type: pieceType, floor: piece.floor ?? 0, vertices });

    // Expand an area template's composed features, carried through this area's
    // placement (same composition math as a parented feature).
    if (piece.template) {
      const t = byId.get(piece.template);
      for (const feat of t?.features ?? []) {
        const ft = byId.get(feat.template);
        if (!ft) {
          throw new TerrainResolveError(`${where}: composed feature references unknown template "${feat.template}"`);
        }
        const areaLocal = placeFootprint(
          ft.footprint,
          feat.position,
          feat.rotation_degrees ?? 0,
          feat.mirror ?? "none",
        );
        const featVerts = areaLocal.map((p) => {
          const o = orient(p, rotation, mirror);
          return round4({ x: o.x + piece.position.x, y: o.y + piece.position.y });
        });
        out.push({
          id: feat.id ?? null,
          name: ft.name ?? null,
          piece_type: "feature",
          floor: feat.floor ?? 0,
          vertices: featVerts,
        });
      }
    }
  }

  return out;
}
