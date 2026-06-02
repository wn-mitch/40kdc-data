// The linked, typed dataset — the primary entry point.
export * from "./data/index.js";

// Generated types for every entity in the dataset.
export * from "./generated.js";

// Plain-English translation of structured data (scoring-card awards + the
// shared Ability-DSL condition humanizer). Cross-impl pinned by conformance.
export * from "./translate/index.js";

// Terrain geometry resolver (template-anchored layout → board-space vertices).
// Curated (not wildcard) so its internal type aliases don't clash with the
// generated Footprint/TerrainTemplate/TerrainLayout types. Cross-impl pinned.
export {
  resolveLayout,
  polygonCentroid,
  footprintVertices,
  orientedOffsets,
  TerrainResolveError,
  solveCentroid,
  TerrainSolveError,
} from "./terrain/index.js";
export type {
  ResolvedPiece,
  ResolvedVec2,
  BoardEdge,
  FeatureRef,
  DimensionLine,
  SolveInput,
} from "./terrain/index.js";

// Schema access + AJV validation (secondary: this package also validates data
// against the canonical JSON Schemas).
export {
  createValidator,
  findSchemaFiles,
  listSchemaIds,
  SCHEMAS_ROOT,
} from "./schema-loader.js";

// Army-list importer (ListForge → resolved 40kdc roster). Types are curated
// rather than re-exported wholesale to avoid name clashes with generated types
// (e.g. BattleSize, LeaderAttachment).
export {
  importListForge,
  importNewRecruit,
  importRoster,
  tryImportRoster,
  decodeListForge,
} from "./import/index.js";

// Army-list exporter (Roster → text or JSON for any of the supported formats).
export {
  exportRoster,
  newRecruitJsonSerializer,
  newRecruitSimpleSerializer,
  newRecruitWtcCompactSerializer,
  newRecruitWtcFullSerializer,
  rosterJsonSerializer,
  rosterizerSerializer,
} from "./export/index.js";
export type { ExportFormat, RosterSerializer } from "./export/index.js";
export type { FormatAdapter } from "./import/index.js";
export type {
  ImportOptions,
  ImportResult,
  ImportFailureReason,
  AdapterTrial,
  Roster,
  RosterUnit,
  RosterWargear,
  RosterSource,
  RosterFormat,
  RosterPoints,
  RosterLeaderAttachment,
  ResolvedRef,
  Candidate,
  Diagnostics,
  Warning,
  WarningCode,
  ParsedRoster,
  ParsedUnit,
  ParsedWargear,
} from "./import/index.js";
