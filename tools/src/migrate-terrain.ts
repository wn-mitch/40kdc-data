/**
 * One-shot (and re-runnable) migration of shadowboxing (`~/bevy-deploy-helper`)
 * 11e terrain layouts into the canonical centroid-anchored `terrain-layout`
 * representation, written to `data/core/terrain-layouts.json`.
 *
 * Two representations are produced, both geometry-preserving and verified by
 * re-resolving the output and diffing against ground truth (≤5e-4):
 *
 * - **Areas** → `template` (matched by source name) + the centroid as `position`
 *   + a Procrustes-recovered `rotation_degrees`/`mirror`. This exercises the
 *   template + orientation representation the schema is designed around.
 * - **Features** (walls/corners/containers/floors) → an inline baked
 *   `footprint` polygon (centroid-relative) with `rotation_degrees: 0`,
 *   `mirror: "none"`, carrying the matched `template` id as provenance. Walls
 *   and corners are lines in the source with no vertex-identical catalog
 *   footprint, so baking is the faithful, exactly-verifiable choice. Multi-line
 *   features (corners) emit one piece per segment.
 *
 * Usage: `npx tsx src/migrate-terrain.ts` (run from `tools/`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolveLayout, polygonCentroid, footprintVertices, type Vec2, type Mirror, type Footprint, type TerrainTemplate, type TerrainLayout } from "./terrain/resolve.js";

const BOARD_HEIGHT = 44;
const TOL = 5e-4;
const SB = join(homedir(), "bevy-deploy-helper", "assets", "terrain-layouts", "gw-11e");
const REPO_ROOT = join(new URL("../..", import.meta.url).pathname);
const CATALOG_PATH = join(REPO_ROOT, "data", "core", "terrain-templates.json");
const OUT_PATH = join(REPO_ROOT, "data", "core", "terrain-layouts.json");

// ---- shadowboxing source shapes (subset we migrate) -----------------------

type SbShape =
  | { type: "rectangle"; width: number; height: number; x?: number; y?: number }
  | { type: "polygon"; points: Vec2[] }
  | { type: "line"; start: Vec2; end: Vec2; thickness: number };

interface SbPiece {
  id: string;
  name: string;
  shapes: SbShape[];
  position: Vec2;
  rotation?: number;
  mirror?: Mirror;
  pieceType?: "area" | "feature";
  category?: string;
  height?: number;
  floor?: number;
  linkGroup?: string;
}

interface SbLayout {
  id: string;
  name: string;
  source?: string;
  pieces: SbPiece[];
}

// ---- shadowboxing transform (reproduced from src/los/shapes.rs) -----------
// local_to_world: mirror → rotate(-θ) → translate(world_position); world is
// y-up (world_position flips JSON y). We then map back to the 40kdc board
// frame (top-left origin, y-down) — which equals shadowboxing's JSON frame.

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

function sbMirror(v: Vec2, m: Mirror): Vec2 {
  if (m === "horizontal") return { x: -v.x, y: v.y };
  if (m === "vertical") return { x: v.x, y: -v.y };
  return v;
}

/** shadowboxing local(y-up) → world(y-up): mirror → Mat2::from_angle(-θ) → +pos */
function sbLocalToWorld(localYup: Vec2, piece: SbPiece): Vec2 {
  const m = sbMirror(localYup, piece.mirror ?? "none");
  const a = -((piece.rotation ?? 0) * Math.PI) / 180;
  // glam Mat2::from_angle(a) = [[cos a, -sin a],[sin a, cos a]]
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rotated = { x: c * m.x - s * m.y, y: s * m.x + c * m.y };
  const worldPos = { x: piece.position.x, y: BOARD_HEIGHT - piece.position.y };
  return add(rotated, worldPos);
}

/** world(y-up) → 40kdc board frame (y-down). */
const toBoard = (world: Vec2): Vec2 => ({ x: world.x, y: BOARD_HEIGHT - world.y });

/** A shape's outline vertices in shadowboxing local y-up coordinates. */
function shapeLocalYupVerts(shape: SbShape): Vec2[] {
  switch (shape.type) {
    case "rectangle": {
      const ox = shape.x ?? 0;
      const oy = shape.y ?? 0;
      // JSON-local span x∈[ox,ox+w], y∈[oy,oy+h] (y-down) → y-up negate y.
      return [
        { x: ox, y: -oy },
        { x: ox + shape.width, y: -oy },
        { x: ox + shape.width, y: -(oy + shape.height) },
        { x: ox, y: -(oy + shape.height) },
      ];
    }
    case "polygon":
      return shape.points.map((p) => ({ x: p.x, y: -p.y }));
    case "line": {
      const s = { x: shape.start.x, y: -shape.start.y };
      const e = { x: shape.end.x, y: -shape.end.y };
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const dir = { x: dx / len, y: dy / len };
      const perp = { x: -dir.y * (shape.thickness / 2), y: dir.x * (shape.thickness / 2) };
      return [add(s, perp), add(e, perp), sub(e, perp), sub(s, perp)];
    }
  }
}

/** Ground-truth board-frame (y-down) outline of a source shape. */
function sbShapeBoardVerts(shape: SbShape, piece: SbPiece): Vec2[] {
  return shapeLocalYupVerts(shape).map((v) => toBoard(sbLocalToWorld(v, piece)));
}

// ---- area template matching + Procrustes orientation recovery -------------

const AREA_NAME_TO_TEMPLATE: Record<string, string> = {
  "11e Large Area": "area-large",
  "11e Trapezoid Area": "area-trapezoid",
  "11e Medium Area": "area-medium",
  "11e Long Line Area": "area-long-line",
  "11e Short Line Area": "area-short-line",
};

const FEATURE_NAME_TO_TEMPLATE: Record<string, string> = {
  "Wall Long": "wall-long",
  "Wall Medium": "wall-medium",
  "Wall Short": "wall-short",
  "Wall XS": "wall-xs",
  "Warzone Wall Lg": "warzone-wall-large",
  "Warzone Wall Md": "warzone-wall-medium",
  "Warzone Wall Sm": "warzone-wall-small",
  "XS Corner": "corner-xs",
  "Small Corner": "corner-small",
  "Medium Corner": "corner-medium",
  "Large Corner": "corner-large",
  Canister: "canister",
  Scaffold: "scaffold",
  Pipe: "pipe",
  "Floor 4x4": "floor-4x4",
  "Floor 3x4": "floor-3x4",
  "Floor 2.5x4": "floor-2p5x4",
  "Floor Trapezoid": "floor-trapezoid",
};

const MIRRORS: Mirror[] = ["none", "horizontal", "vertical"];

function applyMirror(v: Vec2, m: Mirror): Vec2 {
  if (m === "horizontal") return { x: -v.x, y: v.y };
  if (m === "vertical") return { x: v.x, y: -v.y };
  return v;
}
function rotateCw(v: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/**
 * Recover (rotation, mirror) such that the resolver, placing `template` at the
 * ground-truth centroid, reproduces `gt`. `templateVerts` are the catalog
 * footprint vertices in the SAME order as `gt` (the source shape is identical
 * to the catalog shape for areas). Returns null if no mirror gives a clean fit.
 */
function recoverOrientation(
  templateVerts: Vec2[],
  gt: Vec2[],
): { rotation_degrees: number; mirror: Mirror } | null {
  const cV = polygonCentroid(templateVerts);
  const cGt = polygonCentroid(gt);
  let best: { rotation_degrees: number; mirror: Mirror; residual: number } | null = null;
  for (const mirror of MIRRORS) {
    const A = templateVerts.map((v) => applyMirror(sub(v, cV), mirror));
    const B = gt.map((v) => sub(v, cGt));
    let cross = 0;
    let dot = 0;
    for (let i = 0; i < A.length; i++) {
      cross += A[i].x * B[i].y - A[i].y * B[i].x;
      dot += A[i].x * B[i].x + A[i].y * B[i].y;
    }
    const theta = Math.atan2(cross, dot);
    let residual = 0;
    for (let i = 0; i < A.length; i++) {
      const r = rotateCw(A[i], (theta * 180) / Math.PI);
      residual = Math.max(residual, Math.hypot(r.x - B[i].x, r.y - B[i].y));
    }
    let deg = ((theta * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;
    if (deg >= 360 - 1e-9) deg = 0;
    if (!best || residual < best.residual) best = { rotation_degrees: deg, mirror, residual };
  }
  return best && best.residual <= TOL ? { rotation_degrees: best.rotation_degrees, mirror: best.mirror } : null;
}

// ---- per-shape baked footprint (centroid-relative) ------------------------

function bakedFootprint(gt: Vec2[]): { footprint: Footprint; position: Vec2 } {
  const c = polygonCentroid(gt);
  const rounded = (n: number) => Math.round(n * 1e4) / 1e4;
  return {
    footprint: { type: "polygon", points: gt.map((v) => ({ x: rounded(v.x - c.x), y: rounded(v.y - c.y) })) },
    position: { x: rounded(c.x), y: rounded(c.y) },
  };
}

// ---- migrate one layout ---------------------------------------------------

type OutPiece = Record<string, unknown>;

function migrateLayout(src: SbLayout, idPrefix: string, name: string, catalogById: Map<string, TerrainTemplate>): {
  layout: OutPiece;
  groundTruth: { pieceId: string; verts: Vec2[] }[];
} {
  const pieces: OutPiece[] = [];
  const groundTruth: { pieceId: string; verts: Vec2[] }[] = [];

  for (const p of src.pieces) {
    const isArea = (p.pieceType ?? "area") === "area";
    if (isArea && p.shapes.length === 1) {
      const tid = AREA_NAME_TO_TEMPLATE[p.name];
      const tmpl = tid ? catalogById.get(tid) : undefined;
      if (tmpl) {
        const templateVerts = footprintVertices(tmpl.footprint);
        const gt = sbShapeBoardVerts(p.shapes[0], p);
        const ori = recoverOrientation(templateVerts, gt);
        if (ori) {
          const c = polygonCentroid(gt);
          const round = (n: number) => Math.round(n * 1e4) / 1e4;
          const piece: OutPiece = {
            id: p.id,
            name: p.name,
            piece_type: "area",
            template: tid,
            position: { x: round(c.x), y: round(c.y) },
          };
          if (Math.abs(ori.rotation_degrees) > 1e-6) piece.rotation_degrees = round(ori.rotation_degrees);
          if (ori.mirror !== "none") piece.mirror = ori.mirror;
          if (p.linkGroup) piece.link_group = p.linkGroup;
          pieces.push(piece);
          groundTruth.push({ pieceId: p.id, verts: gt });
          continue;
        }
      }
    }
    // Feature (or unmatched area): bake each shape as its own inline piece.
    const tid = FEATURE_NAME_TO_TEMPLATE[p.name] ?? AREA_NAME_TO_TEMPLATE[p.name];
    p.shapes.forEach((shape, i) => {
      const gt = sbShapeBoardVerts(shape, p);
      const { footprint, position } = bakedFootprint(gt);
      const pieceId = p.shapes.length > 1 ? `${p.id}-${i + 1}` : p.id;
      const piece: OutPiece = {
        id: pieceId,
        name: p.name,
        piece_type: isArea ? "area" : "feature",
        footprint,
        position,
      };
      if (tid) piece.template = tid;
      if (p.floor) piece.floor = p.floor;
      if (p.linkGroup) piece.link_group = p.linkGroup;
      pieces.push(piece);
      groundTruth.push({ pieceId, verts: gt });
    });
  }

  return {
    layout: {
      id: idPrefix,
      name,
      source: "gw-11e",
      pieces,
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" },
    },
    groundTruth,
  };
}

// ---- verify: re-resolve and diff against ground truth ---------------------

function multisetMatch(a: Vec2[], b: Vec2[]): boolean {
  if (a.length !== b.length) return false;
  const used = new Array<boolean>(b.length).fill(false);
  for (const va of a) {
    let found = -1;
    for (let j = 0; j < b.length; j++) {
      if (!used[j] && Math.abs(va.x - b[j].x) <= TOL && Math.abs(va.y - b[j].y) <= TOL) {
        found = j;
        break;
      }
    }
    if (found < 0) return false;
    used[found] = true;
  }
  return true;
}

function main(): void {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as TerrainTemplate[];
  const catalogById = new Map(catalog.map((t) => [t.id, t]));

  const sources: { file: string; id: string; name: string }[] = [
    { file: "crucible-of-battle.json", id: "gw-11e-crucible", name: "Crucible of Battle" },
    { file: "hammer-and-anvil.json", id: "gw-11e-hammer-anvil", name: "Hammer and Anvil" },
  ];

  const out: OutPiece[] = [];
  let totalPieces = 0;
  let failures = 0;

  for (const s of sources) {
    const src = JSON.parse(readFileSync(join(SB, s.file), "utf8")) as SbLayout;
    const { layout, groundTruth } = migrateLayout(src, s.id, s.name, catalogById);

    // Verify by re-resolving the migrated layout against the catalog.
    const resolved = resolveLayout(layout as unknown as TerrainLayout, catalog);
    const byId = new Map(resolved.filter((r) => r.id).map((r) => [r.id as string, r]));
    for (const { pieceId, verts } of groundTruth) {
      totalPieces++;
      const r = byId.get(pieceId);
      if (!r || !multisetMatch(r.vertices, verts)) {
        failures++;
        console.error(`  ✗ ${s.id}/${pieceId}: resolved geometry does not match source`);
      }
    }
    console.log(`${s.id}: ${(layout.pieces as unknown[]).length} pieces, ${groundTruth.length} verified`);
    out.push(layout);
  }

  if (failures > 0) {
    console.error(`\nMIGRATION FAILED: ${failures}/${totalPieces} pieces did not reproduce source geometry.`);
    process.exit(1);
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nAll ${totalPieces} pieces verified within ${TOL}. Wrote ${OUT_PATH}`);
}

main();
