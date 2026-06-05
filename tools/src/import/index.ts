/**
 * Army-list importer: turn an external list-builder export into a resolved
 * 40kdc roster.
 *
 * v1 supports ListForge's "share JSON" payload. The output is a {@link Roster}
 * keyed on 40kdc entity ids and validatable against
 * `schemas/core/roster.schema.json`. Resolution is lenient — unmatched names are
 * retained with candidate suggestions and summarised in diagnostics.
 *
 * @packageDocumentation
 */
export {
  importListForge,
  importNewRecruit,
  importRoster,
  tryImportRoster,
  REGISTERED_ADAPTERS,
} from "./import-roster.js";
export type {
  ImportOptions,
  ImportResult,
  ImportFailureReason,
  AdapterTrial,
} from "./import-roster.js";
export { decodeListForge } from "./decode.js";
export { resolve } from "./resolve.js";
export { listForgeAdapter } from "./listforge.js";
export { listForgeTextAdapter } from "./listforge-text.js";
export { newRecruitJsonAdapter } from "./newrecruit-json.js";
export { newRecruitSimpleAdapter } from "./newrecruit-simple.js";
export {
  newRecruitWtcCompactAdapter,
  newRecruitWtcFullAdapter,
} from "./newrecruit-wtc.js";
export type { FormatAdapter } from "./adapter.js";
export type {
  Roster,
  RosterUnit,
  RosterWargear,
  RosterSource,
  RosterFormat,
  RosterPoints,
  ResolvedRef,
  Candidate,
  RosterLeaderAttachment,
  Diagnostics,
  Warning,
  WarningCode,
  BattleSize,
  GameVersionRef,
  ParsedRoster,
  ParsedUnit,
  ParsedWargear,
} from "./types.js";
