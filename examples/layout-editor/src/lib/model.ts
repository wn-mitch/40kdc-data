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
  position: Vec2;
  rotation_degrees: number;
  mirror: Mirror;
  floor?: number;
  link_group?: string;
  /** Editor-only: the id of this piece's symmetry twin. Never serialized. */
  twin_id?: string;
}

export interface EditLayout {
  id: string;
  name: string;
  source?: string;
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

/** A piece's footprint placed in board space (centroid-anchored, like the resolver). */
export function orientedFootprint(piece: EditPiece): OrientedFootprint | null {
  const fp = footprintOf(piece);
  if (!fp) return null;
  const offsets = orientedOffsets(
    fp as never,
    piece.rotation_degrees,
    piece.mirror,
  ) as Vec2[];
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

/**
 * Board-space vertices of a piece's `upper_floor` platform, if any. The platform
 * footprint is authored in the same local frame as the ground footprint and
 * re-centred on the GROUND centroid, so we offset its vertices from the ground
 * local centroid and apply the same mirror→rotate→translate the resolver uses.
 */
export function upperFloorBoardVerts(piece: EditPiece): Vec2[] | null {
  const tpl = templateById(piece.template);
  const uf = (tpl as { upper_floor?: { footprint: TerrainTemplate["footprint"] } } | undefined)
    ?.upper_floor;
  const ground = footprintOf(piece);
  if (!uf || !ground) return null;
  const gc = polygonCentroid(footprintVertices(ground as never) as Vec2[]) as Vec2;
  const local = footprintVertices(uf.footprint as never) as Vec2[];
  return local.map((v) => {
    const t = rotateCw(mirrorVec({ x: v.x - gc.x, y: v.y - gc.y }, piece.mirror), piece.rotation_degrees);
    return { x: piece.position.x + t.x, y: piece.position.y + t.y };
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
  return null;
}

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

/** Move a piece's centroid, carrying its twin to the point-reflected position. */
export function movePiece(layout: EditLayout, id: string, position: Vec2): void {
  const p = byId(layout, id);
  if (!p) return;
  p.position = position;
  const t = twinOf(layout, p);
  if (t) t.position = twinPosition(position);
}

/** Set rotation and/or mirror, keeping the twin's orientation in sync. */
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
  if (t) {
    if (patch.rotation_degrees !== undefined) t.rotation_degrees = twinRotation(patch.rotation_degrees);
    if (patch.mirror !== undefined) t.mirror = patch.mirror;
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

/** Delete a piece and its twin. */
export function deletePiece(layout: EditLayout, id: string): void {
  const p = byId(layout, id);
  if (!p) return;
  const twinId = p.twin_id;
  layout.pieces = layout.pieces.filter((q) => q.id !== id && q.id !== twinId);
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
  for (const p of pieces) {
    if (p.twin_id || isBoardCentre(p.position)) continue;
    const want = twinPosition(p.position);
    const match = pieces.find(
      (q) =>
        q.id !== p.id &&
        !q.twin_id &&
        q.template === p.template &&
        Math.hypot(q.position.x - want.x, q.position.y - want.y) <= POS_TOL,
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
    floor: p.floor,
    link_group: p.link_group,
  }));
  if (symmetric) autoPairTwins(pieces);
  return { id: raw.id, name: raw.name, source: raw.source, pieces };
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Canonical `terrain-layout` JSON for the working layout (drops editor defaults + twin_id). */
export function toCanonicalJson(layout: EditLayout): unknown {
  return [
    {
      id: layout.id,
      name: layout.name,
      ...(layout.source ? { source: layout.source } : {}),
      pieces: layout.pieces.map((p) => ({
        id: p.id,
        ...(p.name ? { name: p.name } : {}),
        piece_type: p.piece_type,
        ...(p.template ? { template: p.template } : {}),
        ...(p.footprint ? { footprint: p.footprint } : {}),
        position: { x: round(p.position.x), y: round(p.position.y) },
        ...(p.rotation_degrees ? { rotation_degrees: round(p.rotation_degrees) } : {}),
        ...(p.mirror !== "none" ? { mirror: p.mirror } : {}),
        ...(p.floor ? { floor: p.floor } : {}),
        ...(p.link_group ? { link_group: p.link_group } : {}),
      })),
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" },
    },
  ];
}

// Re-exports the inspector's solver panel and on-canvas affordances lean on.
export { solveCentroid, footprintVertices, orientedOffsets, polygonCentroid };
export type { SolveInput };
