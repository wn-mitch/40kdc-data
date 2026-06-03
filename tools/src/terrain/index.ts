/**
 * Terrain geometry: resolve template-anchored layouts to absolute board-space
 * vertices. See {@link resolveLayout} for the transform contract.
 *
 * @packageDocumentation
 */
export {
  resolveLayout,
  polygonCentroid,
  footprintVertices,
  orientedOffsets,
  TerrainResolveError,
} from "./resolve.js";
export type { ResolvedPiece, Vec2 as ResolvedVec2 } from "./resolve.js";
export { solveCentroid, solveCentroidTriangulated, TerrainSolveError } from "./solve.js";
export type {
  BoardEdge,
  FeatureRef,
  DimensionLine,
  SolveInput,
  TriangulationLine,
  TriangulateInput,
} from "./solve.js";
