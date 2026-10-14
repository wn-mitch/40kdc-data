import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { hashJson } from "../round4/hash.js";
import { familyRole, validateFingerprint, type SemanticRole } from "./contracts.js";
import { bumpWorkbenchRevision, exactSpan, insertSpan, withTransaction } from "./db.js";

type JsonRecord = Record<string, unknown>;

type LegacyFingerprint = {
  id: string;
  canonicalHash: string | null;
  family: string;
  version: number;
  parameters: Record<string, unknown>;
};

type ManifestCandidate = {
  id: string;
  split: string;
  source: {
    factionId: string;
    abilityId: string;
    sourceHash: string;
    fragment: string;
    start: number;
    end: number;
  };
};

type TrainRow = {
  candidateId: string;
  split: string;
  queriedFingerprintId: string;
  sourceHash: string;
  fragment: string;
  start: number;
  end: number;
  targetSpan: string;
  leftContext: string;
  rightContext: string;
  rubricVersion: string;
  verdict: string | null;
  batchId: string | null;
  confirmer: string | null;
  confirmedAt: string | null;
  source: JsonRecord;
};

type CurrentAbility = {
  id: number;
  sourceHash: string;
  sourceText: string;
  fragments: SourceFragment[];
};

type SourceFragment = {
  fragment: string;
  startByte: number;
  endByte: number;
  text: string;
};

export type MigrationIssue = {
  identity: string;
  reason: string;
};

export type ImportHitTrainReport = {
  manifestHash: string;
  pairwise: {
    reviewed: number;
    imported: number;
    existing: number;
    exactPromoted: number;
    parameterReviewProposals: number;
    stale: number;
    unreviewed: number;
  };
  recall: {
    reviewed: number;
    imported: number;
    existing: number;
    promoted: number;
    queuedForReview: number;
    stale: number;
  };
  conflicts: MigrationIssue[];
  stale: MigrationIssue[];
};

const HIT_TRAIN_BATCH_OPERATION = "import-hit-train";
const RECALL_BATCH_OPERATION = "import-recall-audit";
const HIT_TRAIN_ORIGIN = "hit-train";
const RECALL_ORIGIN = "recall-audit";
const DEFAULT_HIT_TRAIN_ROOT = resolve(fileURLToPath(new URL("../../../_private/round5b-hit-roll", import.meta.url)));

function requireRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value)) throw new Error(`${label} must be a ${allowEmpty ? "string" : "non-empty string"}`);
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, label);
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function parseJsonFile(path: string): JsonRecord {
  try {
    return requireRecord(JSON.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    throw new Error(`Cannot read Round 5B artifact ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseSpan(value: unknown, label: string): { start: number; end: number } {
  const span = requireRecord(value, label);
  const start = requireInteger(span.start, `${label}.start`);
  const end = requireInteger(span.end, `${label}.end`);
  if (start < 0 || end < start) throw new Error(`${label} has invalid byte bounds`);
  return { start, end };
}

function parseLegacyFingerprints(value: unknown, label: string): Map<string, LegacyFingerprint> {
  const fingerprints = new Map<string, LegacyFingerprint>();
  for (const [index, item] of requireArray(value, label).entries()) {
    const fingerprint = requireRecord(item, `${label}[${index}]`);
    const id = requireString(fingerprint.id, `${label}[${index}].id`);
    const family = requireString(fingerprint.family, `${label}[${index}].family`);
    const version = requireInteger(fingerprint.version, `${label}[${index}].version`);
    const parameters = requireRecord(fingerprint.parameters, `${label}[${index}].parameters`);
    const canonicalHash = fingerprint.canonical_hash === undefined
      ? null
      : requireString(fingerprint.canonical_hash, `${label}[${index}].canonical_hash`);
    if (canonicalHash !== null && !/^[0-9a-f]{64}$/u.test(canonicalHash)) {
      throw new Error(`${label}[${index}].canonical_hash must be a SHA-256 hex digest`);
    }
    if (fingerprints.has(id)) throw new Error(`${label} repeats fingerprint ${id}`);
    fingerprints.set(id, { id, canonicalHash, family, version, parameters });
  }
  return fingerprints;
}
function verifyTrainFingerprintDefinitions(
  trainFingerprints: Map<string, LegacyFingerprint>,
  manifestFingerprints: Map<string, LegacyFingerprint>,
): void {
  for (const [id, fingerprint] of trainFingerprints) {
    const manifestFingerprint = manifestFingerprints.get(id);
    if (!manifestFingerprint) throw new Error(`Train fingerprint ${id} is absent from candidates.json`);
    if (
      fingerprint.canonicalHash !== manifestFingerprint.canonicalHash ||
      fingerprint.family !== manifestFingerprint.family ||
      fingerprint.version !== manifestFingerprint.version ||
      hashJson(fingerprint.parameters) !== hashJson(manifestFingerprint.parameters)
    ) {
      throw new Error(`Train fingerprint ${id} differs from candidates.json`);
    }
  }
}


function parseManifestCandidates(value: unknown): Map<string, ManifestCandidate> {
  const candidates = new Map<string, ManifestCandidate>();
  for (const [index, item] of requireArray(value, "candidates.json.candidates").entries()) {
    const candidate = requireRecord(item, `candidates.json.candidates[${index}]`);
    const source = requireRecord(candidate.source, `candidates.json.candidates[${index}].source`);
    const span = parseSpan(source.span, `candidates.json.candidates[${index}].source.span`);
    const id = requireString(candidate.id, `candidates.json.candidates[${index}].id`);
    const parsed: ManifestCandidate = {
      id,
      split: requireString(candidate.split, `candidates.json.candidates[${index}].split`),
      source: {
        factionId: requireString(source.faction_id, `candidates.json.candidates[${index}].source.faction_id`),
        abilityId: requireString(source.ability_id, `candidates.json.candidates[${index}].source.ability_id`),
        sourceHash: requireString(source.source_hash, `candidates.json.candidates[${index}].source.source_hash`),
        fragment: requireString(source.fragment, `candidates.json.candidates[${index}].source.fragment`),
        start: span.start,
        end: span.end,
      },
    };
    const previous = candidates.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parsed)) throw new Error(`candidates.json repeats conflicting candidate ${id}`);
    candidates.set(id, parsed);
  }
  return candidates;
}

function parseTrainRows(value: unknown): TrainRow[] {
  return requireArray(value, "train-labels.json.rows").map((item, index) => {
    const row = requireRecord(item, `train-labels.json.rows[${index}]`);
    const span = parseSpan(row.span, `train-labels.json.rows[${index}].span`);
    const verdict = row.verdict === undefined || row.verdict === null ? null : requireString(row.verdict, `train-labels.json.rows[${index}].verdict`);
    return {
      candidateId: requireString(row.candidate_id, `train-labels.json.rows[${index}].candidate_id`),
      split: requireString(row.split, `train-labels.json.rows[${index}].split`),
      queriedFingerprintId: requireString(row.queried_fingerprint_id, `train-labels.json.rows[${index}].queried_fingerprint_id`),
      sourceHash: requireString(row.source_hash, `train-labels.json.rows[${index}].source_hash`),
      fragment: requireString(row.fragment, `train-labels.json.rows[${index}].fragment`),
      start: span.start,
      end: span.end,
      targetSpan: requireString(row.target_span, `train-labels.json.rows[${index}].target_span`),
      leftContext: requireString(row.left_context, `train-labels.json.rows[${index}].left_context`, true),
      rightContext: requireString(row.right_context, `train-labels.json.rows[${index}].right_context`, true),
      rubricVersion: requireString(row.rubric_version, `train-labels.json.rows[${index}].rubric_version`),
      verdict,
      batchId: optionalString(row.batch_id, `train-labels.json.rows[${index}].batch_id`),
      confirmer: optionalString(row.confirmer, `train-labels.json.rows[${index}].confirmer`),
      confirmedAt: optionalString(row.confirmed_at, `train-labels.json.rows[${index}].confirmed_at`),
      source: row,
    };
  });
}

function parseFragments(value: unknown): SourceFragment[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return requireArray(parsed, "abilities.fragments_json").map((item, index) => {
    const fragment = requireRecord(item, `abilities.fragments_json[${index}]`);
    const startByte = requireInteger(fragment.start_byte, `abilities.fragments_json[${index}].start_byte`);
    const endByte = requireInteger(fragment.end_byte, `abilities.fragments_json[${index}].end_byte`);
    if (startByte < 0 || endByte < startByte) throw new Error(`abilities.fragments_json[${index}] has invalid byte bounds`);
    return {
      fragment: requireString(fragment.fragment, `abilities.fragments_json[${index}].fragment`),
      startByte,
      endByte,
      text: requireString(fragment.text, `abilities.fragments_json[${index}].text`),
    };
  });
}

function findCurrentAbility(db: DatabaseSync, factionId: string, abilityId: string): CurrentAbility | null {
  const row = db.prepare(`
    SELECT id, source_hash, source_text, fragments_json
    FROM abilities
    WHERE faction_id = ? AND ability_id = ? AND current = 1
  `).get(factionId, abilityId) as JsonRecord | undefined;
  if (!row) return null;
  return {
    id: requireInteger(row.id, "abilities.id"),
    sourceHash: requireString(row.source_hash, "abilities.source_hash"),
    sourceText: requireString(row.source_text, "abilities.source_text"),
    fragments: parseFragments(row.fragments_json),
  };
}

function bytesEndWith(bytes: Buffer, end: number, expected: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const start = end - expectedBytes.length;
  return start >= 0 && bytes.subarray(start, end).equals(expectedBytes);
}

function bytesStartWith(bytes: Buffer, start: number, expected: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const end = start + expectedBytes.length;
  return end <= bytes.length && bytes.subarray(start, end).equals(expectedBytes);
}

function currentCandidateDriftReason(ability: CurrentAbility, candidate: ManifestCandidate, row: TrainRow): string | null {
  if (ability.sourceHash !== candidate.source.sourceHash) return "source-hash-drift";
  const fragment = ability.fragments.find((entry) => entry.fragment === candidate.source.fragment);
  if (!fragment) return "fragment-missing";
  if (candidate.source.start < fragment.startByte || candidate.source.end > fragment.endByte) return "span-outside-fragment";

  const bytes = Buffer.from(ability.sourceText, "utf8");
  if (Buffer.byteLength(fragment.text, "utf8") !== fragment.endByte - fragment.startByte ||
      !bytes.subarray(fragment.startByte, fragment.endByte).equals(Buffer.from(fragment.text, "utf8"))) {
    return "fragment-boundary-drift";
  }
  let exact: string;
  try {
    exact = exactSpan(ability.sourceText, candidate.source.start, candidate.source.end);
  } catch {
    return "span-byte-boundary-drift";
  }
  if (exact !== row.targetSpan) throw new Error(`Train row ${row.candidateId} target span conflicts with the current matching source hash`);
  if (!bytesEndWith(bytes, candidate.source.start, row.leftContext) || !bytesStartWith(bytes, candidate.source.end, row.rightContext)) {
    throw new Error(`Train row ${row.candidateId} contexts conflict with the current matching source hash`);
  }
  return null;
}

function spanForCurrentCandidate(db: DatabaseSync, ability: CurrentAbility, candidate: ManifestCandidate, exactText: string): number {
  const existing = db.prepare(`
    SELECT id FROM source_spans
    WHERE ability_version_id = ? AND fragment = ? AND start_byte = ? AND end_byte = ?
  `).get(ability.id, candidate.source.fragment, candidate.source.start, candidate.source.end) as JsonRecord | undefined;
  if (existing) return requireInteger(existing.id, "source_spans.id");
  return insertSpan(db, ability.id, candidate.source.fragment, candidate.source.start, candidate.source.end, exactText);
}

function ensureHistoricalBatch(db: DatabaseSync, id: string, reviewer: string | null, createdAt: string | null, operation: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO annotation_batches (id, operation, reviewer, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, operation, reviewer ?? "round5b-import", createdAt ?? "1970-01-01T00:00:00.000Z");
}

function addBatchMember(db: DatabaseSync, batchId: string | null, entityKind: string, entityId: number): void {
  if (!batchId) return;
  db.prepare(`
    INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id)
    VALUES (?, ?, ?)
  `).run(batchId, entityKind, String(entityId));
}

function getNumber(value: number | bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("SQLite row id exceeds JavaScript safe integer range");
  return number;
}

function insertJudgment(
  db: DatabaseSync,
  candidateId: string,
  queriedFingerprintId: string,
  verdict: string,
  sourceArtifactHash: string,
  sourceRowJson: string,
  batchId: string | null,
): { id: number; inserted: boolean } {
  const existing = db.prepare(`
    SELECT id, verdict, source_row_json, batch_id
    FROM candidate_judgments
    WHERE candidate_id = ? AND queried_fingerprint_id = ? AND source_artifact_hash = ?
  `).get(candidateId, queriedFingerprintId, sourceArtifactHash) as JsonRecord | undefined;
  if (existing) {
    if (existing.verdict !== verdict || existing.source_row_json !== sourceRowJson || existing.batch_id !== batchId) {
      throw new Error(`Historical judgment ${candidateId}/${queriedFingerprintId} conflicts with existing imported evidence`);
    }
    return { id: requireInteger(existing.id, "candidate_judgments.id"), inserted: false };
  }
  const result = db.prepare(`
    INSERT INTO candidate_judgments (
      candidate_id, queried_fingerprint_id, verdict, source_artifact_hash, source_row_json, batch_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(candidateId, queriedFingerprintId, verdict, sourceArtifactHash, sourceRowJson, batchId);
  return { id: getNumber(result.lastInsertRowid), inserted: true };
}

function fingerprintForLegacy(
  db: DatabaseSync,
  legacy: LegacyFingerprint,
  exactText: string,
  report: ImportHitTrainReport,
): string | null {
  let id: string;
  try {
    id = validateFingerprint(db, legacy.family, legacy.parameters, legacy.version, exactText);
  } catch (error) {
    report.conflicts.push({ identity: legacy.id, reason: `registry-validation:${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
  const bound = db.prepare("SELECT id FROM fingerprints WHERE legacy_fingerprint_id = ?").get(legacy.id) as JsonRecord | undefined;
  if (bound && bound.id !== id) {
    report.conflicts.push({ identity: legacy.id, reason: `legacy-mapping-conflict:${String(bound.id)}` });
    return null;
  }
  db.prepare(`
    UPDATE fingerprints
    SET legacy_fingerprint_id = COALESCE(legacy_fingerprint_id, ?)
    WHERE id = ?
  `).run(legacy.id, id);
  return id;
}

/** Only an explicit, complete phrase identifies a modifier variant without another human judgment. */
function explicitHitModifier(text: string): Record<string, unknown> | null {
  const match = /^(add|subtract) (\d+) (to|from) the hit roll$/iu.exec(text.trim());
  if (!match || (match[1] === "add" ? match[3] !== "to" : match[3] !== "from")) return null;
  const value = Number(match[2]);
  return Number.isSafeInteger(value) ? { roll: "hit", operation: match[1]!.toLowerCase(), value } : null;
}

/**
 * Historical related-variant judgments are evidence that the queried fingerprint is NOT
 * an exact match. Rebind only phrases that explicitly name their complete modifier;
 * leave every other variant unclassified rather than inviting a false confirmation.
 */
export function repairRelatedVariantProposals(db: DatabaseSync): { rebound: number; unclassified: number } {
  return withTransaction(db, () => {
    const rows = db.prepare(`
      SELECT proposals.id, proposals.fingerprint_id, source_spans.exact_text,
        queried.id AS queried_fingerprint_id
      FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
      LEFT JOIN fingerprints AS queried
        ON queried.legacy_fingerprint_id = json_extract(proposals.reason_json, '$.legacy_queried_fingerprint_id')
      WHERE proposals.origin = 'hit-train' AND proposals.status = 'pending'
        AND json_extract(proposals.reason_json, '$.type') = 'parameter-review'
        AND json_extract(proposals.reason_json, '$.verdict') = 'related-variant'
        AND json_extract(proposals.reason_json, '$.sideways_review') IS NULL
    `).all() as Array<{ id: number; fingerprint_id: string | null; queried_fingerprint_id: string | null; exact_text: string }>;
    const update = db.prepare("UPDATE proposals SET fingerprint_id = ? WHERE id = ? AND fingerprint_id IS ?");
    let rebound = 0;
    let unclassified = 0;
    for (const row of rows) {
      const parameters = explicitHitModifier(row.exact_text);
      const inferred = parameters ? validateFingerprint(db, "roll-modifier", parameters, 1, row.exact_text) : null;
      const fingerprint = inferred === row.queried_fingerprint_id ? null : inferred;
      if (fingerprint === row.fingerprint_id) continue;
      update.run(fingerprint, row.id, row.fingerprint_id);
      if (fingerprint) rebound += 1;
      else unclassified += 1;
    }
    if (rebound || unclassified) bumpWorkbenchRevision(db);
    return { rebound, unclassified };
  });
}

function fingerprintForSidewaysChoice(
  db: DatabaseSync,
  choice: string | null,
  exactText: string,
  report: ImportHitTrainReport,
): { id: string; role: SemanticRole } | null {
  const definitions: Record<string, Omit<LegacyFingerprint, "id" | "canonicalHash">> = {
    "modifier-add-one": { family: "roll-modifier", version: 1, parameters: { roll: "hit", operation: "add", value: 1 } },
    "modifier-subtract-one": { family: "roll-modifier", version: 1, parameters: { roll: "hit", operation: "subtract", value: 1 } },
    "reroll-ones": { family: "reroll", version: 1, parameters: { roll: "hit", subset: "ones" } },
    "reroll-all": { family: "reroll", version: 1, parameters: { roll: "hit", subset: "all" } },
    "critical-hit-threshold": { family: "critical-hit-threshold", version: 1, parameters: { value: "source" } },
  };
  if (!choice || !definitions[choice]) return null;
  const definition = definitions[choice];
  const id = fingerprintForLegacy(
    db,
    { id: `round5b-sideways:${choice}`, canonicalHash: null, ...definition },
    exactText,
    report,
  );
  if (!id) return null;
  const role = familyRole(definition.family, definition.version);
  // Only effect families are listed above; a combinator can never be a proposal role.
  if (role === "COMBINATOR" || role === "RESTRICTION") throw new Error(`Sideways choice ${choice} maps to a ${role.toLowerCase()}.`);
  return { id, role };
}

function insertPendingProposal(
  db: DatabaseSync,
  spanId: number,
  fingerprintId: string | null,
  role: string,
  origin: string,
  reason: JsonRecord,
): boolean {
  const migrationKey = requireString(reason.migration_key, "proposal migration key");
  const existing = db.prepare(`
    SELECT id FROM proposals
    WHERE span_id = ? AND origin = ? AND reason_json LIKE ?
  `).get(spanId, origin, `%\"migration_key\":\"${migrationKey}\"%`) as JsonRecord | undefined;
  if (existing) return false;
  db.prepare(`
    INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?)
  `).run(spanId, fingerprintId, role, origin, JSON.stringify(reason), "1970-01-01T00:00:00.000Z");
  return true;
}

function insertActiveAnnotation(
  db: DatabaseSync,
  spanId: number,
  fingerprintId: string,
  origin: string,
  confirmedBy: string | null,
  batchId: string | null,
  createdAt: string | null,
): { id: number; inserted: boolean } {
  const existing = db.prepare(`
    SELECT id FROM annotations
    WHERE span_id = ? AND fingerprint_id = ? AND origin = ? AND status = 'active'
  `).get(spanId, fingerprintId, origin) as JsonRecord | undefined;
  if (existing) return { id: requireInteger(existing.id, "annotations.id"), inserted: false };
  const result = db.prepare(`
    INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
    VALUES (?, ?, 'active', ?, 'human', ?, ?, NULL, ?)
  `).run(spanId, fingerprintId, origin, confirmedBy ?? "round5b-import", batchId, createdAt ?? "1970-01-01T00:00:00.000Z");
  return { id: getNumber(result.lastInsertRowid), inserted: true };
}

function verifyTrainRowAgainstManifest(row: TrainRow, candidate: ManifestCandidate, manifestRubric: string): void {
  if (row.split !== "train") throw new Error(`Train row ${row.candidateId} is not in the train split`);
  if (candidate.split !== "train") throw new Error(`Train row ${row.candidateId} points at non-train candidate`);
  if (row.rubricVersion !== manifestRubric) throw new Error(`Train row ${row.candidateId} rubric version differs from manifest`);
  if (row.sourceHash !== candidate.source.sourceHash || row.fragment !== candidate.source.fragment || row.start !== candidate.source.start || row.end !== candidate.source.end) {
    throw new Error(`Train row ${row.candidateId} does not match its manifest source identity`);
  }
}

function recordStale(report: ImportHitTrainReport, section: "pairwise" | "recall", identity: string, reason: string): void {
  report[section].stale += 1;
  report.stale.push({ identity, reason });
}

function parseSidewaysChoice(row: TrainRow): string | null {
  const sideways = row.source.sideways_review;
  if (sideways === undefined || sideways === null) return null;
  const review = requireRecord(sideways, `train row ${row.candidateId} sideways_review`);
  return optionalString(review.confirmed_choice, `train row ${row.candidateId} sideways_review.confirmed_choice`);
}
function pairwiseSourceRowJson(row: TrainRow, legacy: LegacyFingerprint): string {
  return JSON.stringify({
    ...row.source,
    legacy_fingerprint: {
      id: legacy.id,
      canonical_hash: legacy.canonicalHash,
      family: legacy.family,
      version: legacy.version,
      parameters: legacy.parameters,
    },
  });
}


function importPairwiseRows(
  db: DatabaseSync,
  manifestHash: string,
  manifestRubric: string,
  candidates: Map<string, ManifestCandidate>,
  fingerprints: Map<string, LegacyFingerprint>,
  rows: TrainRow[],
  report: ImportHitTrainReport,
): void {
  for (const row of rows) {
    if (!row.verdict) {
      report.pairwise.unreviewed += 1;
      continue;
    }
    report.pairwise.reviewed += 1;
    const candidate = candidates.get(row.candidateId);
    if (!candidate) throw new Error(`Train row references unknown candidate ${row.candidateId}`);
    verifyTrainRowAgainstManifest(row, candidate, manifestRubric);
    if (!row.batchId) throw new Error(`Reviewed train row ${row.candidateId} has no historical batch id`);
    ensureHistoricalBatch(db, row.batchId, row.confirmer, row.confirmedAt, HIT_TRAIN_BATCH_OPERATION);
    const legacy = fingerprints.get(row.queriedFingerprintId);
    if (!legacy) throw new Error(`Train row ${row.candidateId} references unknown legacy fingerprint ${row.queriedFingerprintId}`);

    const mappedFingerprintId = fingerprintForLegacy(db, legacy, row.targetSpan, report);
    const judgmentFingerprintId = mappedFingerprintId ?? row.queriedFingerprintId;
    const judgment = insertJudgment(
      db,
      row.candidateId,
      judgmentFingerprintId,
      row.verdict,
      manifestHash,
      pairwiseSourceRowJson(row, legacy),
      row.batchId,
    );
    addBatchMember(db, row.batchId, "judgment", judgment.id);
    if (judgment.inserted) report.pairwise.imported += 1;
    else report.pairwise.existing += 1;

    const ability = findCurrentAbility(db, candidate.source.factionId, candidate.source.abilityId);
    if (!ability) {
      recordStale(report, "pairwise", row.candidateId, "ability-version-missing");
      continue;
    }
    const staleReason = currentCandidateDriftReason(ability, candidate, row);
    if (staleReason) {
      recordStale(report, "pairwise", row.candidateId, staleReason);
      continue;
    }
    const spanId = spanForCurrentCandidate(db, ability, candidate, row.targetSpan);

    // Immutable frozen evidence authorizes a promotion only at its first import.
    if (judgment.inserted && row.verdict === "exact-match" && mappedFingerprintId) {
      const annotation = insertActiveAnnotation(db, spanId, mappedFingerprintId, HIT_TRAIN_ORIGIN, row.confirmer, row.batchId, row.confirmedAt);
      addBatchMember(db, row.batchId, "annotation", annotation.id);
      if (annotation.inserted) report.pairwise.exactPromoted += 1;
      continue;
    }

    const sidewaysChoice = parseSidewaysChoice(row);
    if (row.verdict === "related-variant" || sidewaysChoice) {
      const sidewaysFingerprint = fingerprintForSidewaysChoice(db, sidewaysChoice, row.targetSpan, report);
      const inferred = row.verdict === "related-variant" && !sidewaysFingerprint ? explicitHitModifier(row.targetSpan) : null;
      const inferredId = inferred ? validateFingerprint(db, "roll-modifier", inferred, 1, row.targetSpan) : null;
      const fingerprintId = sidewaysFingerprint?.id ?? (inferredId === mappedFingerprintId ? null : inferredId);
      const role = sidewaysFingerprint?.role ?? (mappedFingerprintId ? familyRole(legacy.family, legacy.version) : "UNRESOLVED");
      const migrationKey = `${manifestHash}:${row.candidateId}:${sidewaysFingerprint?.id ?? mappedFingerprintId ?? row.queriedFingerprintId}:parameter-review`;
      if (insertPendingProposal(db, spanId, fingerprintId, role, HIT_TRAIN_ORIGIN, {
        migration_key: migrationKey,
        type: "parameter-review",
        legacy_queried_fingerprint_id: row.queriedFingerprintId,
        verdict: row.verdict,
        sideways_review: row.source.sideways_review ?? null,
      })) {
        report.pairwise.parameterReviewProposals += 1;
      }
    }
  }
}

function recallIdentity(auditHash: string, row: JsonRecord): string {
  return `recall-${hashJson({
    audit_hash: auditHash,
    faction_id: row.faction_id,
    ability_id: row.ability_id,
    source_hash: row.source_hash,
  }).slice(0, 24)}`;
}


function insertRecallProposalOrAnnotation(
  db: DatabaseSync,
  ability: CurrentAbility,
  row: JsonRecord,
  occurrence: JsonRecord,
  auditHash: string,
  batchId: string,
  sourceJudgmentInserted: boolean,
  report: ImportHitTrainReport,
): void {
  const span = parseSpan(occurrence.span, "recall occurrence span");
  const text = requireString(occurrence.text, "recall occurrence text");
  let exact: string;
  try {
    exact = exactSpan(ability.sourceText, span.start, span.end);
  } catch {
    report.conflicts.push({ identity: recallIdentity(auditHash, row), reason: "recall-occurrence-invalid-byte-boundary" });
    return;
  }
  if (exact !== text) {
    report.conflicts.push({ identity: recallIdentity(auditHash, row), reason: "recall-occurrence-text-mismatch" });
    return;
  }
  const containingFragment = ability.fragments.find((fragment) => span.start >= fragment.startByte && span.end <= fragment.endByte);
  if (!containingFragment) {
    report.conflicts.push({ identity: recallIdentity(auditHash, row), reason: "recall-occurrence-crosses-fragment" });
    return;
  }
  const spanId = spanForCurrentCandidate(db, ability, {
    id: recallIdentity(auditHash, row),
    split: "train",
    source: {
      factionId: requireString(row.faction_id, "recall row faction_id"),
      abilityId: requireString(row.ability_id, "recall row ability_id"),
      sourceHash: ability.sourceHash,
      fragment: containingFragment.fragment,
      start: span.start,
      end: span.end,
    },
  }, exact);

  const fingerprint = requireRecord(occurrence.fingerprint, "recall occurrence fingerprint");
  const family = requireString(fingerprint.family, "recall occurrence fingerprint.family");
  const parameters = requireRecord(fingerprint.parameters, "recall occurrence fingerprint.parameters");
  let fingerprintId: string | null = null;
  try {
    fingerprintId = validateFingerprint(db, family, parameters, 1, exact);
  } catch (error) {
    report.conflicts.push({ identity: recallIdentity(auditHash, row), reason: `recall-registry-validation:${error instanceof Error ? error.message : String(error)}` });
  }

  if (!fingerprintId) {
    const migrationKey = `${auditHash}:${recallIdentity(auditHash, row)}:${span.start}:${span.end}:review`;
    if (insertPendingProposal(db, spanId, null, "UNRESOLVED", RECALL_ORIGIN, {
      migration_key: migrationKey,
      type: "recall-family-review",
      family,
      parameters,
      audit_hash: auditHash,
    })) {
      report.recall.queuedForReview += 1;
    }
    return;
  }
  // A reimport may verify evidence again, but must not recreate a withdrawn Golden.
  if (!sourceJudgmentInserted) return;
  const annotation = insertActiveAnnotation(
    db,
    spanId,
    fingerprintId,
    RECALL_ORIGIN,
    optionalString(row.reviewer, "recall row reviewer"),
    batchId,
    optionalString(row.reviewed_at, "recall row reviewed_at"),
  );
  addBatchMember(db, batchId, "annotation", annotation.id);
  if (annotation.inserted) report.recall.promoted += 1;
}

function importRecallAudit(
  db: DatabaseSync,
  manifestHash: string,
  audit: JsonRecord,
  report: ImportHitTrainReport,
): void {
  if (requireString(audit.manifest_hash, "recall-audit.json.manifest_hash") !== manifestHash) {
    throw new Error("recall-audit.json manifest hash differs from candidates.json");
  }
  const auditHash = requireString(audit.audit_hash, "recall-audit.json.audit_hash");
  const rows = requireArray(audit.rows, "recall-audit.json.rows");
  const batchId = `round5b-recall:${auditHash}`;
  const firstReview = rows.length ? requireRecord(rows[0], "recall-audit.json.rows[0]") : null;
  ensureHistoricalBatch(db, batchId, firstReview ? optionalString(firstReview.reviewer, "recall row reviewer") : null, firstReview ? optionalString(firstReview.reviewed_at, "recall row reviewed_at") : null, RECALL_BATCH_OPERATION);

  for (const [index, value] of rows.entries()) {
    const row = requireRecord(value, `recall-audit.json.rows[${index}]`);
    const factionId = requireString(row.faction_id, `recall-audit.json.rows[${index}].faction_id`);
    const abilityId = requireString(row.ability_id, `recall-audit.json.rows[${index}].ability_id`);
    const sourceHash = requireString(row.source_hash, `recall-audit.json.rows[${index}].source_hash`);
    const sourceText = requireString(row.source_text, `recall-audit.json.rows[${index}].source_text`);
    if (hashJson({ text: sourceText }) !== sourceHash) throw new Error(`Recall audit row ${factionId}/${abilityId} has an invalid source hash`);
    const candidateId = recallIdentity(auditHash, row);
    const judgment = insertJudgment(
      db,
      candidateId,
      "round5b-recall-audit",
      "reviewed",
      auditHash,
      JSON.stringify(row),
      batchId,
    );
    addBatchMember(db, batchId, "judgment", judgment.id);
    report.recall.reviewed += 1;
    if (judgment.inserted) report.recall.imported += 1;
    else report.recall.existing += 1;

    const ability = findCurrentAbility(db, factionId, abilityId);
    if (!ability || ability.sourceHash !== sourceHash || ability.sourceText !== sourceText) {
      recordStale(report, "recall", candidateId, "source-hash-or-text-drift");
      continue;
    }
    for (const occurrence of requireArray(row.missed_occurrences, `recall-audit.json.rows[${index}].missed_occurrences`)) {
      insertRecallProposalOrAnnotation(
        db,
        ability,
        row,
        requireRecord(occurrence, "recall occurrence"),
        auditHash,
        batchId,
        judgment.inserted,
        report,
      );
    }
  }
}

/**
 * Imports the frozen Round 5B train review as immutable evidence. It deliberately
 * never reads validation or held-out labels, and it never promotes a related row.
 */
export function importHitTrain(db: DatabaseSync, root = DEFAULT_HIT_TRAIN_ROOT): ImportHitTrainReport {
  const manifest = parseJsonFile(join(root, "candidates.json"));
  const train = parseJsonFile(join(root, "review", "train-labels.json"));
  const recall = parseJsonFile(join(root, "review", "recall-audit.json"));
  const manifestHash = requireString(manifest.hash, "candidates.json.hash");
  const manifestRubric = requireString(manifest.rubric_version, "candidates.json.rubric_version");
  if (requireString(train.manifest_hash, "train-labels.json.manifest_hash") !== manifestHash) {
    throw new Error("train-labels.json manifest hash differs from candidates.json");
  }
  if (requireString(train.split, "train-labels.json.split") !== "train") throw new Error("train-labels.json is not the train split");

  const candidates = parseManifestCandidates(manifest.candidates);
  const manifestFingerprints = parseLegacyFingerprints(manifest.fingerprints, "candidates.json.fingerprints");
  const fingerprints = parseLegacyFingerprints(train.fingerprints, "train-labels.json.fingerprints");
  verifyTrainFingerprintDefinitions(fingerprints, manifestFingerprints);
  const rows = parseTrainRows(train.rows);
  const report: ImportHitTrainReport = {
    manifestHash,
    pairwise: { reviewed: 0, imported: 0, existing: 0, exactPromoted: 0, parameterReviewProposals: 0, stale: 0, unreviewed: 0 },
    recall: { reviewed: 0, imported: 0, existing: 0, promoted: 0, queuedForReview: 0, stale: 0 },
    conflicts: [],
    stale: [],
  };

  return withTransaction(db, () => {
    importPairwiseRows(db, manifestHash, manifestRubric, candidates, fingerprints, rows, report);
    importRecallAudit(db, manifestHash, recall, report);
    return report;
  });
}
