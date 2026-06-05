// The linked, typed dataset — the primary entry point.
export * from "./data/index.js";

// Generated types for every entity in the dataset.
export * from "./generated.js";

// Plain-English translation of structured data (scoring-card awards + the
// shared Ability-DSL condition humanizer). Cross-impl pinned by conformance.
export * from "./translate/index.js";

// `ScoringTrigger` is emitted by both ./generated.js (schema-derived) and
// ./translate (hand-authored). They are structurally identical; disambiguate the
// two wildcard re-exports in favour of the generated, schema-canonical type.
export type { ScoringTrigger } from "./generated.js";

// `AbilityScope` likewise: ./translate/effect.ts hand-authors a looser view
// for the describer; prefer the generated, schema-canonical type.
export type { AbilityScope } from "./generated.js";

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
  solveCentroidTriangulated,
  solveCentroidAttached,
  TerrainSolveError,
  keystoneMeasurements,
  BOARD_INCHES,
  TerrainKeystoneError,
} from "./terrain/index.js";
export type {
  ResolvedPiece,
  ResolvedVec2,
  BoardEdge,
  FeatureRef,
  Keystone,
  KeystoneMeasurement,
  DimensionLine,
  SolveInput,
  TriangulationLine,
  TriangulateInput,
  AttachLine,
  AttachPiece,
  AttachInput,
} from "./terrain/index.js";

// Card-driven secondary-mission scoring: compute VP from asserted awards and
// track per-round, per-player scoring. Mirrored by the Rust `wh40kdc::scoring`
// module and pinned by the `conformance/scoring` corpus.
export * from "./scoring/index.js";

// Schema access + AJV validation lives behind the `./validate` subpath export
// (`@alpaca-software/40kdc-data/validate`), NOT the root barrel: it reads
// schema files from disk at module load (node:fs/node:url), which breaks
// browser bundles. The root barrel stays universal (Node + browser).

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
