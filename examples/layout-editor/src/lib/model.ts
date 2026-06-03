/**
 * Editor model + the thin seam onto the 40kdc-data terrain library.
 *
 * The whole point of this example: authoring a terrain layout is just building
 * the canonical `terrain-layout` data, and *seeing* it is one call to the same
 * `resolveLayout` the conformance corpus pins. The card-measurement solver
 * (`solveCentroid`) is the package's inverse of that placement, so transcribing
 * a reference card never requires guessing a canonical anchor.
 *
 * Two authoring affordances layer on top, both purely editor-side (they never
 * change the resolver, the stored JSON, or the conformance contract):
 *   - the board is *displayed* rotated 90° (terrain cards are portrait); board
 *     coordinates stay 60×44 y-down, so geometry maps 1:1.
 *   - GW deployments are 180°-rotationally symmetric about the board centre, so
 *     every piece keeps a live twin at (60−x, 44−y), +180°. Twins are real
 *     pieces; the editor just maintains the pairing through `twin_id`.
 */
import {
  Dataset,
  resolveLayout,
  solveCentroid,
  solveCentroidTriangulated,
  footprintVertices,
  orientedOffsets,
  polygonCentroid,
} from "@alpaca-software/40kdc-data";
import type {
  ResolvedPiece,
  ResolvedVec2,
  SolveInput,
  TerrainTemplate,
  TerrainLayout,
} from "@alpaca-software/40kdc-data";

export const BOARD = { width: 60, height: 44 } as const;
export const BOARD_CENTER = { x: BOARD.width / 2, y: BOARD.height / 2 } as const;

export type Mirror = "none" | "horizontal" | "vertical";
export interface Vec2 {
  x: number;
  y: number;
}

/** Which feature of a placed footprint a card dimension reaches. */
export type SolverRef =
  | { kind: "vertex"; index: number }
  | { kind: "face"; side: "min-x" | "max-x" | "min-y" | "max-y" };

/** One committed solver dimension line, for drawing the measurement guide on the board. */
export interface SolverLine {
  edge: "left" | "right" | "top" | "bottom";
  distance: number;
  ref: SolverRef;
}

/** What the board draws to make the solver's edge/corner measurements legible. */
export interface SolverViz {
  /** A feature being hovered in the picker (preview highlight). */
  hover: SolverRef | null;
  /** The committed x and y dimension lines. */
  lines: SolverLine[];
}

/** An editable terrain piece — the loose shape we mutate, serialize, and resolve. */
export interface EditPiece {
  id: string;
  name?: string;
  piece_type: "area" | "feature";
  /** Catalog template id, when this piece instances one. */
  template?: string;
  /** Inline footprint (baked geometry); authoritative when present. */
  footprint?: TerrainTemplate["footprint"];
  /**
   * Centroid. In board inches, unless this is a feature with `parent_area_id`,
   * in which case it is in the parent area's centroid-local frame (the same
   * convention the resolver uses), so moving/rotating the area carries it.
   */
  position: Vec2;
  rotation_degrees: number;
  mirror: Mirror;
  /** For a feature: the layout-local id of the area it is anchored to. */
  parent_area_id?: string;
  floor?: number;
  link_group?: string;
  /** Objective role of this area (or its link_group union): home/expansion/center. */
  objective_role?: "home" | "expansion" | "center";
  /** Whether this piece carries an objective marker (set by an objective role). */
  is_objective?: boolean;
  /** Opaque objective-marker metadata, round-tripped as authored. */
  objective?: { position?: Vec2; control_range_inches?: number };
  /** Editor-only: the id of this piece's symmetry twin. Never serialized. */
  twin_id?: string;
}

export interface EditLayout {
  id: string;
  name: string;
  source?: string;
  description?: string;
  mission_matchup_id?: string;
  variant?: number;
  deployment_pattern_id?: string;
  pieces: EditPiece[];
}

export const ds = Dataset.embedded();

/** The catalog, areas first then features, each alphabetical by name. */
export const CATALOG: TerrainTemplate[] = ds.terrainTemplates.all
  .slice()
  .sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "area" ? -1 : 1,
  );

export function templateById(id: string | undefined): TerrainTemplate | undefined {
  return id ? ds.terrainTemplates.get(id) ?? undefined : undefined;
}

/** The footprint a piece resolves against (inline wins over template). */
export function footprintOf(piece: EditPiece): TerrainTemplate["footprint"] | undefined {
  return piece.footprint ?? templateById(piece.template)?.footprint;
}

/** Resolve the working layout to absolute board vertices via the shared resolver. */
export function resolve(layout: EditLayout): ResolvedPiece[] {
  return resolveLayout(
    layout as unknown as Parameters<typeof resolveLayout>[0],
    CATALOG as unknown as Parameters<typeof resolveLayout>[1],
  );
}

/** The board-space vertices of one piece (for hit-testing / selection outline). */
export function verticesOf(layout: EditLayout, pieceId: string): ResolvedVec2[] {
  return resolve(layout).find((p) => p.id === pieceId)?.vertices ?? [];
}

// ── oriented geometry (shared by handles, indicators, thumbnails) ─────────────
// All reuse the SAME frozen math the resolver uses, so on-canvas affordances can
// never drift from what the resolver will actually draw.

export interface OrientedFootprint {
  centroid: Vec2;
  /** Per-vertex offset from the centroid, after mirror→rotate (board frame). */
  offsets: Vec2[];
  /** Board-space vertices (centroid + offset). */
  verticesBoard: Vec2[];
}

/**
 * A piece's footprint placed in board space (centroid-anchored, like the
 * resolver). For a feature with `parent_area_id`, its stored centroid/offsets
 * live in the parent area's local frame, so we compose them through the area's
 * placement (the same `mirror→rotate→translate` the resolver applies) — that is
 * what keeps on-canvas handles and guides aligned with the resolved polygon
 * when the area is moved or rotated.
 */
export function orientedFootprint(
  piece: EditPiece,
  layout?: EditLayout,
): OrientedFootprint | null {
  const fp = footprintOf(piece);
  if (!fp) return null;
  const offsets = orientedOffsets(
    fp as never,
    piece.rotation_degrees,
    piece.mirror,
  ) as Vec2[];
  const area = layout ? parentAreaOf(layout, piece) : undefined;
  if (area) {
    const centroid = applyAreaFrame(piece.position, area);
    const verticesBoard = offsets.map((o) =>
      applyAreaFrame({ x: piece.position.x + o.x, y: piece.position.y + o.y }, area),
    );
    return {
      centroid,
      offsets: verticesBoard.map((v) => ({ x: v.x - centroid.x, y: v.y - centroid.y })),
      verticesBoard,
    };
  }
  const centroid = piece.position;
  return {
    centroid,
    offsets,
    verticesBoard: offsets.map((o) => ({ x: centroid.x + o.x, y: centroid.y + o.y })),
  };
}

export function bbox(verts: Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function mirrorVec(v: Vec2, m: Mirror): Vec2 {
  if (m === "horizontal") return { x: -v.x, y: v.y };
  if (m === "vertical") return { x: v.x, y: -v.y };
  return v;
}
function rotateCw(v: Vec2, deg: number): Vec2 {
  if (!deg) return v;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

// ── parent-area composition (a feature anchored to an area) ───────────────────
// A parented feature stores its centroid/orientation in the area's centroid-local
// frame; the resolver re-applies the area's own mirror→rotate→translate. These
// helpers are the editor-side forward/inverse of exactly that, so the interactive
// layer (drag, handles, guides) and the stored data never disagree.

/** Area-local point → board space, through the area's placement. */
function applyAreaFrame(local: Vec2, area: EditPiece): Vec2 {
  const r = rotateCw(mirrorVec(local, area.mirror), area.rotation_degrees);
  return { x: area.position.x + r.x, y: area.position.y + r.y };
}
/** Board-space point → the area's centroid-local frame (inverse of applyAreaFrame). */
function inverseAreaFrame(board: Vec2, area: EditPiece): Vec2 {
  const d = { x: board.x - area.position.x, y: board.y - area.position.y };
  // mirror is its own inverse; undo rotate first, then mirror.
  return mirrorVec(rotateCw(d, -area.rotation_degrees), area.mirror);
}
/** Clamp a board-space point to the table (2-dp), so pieces can't leave the map. */
function clampToBoard(p: Vec2): Vec2 {
  const c = (n: number, hi: number): number => Math.max(0, Math.min(hi, Math.round(n * 100) / 100));
  return { x: c(p.x, BOARD.width), y: c(p.y, BOARD.height) };
}
/** The area a feature is parented to, if any (and still present). */
function parentAreaOf(layout: EditLayout, piece: EditPiece): EditPiece | undefined {
  return piece.parent_area_id ? byId(layout, piece.parent_area_id) : undefined;
}
/** A piece's board-space centroid (composing through its parent area if parented). */
export function boardCentroid(layout: EditLayout, piece: EditPiece): Vec2 {
  const area = parentAreaOf(layout, piece);
  return area ? applyAreaFrame(piece.position, area) : { x: piece.position.x, y: piece.position.y };
}

/**
 * Board-space vertices of a piece's `upper_floor` platform, if any. The platform
 * footprint is authored in the same local frame as the ground footprint and
 * re-centred on the GROUND centroid, so we offset its vertices from the ground
 * local centroid and apply the same mirror→rotate→translate the resolver uses.
 */
export function upperFloorBoardVerts(piece: EditPiece, layout?: EditLayout): Vec2[] | null {
  const tpl = templateById(piece.template);
  const uf = (tpl as { upper_floor?: { footprint: TerrainTemplate["footprint"] } } | undefined)
    ?.upper_floor;
  const ground = footprintOf(piece);
  if (!uf || !ground) return null;
  const gc = polygonCentroid(footprintVertices(ground as never) as Vec2[]) as Vec2;
  const local = footprintVertices(uf.footprint as never) as Vec2[];
  const area = layout ? parentAreaOf(layout, piece) : undefined;
  return local.map((v) => {
    const t = rotateCw(mirrorVec({ x: v.x - gc.x, y: v.y - gc.y }, piece.mirror), piece.rotation_degrees);
    // `position + t` is the platform vertex in the piece's own frame; for a
    // parented feature that frame is area-local, so push it through the area.
    const framed = { x: piece.position.x + t.x, y: piece.position.y + t.y };
    return area ? applyAreaFrame(framed, area) : framed;
  });
}

/** True when a template's ground footprint can't hold models (gantry/catwalk/generator). */
export function isGroundBlocked(piece: EditPiece): boolean {
  const tpl = templateById(piece.template) as { ground_accessible?: boolean } | undefined;
  return tpl?.ground_accessible === false;
}

/** A template's upper-floor footprint, authored in the same local frame as `footprint`. */
export function upperFloorOf(
  template: TerrainTemplate,
): TerrainTemplate["footprint"] | undefined {
  return (template as { upper_floor?: { footprint: TerrainTemplate["footprint"] } }).upper_floor
    ?.footprint;
}

// ── deployment zones (drawn under the terrain to author against a card) ───────

export interface DeployZone {
  player: string;
  name?: string;
  color?: string;
  /** Absolute board-space polygon (position + shape applied). */
  points: Vec2[];
}

function shapeToPoints(
  shape: { type: string; width?: number; height?: number; points?: Vec2[] },
  pos: Vec2,
): Vec2[] {
  if (shape.type === "rectangle") {
    const w = shape.width ?? 0;
    const h = shape.height ?? 0;
    return [
      { x: pos.x, y: pos.y },
      { x: pos.x + w, y: pos.y },
      { x: pos.x + w, y: pos.y + h },
      { x: pos.x, y: pos.y + h },
    ];
  }
  return (shape.points ?? []).map((pt) => ({ x: pos.x + pt.x, y: pos.y + pt.y }));
}

/** The deployment zones of a pattern, as absolute board-space polygons. */
export function deploymentZones(patternId: string | null): DeployZone[] {
  if (!patternId) return [];
  const p = ds.deploymentPatterns.get(patternId) as
    | { zones?: { player: string; name?: string; color?: string; shape: never; position: Vec2 }[] }
    | undefined;
  if (!p?.zones) return [];
  return p.zones.map((z) => ({
    player: z.player,
    name: z.name,
    color: z.color,
    points: shapeToPoints(z.shape, z.position),
  }));
}

// ── territory divider (the dashed line splitting the two players' halves) ─────
// Derived from the deployment zones, the way the printed card draws it: the line
// runs between the two "no-man's-land" gaps on the board perimeter — the midpoint
// of each stretch of edge that separates one player's zone from the other's. For
// opposed bands this is a straight cross-board line; for corner deployments it is
// the diagonal. Each end carries a Defender/Attacker badge on its own side.

export interface TerritoryBadge {
  at: Vec2;
  player: string;
  color: string;
}
export interface TerritoryDivider {
  from: Vec2;
  to: Vec2;
  badges: TerritoryBadge[];
}

function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((poly[j].x - poly[i].x) * (pt.y - yi)) / (yj - yi) + poly[i].x;
    if (intersect) inside = !inside;
  }
  return inside;
}

const polyMean = (pts: Vec2[]): Vec2 => ({
  x: pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1),
  y: pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1),
});

/**
 * Midpoints of the perimeter gaps that separate the two zones. Walk the board
 * edge, classify each step by which zone owns the strip just inside it, and take
 * the centre of every uncovered run flanked by *different* players. Returns the
 * (normally two) divider endpoints.
 */
function perimeterGapMidpoints(def: Vec2[], atk: Vec2[]): Vec2[] {
  const { width: W, height: H } = BOARD;
  const STEP = 0.25;
  const EPS = 0.1;
  const samples: { p: Vec2; inward: Vec2 }[] = [];
  for (let x = 0; x < W; x += STEP) samples.push({ p: { x, y: 0 }, inward: { x: 0, y: 1 } });
  for (let y = 0; y < H; y += STEP) samples.push({ p: { x: W, y }, inward: { x: -1, y: 0 } });
  for (let x = W; x > 0; x -= STEP) samples.push({ p: { x, y: H }, inward: { x: 0, y: -1 } });
  for (let y = H; y > 0; y -= STEP) samples.push({ p: { x: 0, y }, inward: { x: 1, y: 0 } });

  const cls = samples.map((s) => {
    const q = { x: s.p.x + s.inward.x * EPS, y: s.p.y + s.inward.y * EPS };
    if (pointInPolygon(q, def)) return "d";
    if (pointInPolygon(q, atk)) return "a";
    return "n";
  });
  const n = cls.length;
  const start = cls.findIndex((c) => c !== "n");
  if (start < 0) return [];
  const at = (i: number): string => cls[(i + start) % n];
  const sampleAt = (i: number): Vec2 => samples[(i + start) % n].p;

  const mids: Vec2[] = [];
  let k = 0;
  while (k < n) {
    if (at(k) !== "n") {
      k++;
      continue;
    }
    let j = k;
    while (j < n && at(j) === "n") j++;
    const before = at(k - 1); // k>=1: index 0 is never a gap
    const after = j < n ? at(j) : at(0); // a trailing run wraps to the non-gap start
    if (before !== after) mids.push(sampleAt(k + Math.floor((j - k) / 2)));
    k = j;
  }
  return mids;
}

/** The dashed territory divider (line + per-end Attacker/Defender badges), or null. */
export function territoryDivider(patternId: string | null): TerritoryDivider | null {
  if (!patternId) return null;
  const zones = deploymentZones(patternId);
  const def = zones.find((z) => z.player === "defender");
  const atk = zones.find((z) => z.player === "attacker");
  if (!def || !atk) return null;
  const ends = perimeterGapMidpoints(def.points, atk.points);
  if (ends.length < 2) return null;
  const [from, to] = ends;
  const u = { x: to.x - from.x, y: to.y - from.y };
  const len = Math.hypot(u.x, u.y) || 1;
  const nrm = { x: -u.y / len, y: u.x / len }; // unit perpendicular
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  // Which side of the line the defender's zone sits on (by its centroid).
  const cD = polyMean(def.points);
  const sideD = nrm.x * (cD.x - mid.x) + nrm.y * (cD.y - mid.y);
  const defDir = sideD >= 0 ? nrm : { x: -nrm.x, y: -nrm.y };
  const atkDir = { x: -defDir.x, y: -defDir.y };
  const OFF = 3;
  const defColor = def.color ?? "#3b82f6";
  const atkColor = atk.color ?? "#ef4444";
  const badges: TerritoryBadge[] = [];
  for (const e of [from, to]) {
    badges.push({ at: { x: e.x + defDir.x * OFF, y: e.y + defDir.y * OFF }, player: "D", color: defColor });
    badges.push({ at: { x: e.x + atkDir.x * OFF, y: e.y + atkDir.y * OFF }, player: "A", color: atkColor });
  }
  return { from, to, badges };
}

/** Patterns available for the deployment overlay dropdown. */
export const DEPLOYMENT_PATTERNS: { id: string; name: string }[] = ds.deploymentPatterns.all
  .map((p) => ({ id: p.id, name: p.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** A sensible default deployment overlay for a known layout id (best-effort name match). */
export function defaultDeploymentFor(layoutId: string): string | null {
  const ids = new Set(DEPLOYMENT_PATTERNS.map((p) => p.id));
  if (layoutId.includes("crucible") && ids.has("crucible-of-battle")) return "crucible-of-battle";
  if (layoutId.includes("hammer") && ids.has("hammer-and-anvil")) return "hammer-and-anvil";
  if (layoutId.includes("search") && ids.has("search-and-destroy")) return "search-and-destroy";
  if (layoutId.includes("sweeping") && ids.has("sweeping-engagement")) return "sweeping-engagement";
  return null;
}

/** Mission-matchup pairings for the layout's "card" dropdown, e.g. "Take and Hold vs Purge the Foe". */
const titleize = (id: string): string =>
  id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const MISSION_MATCHUPS: { id: string; label: string }[] = ds.missionMatchups.all
  .map((m) => {
    const mm = m as { id: string; disposition: string; opponent_disposition: string };
    return { id: mm.id, label: `${titleize(mm.disposition)} vs ${titleize(mm.opponent_disposition)}` };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

// ── symmetry twins (180° rotation about board centre) ─────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

export function twinPosition(p: Vec2): Vec2 {
  return { x: round2(BOARD.width - p.x), y: round2(BOARD.height - p.y) };
}
export function twinRotation(deg: number): number {
  return norm360(deg + 180);
}
export function isBoardCentre(p: Vec2): boolean {
  return Math.abs(p.x - BOARD_CENTER.x) < 0.3 && Math.abs(p.y - BOARD_CENTER.y) < 0.3;
}

const byId = (layout: EditLayout, id: string): EditPiece | undefined =>
  layout.pieces.find((p) => p.id === id);
const twinOf = (layout: EditLayout, p: EditPiece): EditPiece | undefined =>
  p.twin_id ? byId(layout, p.twin_id) : undefined;

let counter = 0;
function freshId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function makePiece(template: TerrainTemplate, position: Vec2): EditPiece {
  return {
    id: freshId(template.id),
    name: template.name,
    piece_type: template.kind,
    template: template.id,
    position,
    rotation_degrees: 0,
    mirror: "none",
  };
}

/**
 * Add a catalog template to the layout. In symmetric mode the piece is placed
 * off-centre and a twin is created at its point-reflection so both halves appear.
 */
export function addTemplate(
  layout: EditLayout,
  template: TerrainTemplate,
  symmetric: boolean,
): EditPiece {
  const primary = makePiece(template, { x: BOARD.width * 0.32, y: BOARD.height * 0.32 });
  layout.pieces.push(primary);
  if (symmetric && !isBoardCentre(primary.position)) {
    const twin = makePiece(template, twinPosition(primary.position));
    twin.rotation_degrees = twinRotation(primary.rotation_degrees);
    twin.mirror = primary.mirror;
    primary.twin_id = twin.id;
    twin.twin_id = primary.id;
    layout.pieces.push(twin);
  }
  return primary;
}

/**
 * Move a piece's centroid. `position` is always a BOARD-space point (drag and
 * the inspector both work in board inches). For a parented feature we convert it
 * into the parent area's local frame before storing, and the twin — which is
 * parented to the AREA's twin — takes the *same* local centroid (a 180° board
 * rotation about centre maps area→twin and leaves the local coordinate fixed).
 * Unparented pieces keep the board-mirror twin convention.
 */
export function movePiece(layout: EditLayout, id: string, position: Vec2): void {
  const p = byId(layout, id);
  if (!p) return;
  // Clamp the board centroid to the table so no piece (or runaway edit) can leave
  // the map. Applies to every path: drag, inspector fields, and solver placement.
  const board = clampToBoard(position);
  const area = parentAreaOf(layout, p);
  if (area) {
    p.position = inverseAreaFrame(board, area);
    const t = twinOf(layout, p);
    if (t) t.position = { x: p.position.x, y: p.position.y };
    return;
  }
  p.position = board;
  const t = twinOf(layout, p);
  if (t) t.position = twinPosition(board);
}

/**
 * Set rotation and/or mirror, keeping the twin in sync. For a parented feature
 * `rotation_degrees` is the feature's rotation *within* the area-local frame, and
 * its twin (parented to the area's twin) carries the identical local rotation —
 * the +180° already lives on the area twin. Unparented pieces keep the +180°
 * board-twin convention.
 */
export function orientPiece(
  layout: EditLayout,
  id: string,
  patch: { rotation_degrees?: number; mirror?: Mirror },
): void {
  const p = byId(layout, id);
  if (!p) return;
  if (patch.rotation_degrees !== undefined) p.rotation_degrees = norm360(patch.rotation_degrees);
  if (patch.mirror !== undefined) p.mirror = patch.mirror;
  const t = twinOf(layout, p);
  if (!t) return;
  const parented = !!parentAreaOf(layout, p);
  if (patch.rotation_degrees !== undefined) {
    t.rotation_degrees = parented ? p.rotation_degrees : twinRotation(patch.rotation_degrees);
  }
  if (patch.mirror !== undefined) t.mirror = patch.mirror;
}

/**
 * Anchor a feature to an area (or clear it). Conversions keep the feature's
 * resolved board position fixed at the instant of (un)linking, so nothing jumps.
 * In symmetric mode the feature's twin is parented to the area's twin at the same
 * local placement; if the area has no twin the feature/twin pairing is dropped so
 * the board-mirror and parent conventions never fight.
 */
export function setParentArea(layout: EditLayout, id: string, parentId: string | undefined): void {
  const p = byId(layout, id);
  if (!p) return;
  const next = parentId || undefined;
  if (p.parent_area_id === next) return;
  const board = boardCentroid(layout, p); // board centroid under the *current* parent
  if (next) {
    const parent = byId(layout, next);
    if (!parent || parent.id === p.id) return;
    p.parent_area_id = next;
    p.position = inverseAreaFrame(board, parent);
    const t = twinOf(layout, p);
    if (t) {
      const areaTwin = parent.twin_id ? byId(layout, parent.twin_id) : undefined;
      if (areaTwin && areaTwin.id !== parent.id) {
        t.parent_area_id = areaTwin.id;
        t.position = { x: p.position.x, y: p.position.y };
        t.rotation_degrees = p.rotation_degrees;
        t.mirror = p.mirror;
      } else {
        // No consistent area twin to anchor the feature's twin to — unpair them.
        t.twin_id = undefined;
        p.twin_id = undefined;
      }
    }
    return;
  }
  // Clear: convert back to board space for the feature and its (parented) twin.
  p.parent_area_id = undefined;
  p.position = board;
  const t = twinOf(layout, p);
  if (t && t.parent_area_id) {
    const tBoard = boardCentroid(layout, t);
    t.parent_area_id = undefined;
    t.position = tBoard;
  }
}

/** Set a piece's link group, mirroring the same value onto its twin. */
export function setLinkGroup(layout: EditLayout, id: string, group: string | undefined): void {
  const p = byId(layout, id);
  if (!p) return;
  p.link_group = group || undefined;
  const t = twinOf(layout, p);
  if (t) t.link_group = group || undefined;
}

export type ObjectiveRole = "home" | "expansion" | "center";

/** Every piece that forms the same objective as `p`: its link_group union, else just itself — each with its twin. */
function objectiveUnion(layout: EditLayout, p: EditPiece): EditPiece[] {
  const base = p.link_group
    ? layout.pieces.filter((q) => q.link_group === p.link_group)
    : [p];
  const set = new Set<EditPiece>();
  for (const m of base) {
    set.add(m);
    const t = twinOf(layout, m);
    if (t) set.add(t);
  }
  return [...set];
}

/**
 * Mark a terrain area's objective role (home/expansion/center), applied across
 * its symmetry twin and its whole link_group union — linked areas are one area
 * "slotted like puzzle pieces", so the union reads as a single objective. A role
 * implies `is_objective`; clearing it drops the flag.
 */
export function setObjectiveRole(layout: EditLayout, id: string, role: ObjectiveRole | undefined): void {
  const p = byId(layout, id);
  if (!p) return;
  for (const m of objectiveUnion(layout, p)) {
    m.objective_role = role || undefined;
    m.is_objective = role ? true : undefined;
  }
}

export interface ObjectiveMarker {
  /** Board-space centre of the objective (the union's centroid). */
  at: Vec2;
  role?: ObjectiveRole;
}

/**
 * One marker per objective: pieces flagged `is_objective` grouped by link_group
 * (unlinked pieces stand alone), placed at the union's board centroid. Lets the
 * board draw a single marker for a puzzle-piece union.
 */
export function objectiveMarkers(layout: EditLayout): ObjectiveMarker[] {
  const groups = new Map<string, EditPiece[]>();
  for (const p of layout.pieces) {
    if (!p.is_objective) continue;
    const key = p.link_group ? `g:${p.link_group}` : `p:${p.id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const out: ObjectiveMarker[] = [];
  for (const members of groups.values()) {
    const cs = members.map((m) => boardCentroid(layout, m));
    const at = {
      x: cs.reduce((s, c) => s + c.x, 0) / cs.length,
      y: cs.reduce((s, c) => s + c.y, 0) / cs.length,
    };
    out.push({ at, role: members.find((m) => m.objective_role)?.objective_role });
  }
  return out;
}

/** Delete a piece and its twin, re-baking any features parented to them into board space. */
export function deletePiece(layout: EditLayout, id: string): void {
  const p = byId(layout, id);
  if (!p) return;
  const removed = new Set([id, p.twin_id].filter((x): x is string => !!x));
  // Detach children so no piece is left with a dangling parent_area_id.
  for (const q of layout.pieces) {
    if (q.parent_area_id && removed.has(q.parent_area_id)) {
      q.position = boardCentroid(layout, q);
      q.parent_area_id = undefined;
    }
  }
  layout.pieces = layout.pieces.filter((q) => !removed.has(q.id));
}

/**
 * Pair up pieces that are 180°-rotational twins, matching on point-reflected
 * centroid (within tolerance) + same template. We deliberately do NOT gate on
 * rotation/mirror: migrated layouts are point-symmetric in position but often
 * store asymmetric pieces at the same angle on both sides rather than θ+180.
 * Pairing leaves the loaded orientation untouched; the twin-aware setters enforce
 * the +180 convention on the first orientation edit (cleaning up the scaffold).
 * A piece sitting on the board centre is self-symmetric and stays unpaired.
 */
export function autoPairTwins(pieces: EditPiece[]): void {
  const POS_TOL = 0.75;
  // Pass 1: board-space pieces (areas + unparented features) by point reflection.
  for (const p of pieces) {
    if (p.twin_id || p.parent_area_id || isBoardCentre(p.position)) continue;
    const want = twinPosition(p.position);
    const match = pieces.find(
      (q) =>
        q.id !== p.id &&
        !q.twin_id &&
        !q.parent_area_id &&
        q.template === p.template &&
        Math.hypot(q.position.x - want.x, q.position.y - want.y) <= POS_TOL,
    );
    if (match) {
      p.twin_id = match.id;
      match.twin_id = p.id;
    }
  }
  // Pass 2: parented features. Their twin is parented to the *area's* twin at the
  // identical area-local position, so we match on (parent's twin, local centroid).
  const local = new Map(pieces.map((p) => [p.id, p]));
  for (const p of pieces) {
    if (p.twin_id || !p.parent_area_id) continue;
    const parentTwinId = local.get(p.parent_area_id)?.twin_id;
    if (!parentTwinId) continue;
    const match = pieces.find(
      (q) =>
        q.id !== p.id &&
        !q.twin_id &&
        q.parent_area_id === parentTwinId &&
        q.template === p.template &&
        Math.hypot(q.position.x - p.position.x, q.position.y - p.position.y) <= POS_TOL,
    );
    if (match) {
      p.twin_id = match.id;
      match.twin_id = p.id;
    }
  }
}

/** Re-establish pairing across the whole layout (used when symmetry is toggled on). */
export function repairTwins(layout: EditLayout): void {
  for (const p of layout.pieces) p.twin_id = undefined;
  autoPairTwins(layout.pieces);
}

/** Drop all pairing, leaving every piece independent (used when symmetry is toggled off). */
export function unpairTwins(layout: EditLayout): void {
  for (const p of layout.pieces) p.twin_id = undefined;
}

/** A blank layout. */
export function blankLayout(): EditLayout {
  counter = 0;
  return { id: "untitled-layout", name: "Untitled Layout", source: "custom", pieces: [] };
}

/** Kebab-case entity id from a title, matching the `entity-id` convention
 *  (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`). Empty titles fall back to a stable slug. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled-layout";
}

/** Rename the working layout, keeping its `id` a slug of the title so the
 *  canonical export id and download filename track the title the author sees. */
export function renameLayout(layout: EditLayout, name: string): void {
  layout.name = name;
  layout.id = slugify(name);
}

/** Deep-clone an embedded layout into the editable model, pairing symmetric twins. */
export function loadEmbedded(id: string, symmetric = true): EditLayout | undefined {
  const raw = ds.terrainLayouts.get(id) as TerrainLayout | undefined;
  if (!raw) return undefined;
  counter = 0;
  const pieces: EditPiece[] = (raw.pieces ?? []).map((p, i) => ({
    id: p.id ?? `piece-${i + 1}`,
    name: p.name,
    piece_type: (p.piece_type ?? "area") as "area" | "feature",
    template: p.template,
    footprint: p.footprint,
    position: { x: p.position.x, y: p.position.y },
    rotation_degrees: p.rotation_degrees ?? 0,
    mirror: (p.mirror ?? "none") as Mirror,
    parent_area_id: p.parent_area_id,
    floor: p.floor,
    link_group: p.link_group,
    objective_role: p.objective_role,
    is_objective: p.is_objective,
    objective: p.objective,
  }));
  if (symmetric) autoPairTwins(pieces);
  return {
    id: raw.id,
    name: raw.name,
    source: raw.source,
    description: raw.description,
    mission_matchup_id: raw.mission_matchup_id,
    variant: raw.variant,
    deployment_pattern_id: raw.deployment_pattern_id,
    pieces,
  };
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Canonical `terrain-layout` JSON for the working layout (drops editor defaults + twin_id). */
export function toCanonicalJson(layout: EditLayout): unknown {
  return [
    {
      id: layout.id,
      name: layout.name,
      ...(layout.source ? { source: layout.source } : {}),
      ...(layout.description ? { description: layout.description } : {}),
      ...(layout.mission_matchup_id ? { mission_matchup_id: layout.mission_matchup_id } : {}),
      ...(layout.variant ? { variant: layout.variant } : {}),
      ...(layout.deployment_pattern_id ? { deployment_pattern_id: layout.deployment_pattern_id } : {}),
      pieces: layout.pieces.map((p) => ({
        id: p.id,
        ...(p.name ? { name: p.name } : {}),
        piece_type: p.piece_type,
        ...(p.template ? { template: p.template } : {}),
        ...(p.footprint ? { footprint: p.footprint } : {}),
        position: { x: round(p.position.x), y: round(p.position.y) },
        ...(p.rotation_degrees ? { rotation_degrees: round(p.rotation_degrees) } : {}),
        ...(p.mirror !== "none" ? { mirror: p.mirror } : {}),
        ...(p.parent_area_id ? { parent_area_id: p.parent_area_id } : {}),
        ...(p.floor ? { floor: p.floor } : {}),
        ...(p.link_group ? { link_group: p.link_group } : {}),
        ...(p.objective_role ? { objective_role: p.objective_role } : {}),
        ...(p.is_objective ? { is_objective: true } : {}),
        ...(p.objective ? { objective: p.objective } : {}),
      })),
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" },
    },
  ];
}

// Re-exports the inspector's solver panel and on-canvas affordances lean on.
export { solveCentroid, solveCentroidTriangulated, footprintVertices, orientedOffsets, polygonCentroid };
export type { SolveInput };
