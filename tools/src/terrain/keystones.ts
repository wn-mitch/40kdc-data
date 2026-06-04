/**
 * Measurement-keystone derivation — the forward direction of the card solver.
 *
 * A keystone stores only the author's *selection* (board edge → a feature of
 * the placed piece); the printed distance is always derived from the resolved
 * geometry here, so a keystone can never disagree with the layout. This is
 * how a layout entity becomes a data-driven reference card: the diagram comes
 * from {@link resolveLayout}, the dimension callouts from this module.
 *
 * Mirrored by the Rust `wh40kdc::terrain` module and pinned by the
 * `conformance/terrain-keystones` corpus. Distances are raw inches rounded to
 * 4 dp (the resolver's vertex rounding); display formatting (½″ rounding and
 * the like) is deliberately presentation, not part of this contract.
 */
import {
  resolveLayout,
  type BoardEdge,
  type Keystone,
  type ResolvedPiece,
  type TerrainLayout,
  type TerrainTemplate,
} from "./resolve.js";

/** The 40kdc standard board extents, in inches (x spans width, y height). */
export const BOARD_INCHES = { width: 60, height: 44 } as const;

export class TerrainKeystoneError extends Error {}

/** One derived dimension line, ready to print on a card. */
export interface KeystoneMeasurement {
  /** Index of the owning piece in `layout.pieces`. */
  piece_index: number;
  /** The owning piece's layout-local id, or null when it has none. */
  piece_id: string | null;
  edge: BoardEdge;
  ref: Keystone["ref"];
  /** Derived distance from `edge` to `ref`, in inches, rounded to 4 dp. */
  distance: number;
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function axisOfEdge(edge: BoardEdge): "x" | "y" {
  return edge === "left" || edge === "right" ? "x" : "y";
}

/** The measured board-space coordinate a keystone's ref resolves to. */
function refCoordinate(rp: ResolvedPiece, k: Keystone, where: string): number {
  const axis = axisOfEdge(k.edge);
  if (k.ref.kind === "vertex") {
    const v = rp.vertices[k.ref.index];
    if (!v) {
      throw new TerrainKeystoneError(
        `${where}: keystone vertex index ${k.ref.index} out of range (${rp.vertices.length} vertices)`,
      );
    }
    return v[axis];
  }
  const sideAxis = k.ref.side === "min-x" || k.ref.side === "max-x" ? "x" : "y";
  if (sideAxis !== axis) {
    throw new TerrainKeystoneError(
      `${where}: face "${k.ref.side}" cannot be measured from the ${k.edge} edge (axis mismatch)`,
    );
  }
  const vals = rp.vertices.map((v) => v[axis]);
  return k.ref.side.startsWith("min") ? Math.min(...vals) : Math.max(...vals);
}

/**
 * Derive every keystone's printed distance for a layout. Pieces resolve via
 * {@link resolveLayout} (the pinned transform contract), then each keystone
 * measures from its board edge to the referenced feature of the placed piece:
 * near edges (`left`/`top`) read the coordinate directly, far edges
 * (`right`/`bottom`) read the remaining extent.
 *
 * Throws {@link TerrainKeystoneError} for a vertex index out of range or a
 * face whose axis disagrees with the edge; resolution failures propagate as
 * the resolver's own error.
 */
export function keystoneMeasurements(
  layout: TerrainLayout,
  templates: TerrainTemplate[],
  board: { width: number; height: number } = BOARD_INCHES,
): KeystoneMeasurement[] {
  const resolved = resolveLayout(layout, templates);
  const byTemplate = new Map(templates.map((t) => [t.id, t] as const));
  const pieces = layout.pieces ?? [];
  const out: KeystoneMeasurement[] = [];

  // Walk the emission contract: one entry per explicit piece, in order, with
  // an unparented templated piece followed by its template's composed
  // features.
  let cursor = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    const rp = resolved[cursor];
    if (!rp) {
      throw new TerrainKeystoneError(`piece ${i}: resolved emission shorter than layout.pieces`);
    }
    cursor += 1;
    if (!piece.parent_area_id && piece.template) {
      cursor += byTemplate.get(piece.template)?.features?.length ?? 0;
    }

    for (const k of piece.keystones ?? []) {
      const where = `piece ${rp.id ?? i}`;
      const c = refCoordinate(rp, k, where);
      const extent = axisOfEdge(k.edge) === "x" ? board.width : board.height;
      const distance = k.edge === "left" || k.edge === "top" ? c : extent - c;
      out.push({
        piece_index: i,
        piece_id: rp.id,
        edge: k.edge,
        ref: k.ref,
        distance: round4(distance),
      });
    }
  }
  return out;
}
