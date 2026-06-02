/**
 * Editor model + the thin seam onto the 40kdc-data terrain library.
 *
 * The whole point of this example: authoring a terrain layout is just building
 * the canonical `terrain-layout` data, and *seeing* it is one call to the same
 * `resolveLayout` the conformance corpus pins. The card-measurement solver
 * (`solveCentroid`) is the package's inverse of that placement, so transcribing
 * a reference card never requires guessing a canonical anchor.
 */
import {
  Dataset,
  resolveLayout,
  solveCentroid,
  footprintVertices,
} from "@alpaca-software/40kdc-data";
import type {
  ResolvedPiece,
  ResolvedVec2,
  SolveInput,
  TerrainTemplate,
  TerrainLayout,
} from "@alpaca-software/40kdc-data";

export const BOARD = { width: 60, height: 44 } as const;

export type Mirror = "none" | "horizontal" | "vertical";
export interface Vec2 {
  x: number;
  y: number;
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

let counter = 0;
function freshId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Add a catalog template to the layout, centred on the board. */
export function addTemplate(layout: EditLayout, template: TerrainTemplate): EditPiece {
  const piece: EditPiece = {
    id: freshId(template.id),
    name: template.name,
    piece_type: template.kind,
    template: template.id,
    position: { x: BOARD.width / 2, y: BOARD.height / 2 },
    rotation_degrees: 0,
    mirror: "none",
  };
  layout.pieces.push(piece);
  return piece;
}

/** A blank layout. */
export function blankLayout(): EditLayout {
  counter = 0;
  return { id: "untitled-layout", name: "Untitled Layout", source: "custom", pieces: [] };
}

/** Deep-clone an embedded layout into the editable model. */
export function loadEmbedded(id: string): EditLayout | undefined {
  const raw = ds.terrainLayouts.get(id) as TerrainLayout | undefined;
  if (!raw) return undefined;
  counter = 0;
  return {
    id: raw.id,
    name: raw.name,
    source: raw.source,
    pieces: (raw.pieces ?? []).map((p, i) => ({
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
    })),
  };
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Canonical `terrain-layout` JSON for the working layout (drops editor defaults). */
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

// Re-exports the inspector's solver panel leans on.
export { solveCentroid, footprintVertices };
export type { SolveInput };
