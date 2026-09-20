import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { buildRepairedEntry, canReplaceAuthoredEffect } from "../author-batch.js";
import { prepareWrites } from "../mfm/apply.js";
import { hashJson } from "../round4/hash.js";
import { sourceDigest } from "../source-digest.js";
import { abilityFilePath, canonicalDataRoot, draftVerificationSnapshot, round5cDataRoot, schemaTreeHash, type DraftVerificationSnapshot } from "./assembly.js";
import { bumpWorkbenchRevision, withTransaction } from "./db.js";
import { loadSourceRecords, type SourceRecord } from "./source.js";

const OPTIONAL_MECHANICS_FIELDS = ["behavior", "trigger", "usage", "applies_to"] as const;
const DIFF_FIELDS = ["effect", "scope", ...OPTIONAL_MECHANICS_FIELDS, "source_digest"] as const;

type PublicationState = "prepared" | "publishing" | "published" | "failed";

type PublicationDraftSnapshot = {
  draft_id: string;
  ability_id: string;
  ability_version_id: number;
  composition_application_id: string;
  verifier_run_id: number;
  source_hash: string;
  source_digest: string;
  source_match_hash: string;
  stamp_id: string;
  stamp_revision: number;
  stamp_definition_hash: string;
  diagnostic_hash: string;
  verification: DraftVerificationSnapshot;
};

type PublicationDiff = {
  draft_id: string;
  ability_id: string;
  fields: Array<{ field: string; before: unknown; after: unknown }>;
};

type PublicationReceiptData = {
  published_at: string;
  actual_after_hash: string;
  recovered: boolean;
  ability_ids: string[];
};

type PublicationFailureData = {
  failed_at: string;
  reason_code: "NO_WRITE_OBSERVED" | "EXTERNAL_CHANGE_CONFLICT";
  observed_hash: string;
};

type PublicationManifest = {
  schema_version: 1;
  batch_id: string;
  faction_id: string;
  reauthor: boolean;
  data_root: string;
  destination: string;
  relative_path: string;
  before_hash: string;
  after_hash: string;
  after_text: string;
  schema_hash: string;
  drafts: PublicationDraftSnapshot[];
  diff: PublicationDiff[];
  created_at: string;
  receipt?: PublicationReceiptData;
  failure?: PublicationFailureData;
};

type DraftRow = {
  id: string;
  status: string;
  composition_application_id: string;
  mechanics_json: string | null;
  diagnostic_json: string;
  verifier_run_id: number | null;
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_type: string | null;
  fragments_json: string;
  current: number;
  application_status: string;
  stamp_id: string;
  stamp_revision: number;
  stamp_status: string;
  stamp_definition_hash: string;
};

type PublicationProjection = {
  dataRoot: string;
  file: string;
  relativePath: string;
  beforeHash: string;
  afterHash: string;
  afterText: string;
  entries: Array<Record<string, unknown>>;
  drafts: PublicationDraftSnapshot[];
  diff: PublicationDiff[];
};

export type PublicationPreview = {
  batch_id: string;
  preview_hash: string;
  faction_id: string;
  reauthor: boolean;
  ability_ids: string[];
  before_hash: string;
  after_hash: string;
  diff: PublicationDiff[];
};

export type PublicationReceipt = {
  batch_id: string;
  preview_hash: string;
  faction_id: string;
  state: "published";
  published_at: string;
  actual_after_hash: string;
  recovered: boolean;
  ability_ids: string[];
};

export type PublicationPage = {
  items: Array<Record<string, unknown>>;
  next_cursor: string | null;
  total: number;
};

export class PublicationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PublicationError";
    this.status = status;
  }
}

function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializedEntries(entries: Array<Record<string, unknown>>): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicationError(409, message);
  return value as Record<string, unknown>;
}

function parseManifest(serialized: string): PublicationManifest {
  const value = record(JSON.parse(serialized), "Publication manifest is malformed.");
  if (
    value.schema_version !== 1
    || typeof value.batch_id !== "string"
    || typeof value.faction_id !== "string"
    || typeof value.reauthor !== "boolean"
    || typeof value.data_root !== "string"
    || typeof value.destination !== "string"
    || typeof value.relative_path !== "string"
    || typeof value.before_hash !== "string"
    || typeof value.after_hash !== "string"
    || typeof value.after_text !== "string"
    || typeof value.schema_hash !== "string"
    || !Array.isArray(value.drafts)
    || !Array.isArray(value.diff)
    || typeof value.created_at !== "string"
  ) throw new PublicationError(409, "Publication manifest is malformed.");
  if (sha256Bytes(value.after_text) !== value.after_hash) {
    throw new PublicationError(409, "Publication manifest staged bytes do not match their hash.");
  }
  return value as PublicationManifest;
}

function relativeAbilityPath(dataRoot: string, file: string): string {
  const path = relative(dataRoot, file).split(sep).join("/");
  if (!path || path.startsWith("../") || path === "..") throw new PublicationError(422, "Publication destination escapes the configured data root.");
  return path;
}

function manifestFile(manifest: PublicationManifest): string {
  let root: string;
  try {
    root = canonicalDataRoot(manifest.data_root);
  } catch (error) {
    throw new PublicationError(409, `Publication root is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (root !== manifest.data_root) throw new PublicationError(409, "Publication manifest data root is not canonical.");
  const expected = abilityFilePath(root, manifest.faction_id);
  if (
    manifest.destination !== expected
    || relativeAbilityPath(root, expected) !== manifest.relative_path
  ) throw new PublicationError(409, "Publication manifest destination no longer matches its pinned root and faction.");
  return expected;
}

function freshSourceMap(draftRows: DraftRow[]): Map<string, SourceRecord> {
  const selected = new Set(draftRows.map((row) => `${row.faction_id}\u0000${row.ability_id}`));
  const source = loadSourceRecords(process.env.RAW_TEXT_STORE);
  const selectedConflicts = source.conflicts.filter((conflict) => selected.has(`${conflict.factionId}\u0000${conflict.abilityId}`));
  if (selectedConflicts.length > 0) {
    throw new PublicationError(409, `Publication source is ambiguous for ${selectedConflicts.map((item) => `${item.factionId}/${item.abilityId}`).join(", ")}.`);
  }
  return new Map(source.records
    .filter((item) => selected.has(`${item.factionId}\u0000${item.abilityId}`))
    .map((item) => [`${item.factionId}\u0000${item.abilityId}`, item]));
}

function loadDraftRows(db: DatabaseSync, factionId: string, draftIds: string[]): DraftRow[] {
  if (!factionId.trim()) throw new PublicationError(422, "faction_id is required.");
  if (draftIds.length === 0) throw new PublicationError(422, "At least one draft id is required.");
  if (new Set(draftIds).size !== draftIds.length || draftIds.some((id) => !id.trim())) {
    throw new PublicationError(422, "Draft ids must be nonempty and unique.");
  }
  const select = db.prepare(`
    SELECT assembly_drafts.id, assembly_drafts.status, assembly_drafts.composition_application_id,
      assembly_drafts.mechanics_json, assembly_drafts.diagnostic_json, assembly_drafts.verifier_run_id,
      abilities.id AS ability_version_id, abilities.faction_id, abilities.ability_id,
      abilities.source_hash, abilities.source_type, abilities.fragments_json,
      abilities.current, stamp_applications.status AS application_status,
      stamp_applications.stamp_id, stamp_applications.stamp_revision,
      stamps.status AS stamp_status, stamps.definition_hash AS stamp_definition_hash
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE assembly_drafts.id = ?
  `);
  const rows = draftIds.map((draftId) => {
    const row = select.get(draftId) as DraftRow | undefined;
    if (!row) throw new PublicationError(404, `Unknown draft ${draftId}.`);
    if (row.faction_id !== factionId) throw new PublicationError(422, `Draft ${draftId} belongs to faction ${row.faction_id}, not ${factionId}.`);
    return row;
  });
  const duplicateAbility = rows.find((row, index) => rows.findIndex((candidate) => candidate.ability_id === row.ability_id) !== index);
  if (duplicateAbility) throw new PublicationError(422, `Multiple drafts target ability ${duplicateAbility.ability_id}.`);
  return rows;
}

function assertVerifierRunCurrent(
  db: DatabaseSync,
  row: DraftRow,
  verification: DraftVerificationSnapshot,
  diagnosticVerdict: Record<string, unknown>,
): void {
  const run = db.prepare("SELECT status, output_json FROM model_runs WHERE id = ?").get(row.verifier_run_id) as
    | { status: string; output_json: string | null }
    | undefined;
  if (!run || run.status !== "completed" || run.output_json === null) {
    throw new PublicationError(409, `Draft ${row.id} verifier run is no longer complete.`);
  }
  const output = record(JSON.parse(run.output_json), `Draft ${row.id} verifier output is malformed.`);
  if (!Array.isArray(output.items)) throw new PublicationError(409, `Draft ${row.id} verifier output is malformed.`);
  const matching = output.items.filter((item) =>
    Boolean(item && typeof item === "object" && !Array.isArray(item) && item.item_id === row.id));
  if (matching.length !== 1) throw new PublicationError(409, `Draft ${row.id} verifier output is stale.`);
  const item = matching[0] as Record<string, unknown>;
  const result = record(item.result, `Draft ${row.id} verifier output is malformed.`);
  const currentVerdict = { evidence_hash: item.evidence_hash, ...result };
  if (
    item.evidence_hash !== verification.evidence_hash
    || result.faithful !== true
    || result.severity !== "ok"
    || hashJson(currentVerdict) !== hashJson(diagnosticVerdict)
  ) throw new PublicationError(409, `Draft ${row.id} verifier output is stale.`);
}

function acceptedDraftSnapshot(db: DatabaseSync, row: DraftRow, freshSource: SourceRecord): PublicationDraftSnapshot {
  if (
    row.status !== "accepted"
    || row.current !== 1
    || row.application_status !== "active"
    || row.stamp_status !== "approved"
    || row.mechanics_json === null
    || row.verifier_run_id === null
  ) throw new PublicationError(409, `Draft ${row.id} is not an accepted current draft with active authority.`);
  const storedMatchHash = hashJson({
    source_type: row.source_type,
    fragments: JSON.parse(row.fragments_json),
  });
  const freshMatchHash = hashJson({
    source_type: freshSource.sourceType,
    fragments: freshSource.fragments,
  });
  if (freshSource.sourceHash !== row.source_hash || freshMatchHash !== storedMatchHash) {
    throw new PublicationError(409, `Draft ${row.id} source matching inputs changed after acceptance.`);
  }
  let verification: DraftVerificationSnapshot;
  try {
    verification = draftVerificationSnapshot(db, row.id);
  } catch (error) {
    throw new PublicationError(409, error instanceof Error ? error.message : String(error));
  }
  const diagnostic = record(JSON.parse(row.diagnostic_json), `Draft ${row.id} verifier receipt is malformed.`);
  const verdict = record(diagnostic.verdict, `Draft ${row.id} verifier receipt is malformed.`);
  if (diagnostic.evidence_hash !== verification.evidence_hash || verdict.faithful !== true || verdict.severity !== "ok") {
    throw new PublicationError(409, `Draft ${row.id} no longer has a current faithful verifier receipt.`);
  }
  assertVerifierRunCurrent(db, row, verification, verdict);
  return {
    draft_id: row.id,
    ability_id: row.ability_id,
    ability_version_id: row.ability_version_id,
    composition_application_id: row.composition_application_id,
    verifier_run_id: row.verifier_run_id,
    source_hash: row.source_hash,
    source_match_hash: storedMatchHash,
    source_digest: sourceDigest(freshSource.text),
    stamp_id: row.stamp_id,
    stamp_revision: row.stamp_revision,
    stamp_definition_hash: row.stamp_definition_hash,
    diagnostic_hash: hashJson(diagnostic),
    verification,
  };
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Array<{ field: string; before: unknown; after: unknown }> {
  return DIFF_FIELDS.flatMap((field) => hashJson(before[field] ?? null) === hashJson(after[field] ?? null)
    ? []
    : [{ field, before: before[field] ?? null, after: after[field] ?? null }]);
}

function publishedEntry(
  current: Record<string, unknown>,
  mechanics: Record<string, unknown>,
  digest: string,
): Record<string, unknown> {
  const effect = record(mechanics.effect, "Accepted draft effect is malformed.");
  const scope = record(mechanics.scope, "Accepted draft scope is malformed.");
  const preservedNotes = Object.hasOwn(current, "community_notes") ? current.community_notes : undefined;
  const entry = buildRepairedEntry(
    current,
    effect,
    scope,
    typeof mechanics.behavior === "string" ? mechanics.behavior : undefined,
    {
      trigger: Object.hasOwn(mechanics, "trigger") ? mechanics.trigger : null,
      usage: Object.hasOwn(mechanics, "usage") ? mechanics.usage : null,
      applies_to: Object.hasOwn(mechanics, "applies_to") ? mechanics.applies_to : null,
    },
  ) as Record<string, unknown>;
  if (preservedNotes === undefined) delete entry.community_notes;
  else entry.community_notes = preservedNotes;
  if (typeof mechanics.behavior === "string") entry.behavior = mechanics.behavior;
  else delete entry.behavior;
  entry.source_digest = digest;
  return entry;
}

function buildProjection(
  db: DatabaseSync,
  options: { faction_id: string; draft_ids: string[]; reauthor: boolean },
): PublicationProjection {
  const dataRoot = canonicalDataRoot(round5cDataRoot());
  const rows = loadDraftRows(db, options.faction_id, options.draft_ids);
  const sources = freshSourceMap(rows);
  const file = abilityFilePath(dataRoot, options.faction_id);
  const beforeText = readFileSync(file, "utf8");
  const parsed: unknown = JSON.parse(beforeText);
  if (!Array.isArray(parsed)) throw new PublicationError(409, `${options.faction_id}/abilities.json is not an array.`);
  const entries = parsed.map((value, index) => record(value, `Ability entry ${index} is malformed.`));
  const drafts: PublicationDraftSnapshot[] = [];
  const diff: PublicationDiff[] = [];

  for (const row of rows) {
    const source = sources.get(`${row.faction_id}\u0000${row.ability_id}`);
    if (!source) throw new PublicationError(409, `Fresh source is missing for ${row.faction_id}/${row.ability_id}.`);
    const snapshot = acceptedDraftSnapshot(db, row, source);
    const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.ability_id === row.ability_id);
    if (matches.length !== 1) {
      throw new PublicationError(409, matches.length === 0
        ? `Ability ${row.faction_id}/${row.ability_id} is missing from the destination.`
        : `Ability ${row.faction_id}/${row.ability_id} is ambiguous in the destination.`);
    }
    const { entry: current, index } = matches[0]!;
    if (!canReplaceAuthoredEffect(current.effect, options.reauthor)) {
      throw new PublicationError(422, `Ability ${row.faction_id}/${row.ability_id} already has an authored effect; rerun preparation with --reauthor to replace it.`);
    }
    const mechanics = record(JSON.parse(row.mechanics_json!), `Draft ${row.id} mechanics are malformed.`);
    const proposed = publishedEntry(current, mechanics, snapshot.source_digest);
    entries[index] = proposed;
    drafts.push(snapshot);
    diff.push({ draft_id: row.id, ability_id: row.ability_id, fields: changedFields(current, proposed) });
  }

  const afterText = serializedEntries(entries);
  return {
    dataRoot,
    file,
    relativePath: relativeAbilityPath(dataRoot, file),
    beforeHash: sha256Bytes(beforeText),
    afterHash: sha256Bytes(afterText),
    afterText,
    entries,
    drafts,
    diff,
  };
}

function assertProjectionMatchesManifest(projection: PublicationProjection, manifest: PublicationManifest): void {
  if (
    projection.dataRoot !== manifest.data_root
    || projection.file !== manifest.destination
    || projection.relativePath !== manifest.relative_path
    || projection.beforeHash !== manifest.before_hash
    || projection.afterHash !== manifest.after_hash
    || projection.afterText !== manifest.after_text
    || schemaTreeHash() !== manifest.schema_hash
    || hashJson(projection.drafts) !== hashJson(manifest.drafts)
    || hashJson(projection.diff) !== hashJson(manifest.diff)
  ) throw new PublicationError(409, "Publication preview is stale; prepare a new batch.");
}

function loadBatch(db: DatabaseSync, batchId: string): { preview_hash: string; faction_id: string; state: PublicationState; manifest: PublicationManifest } {
  const row = db.prepare("SELECT preview_hash, faction_id, state, manifest_json FROM publication_batches WHERE id = ?")
    .get(batchId) as { preview_hash: string; faction_id: string; state: PublicationState; manifest_json: string } | undefined;
  if (!row) throw new PublicationError(404, `Unknown publication batch ${batchId}.`);
  const manifest = parseManifest(row.manifest_json);
  if (manifest.batch_id !== batchId || manifest.faction_id !== row.faction_id) throw new PublicationError(409, "Publication batch identity does not match its manifest.");
  const previewManifest = { ...manifest };
  delete previewManifest.receipt;
  delete previewManifest.failure;
  if (hashJson(previewManifest) !== row.preview_hash) throw new PublicationError(409, "Publication manifest no longer matches its preview hash.");
  return { preview_hash: row.preview_hash, faction_id: row.faction_id, state: row.state, manifest };
}

function receiptFromBatch(batchId: string, previewHash: string, factionId: string, manifest: PublicationManifest): PublicationReceipt {
  if (!manifest.receipt || manifest.receipt.actual_after_hash !== manifest.after_hash) {
    throw new PublicationError(409, "Published batch is missing its observed receipt.");
  }
  return {
    batch_id: batchId,
    preview_hash: previewHash,
    faction_id: factionId,
    state: "published",
    published_at: manifest.receipt.published_at,
    actual_after_hash: manifest.receipt.actual_after_hash,
    recovered: manifest.receipt.recovered,
    ability_ids: manifest.receipt.ability_ids,
  };
}

function finishPublishingBatch(db: DatabaseSync, batchId: string, observedHash: string): PublicationReceipt | null {
  const batch = loadBatch(db, batchId);
  if (batch.state === "published") return receiptFromBatch(batchId, batch.preview_hash, batch.faction_id, batch.manifest);
  if (batch.state !== "publishing") return null;
  const now = new Date().toISOString();
  if (observedHash === batch.manifest.after_hash) {
    const receipt: PublicationReceiptData = {
      published_at: now,
      actual_after_hash: observedHash,
      recovered: true,
      ability_ids: batch.manifest.drafts.map((draft) => draft.ability_id),
    };
    const manifest = { ...batch.manifest, receipt };
    const changed = db.prepare("UPDATE publication_batches SET state = 'published', manifest_json = ?, updated_at = ? WHERE id = ? AND state = 'publishing'")
      .run(JSON.stringify(manifest), now, batchId);
    if (changed.changes === 1) bumpWorkbenchRevision(db);
    return receiptFromBatch(batchId, batch.preview_hash, batch.faction_id, manifest);
  }
  const failure: PublicationFailureData = {
    failed_at: now,
    reason_code: observedHash === batch.manifest.before_hash ? "NO_WRITE_OBSERVED" : "EXTERNAL_CHANGE_CONFLICT",
    observed_hash: observedHash,
  };
  const changed = db.prepare("UPDATE publication_batches SET state = 'failed', manifest_json = ?, updated_at = ? WHERE id = ? AND state = 'publishing'")
    .run(JSON.stringify({ ...batch.manifest, failure }), now, batchId);
  if (changed.changes === 1) bumpWorkbenchRevision(db);
  return null;
}

/** Reconcile durable publishing markers against the only authoritative observation: destination bytes. */
export function reconcilePublicationBatches(db: DatabaseSync, batchId?: string): { recovered: PublicationReceipt[]; failed: string[] } {
  const rows = db.prepare(`
    SELECT id, manifest_json FROM publication_batches
    WHERE state = 'publishing' ${batchId === undefined ? "" : "AND id = ?"}
    ORDER BY created_at, id
  `).all(...(batchId === undefined ? [] : [batchId])) as Array<{ id: string; manifest_json: string }>;
  const recovered: PublicationReceipt[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    const manifest = parseManifest(row.manifest_json);
    let observedHash: string;
    try {
      const file = manifestFile(manifest);
      observedHash = sha256Bytes(readFileSync(file));
    } catch (error) {
      observedHash = hashJson({
        destination_unavailable: error instanceof Error ? error.message : String(error),
      });
    }
    const receipt = withTransaction(db, () => finishPublishingBatch(db, row.id, observedHash));
    if (receipt) recovered.push(receipt);
    else failed.push(row.id);
  }
  return { recovered, failed };
}

/** Validate and persist a no-write publication preview for one faction file. */
export async function preparePublication(
  db: DatabaseSync,
  options: { faction_id: string; draft_ids: string[]; reauthor: boolean },
): Promise<PublicationPreview> {
  reconcilePublicationBatches(db);
  const projection = buildProjection(db, options);
  const batchId = `pub_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const manifest: PublicationManifest = {
    schema_version: 1,
    batch_id: batchId,
    faction_id: options.faction_id,
    reauthor: options.reauthor,
    data_root: projection.dataRoot,
    destination: projection.file,
    relative_path: projection.relativePath,
    before_hash: projection.beforeHash,
    after_hash: projection.afterHash,
    after_text: projection.afterText,
    schema_hash: schemaTreeHash(),
    drafts: projection.drafts,
    diff: projection.diff,
    created_at: createdAt,
  };
  const previewHash = hashJson(manifest);
  await prepareWrites(
    [{ path: projection.file, value: projection.entries, text: projection.afterText }],
    { label: `round5c publication ${batchId}`, dataRoot: projection.dataRoot },
  );
  withTransaction(db, () => {
    const current = buildProjection(db, options);
    assertProjectionMatchesManifest(current, manifest);
    db.prepare(`
      INSERT INTO publication_batches (id, preview_hash, faction_id, state, manifest_json, created_at, updated_at)
      VALUES (?, ?, ?, 'prepared', ?, ?, ?)
    `).run(batchId, previewHash, options.faction_id, JSON.stringify(manifest), createdAt, createdAt);
    bumpWorkbenchRevision(db);
  });
  return {
    batch_id: batchId,
    preview_hash: previewHash,
    faction_id: options.faction_id,
    reauthor: options.reauthor,
    ability_ids: projection.drafts.map((draft) => draft.ability_id),
    before_hash: projection.beforeHash,
    after_hash: projection.afterHash,
    diff: projection.diff,
  };
}

/** Explicitly commit one previously prepared, source-checked publication batch. */
export async function publishPublication(
  db: DatabaseSync,
  options: { batch_id: string; preview_hash: string },
): Promise<PublicationReceipt> {
  reconcilePublicationBatches(db, options.batch_id);
  let batch = loadBatch(db, options.batch_id);
  if (batch.preview_hash !== options.preview_hash) throw new PublicationError(409, "Publication preview hash does not match the prepared batch.");
  if (batch.state === "published") return receiptFromBatch(options.batch_id, batch.preview_hash, batch.faction_id, batch.manifest);
  if (batch.state !== "prepared") throw new PublicationError(409, `Publication batch ${options.batch_id} is ${batch.state}; prepare a new batch.`);

  const publicationOptions = {
    faction_id: batch.faction_id,
    draft_ids: batch.manifest.drafts.map((draft) => draft.draft_id),
    reauthor: batch.manifest.reauthor,
  };
  let projection = buildProjection(db, publicationOptions);
  assertProjectionMatchesManifest(projection, batch.manifest);
  const prepared = await prepareWrites(
    [{ path: projection.file, value: projection.entries, text: batch.manifest.after_text }],
    { label: `round5c publication ${options.batch_id}`, dataRoot: projection.dataRoot },
  );

  withTransaction(db, () => {
    batch = loadBatch(db, options.batch_id);
    if (batch.state !== "prepared" || batch.preview_hash !== options.preview_hash) throw new PublicationError(409, "Publication batch changed before commit.");
    projection = buildProjection(db, publicationOptions);
    assertProjectionMatchesManifest(projection, batch.manifest);
    const changed = db.prepare("UPDATE publication_batches SET state = 'publishing', updated_at = ? WHERE id = ? AND state = 'prepared'")
      .run(new Date().toISOString(), options.batch_id);
    if (changed.changes !== 1) throw new PublicationError(409, "Publication batch changed before its publishing marker was recorded.");
  });

  try {
    return withTransaction(db, () => {
      batch = loadBatch(db, options.batch_id);
      if (batch.state !== "publishing") throw new PublicationError(409, "Publication batch is no longer publishing.");
      projection = buildProjection(db, publicationOptions);
      assertProjectionMatchesManifest(projection, batch.manifest);
      prepared.commit();
      const actualAfterHash = sha256Bytes(readFileSync(projection.file));
      if (actualAfterHash !== batch.manifest.after_hash) throw new PublicationError(409, "Publication destination does not match the validated staged bytes after commit.");
      const receipt: PublicationReceiptData = {
        published_at: new Date().toISOString(),
        actual_after_hash: actualAfterHash,
        recovered: false,
        ability_ids: batch.manifest.drafts.map((draft) => draft.ability_id),
      };
      const manifest = { ...batch.manifest, receipt };
      const updated = db.prepare("UPDATE publication_batches SET state = 'published', manifest_json = ?, updated_at = ? WHERE id = ? AND state = 'publishing'")
        .run(JSON.stringify(manifest), receipt.published_at, options.batch_id);
      if (updated.changes !== 1) throw new PublicationError(409, "Publication receipt could not be recorded.");
      bumpWorkbenchRevision(db);
      return receiptFromBatch(options.batch_id, options.preview_hash, batch.faction_id, manifest);
    });
  } catch (error) {
    const reconciliation = reconcilePublicationBatches(db, options.batch_id);
    const recovered = reconciliation.recovered.find((receipt) => receipt.batch_id === options.batch_id);
    if (recovered) return recovered;
    throw error;
  }
}

function evidenceStatus(db: DatabaseSync, manifest: PublicationManifest): "current" | "stale" {
  if (manifest.schema_hash !== schemaTreeHash()) return "stale";
  const select = db.prepare(`
    SELECT assembly_drafts.status, assembly_drafts.verifier_run_id, assembly_drafts.diagnostic_json,
      stamp_applications.id AS application_id, stamp_applications.status AS application_status,
      stamps.status AS stamp_status, stamps.definition_hash, abilities.id AS ability_version_id,
      abilities.source_hash, abilities.source_type, abilities.fragments_json, abilities.current
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE assembly_drafts.id = ?
  `);
  for (const snapshot of manifest.drafts) {
    const row = select.get(snapshot.draft_id) as {
      status: string;
      verifier_run_id: number | null;
      diagnostic_json: string;
      application_id: string;
      application_status: string;
      stamp_status: string;
      definition_hash: string;
      ability_version_id: number;
      source_hash: string;
      source_type: string | null;
      fragments_json: string;
      current: number;
    } | undefined;
    if (
      !row
      || row.status !== "accepted"
      || row.verifier_run_id !== snapshot.verifier_run_id
      || hashJson(JSON.parse(row.diagnostic_json)) !== snapshot.diagnostic_hash
      || row.application_id !== snapshot.composition_application_id
      || row.application_status !== "active"
      || row.stamp_status !== "approved"
      || row.definition_hash !== snapshot.stamp_definition_hash
      || row.ability_version_id !== snapshot.ability_version_id
      || row.source_hash !== snapshot.source_hash
      || hashJson({ source_type: row.source_type, fragments: JSON.parse(row.fragments_json) }) !== snapshot.source_match_hash
      || row.current !== 1
    ) return "stale";
  }
  return "current";
}

/** Return bounded receipt summaries; this read never reconciles or mutates publication state. */
export function listPublications(db: DatabaseSync, options: { cursor?: string } = {}): PublicationPage {
  let offset = 0;
  if (options.cursor) {
    const decoded = record(JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")), "Publication cursor is malformed.");
    if (!Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0) throw new PublicationError(422, "Publication cursor is malformed.");
    offset = Number(decoded.offset);
  }
  const rows = db.prepare(`
    SELECT id, preview_hash, faction_id, state, manifest_json, created_at, updated_at
    FROM publication_batches ORDER BY created_at DESC, id DESC
  `).all() as Array<{ id: string; preview_hash: string; faction_id: string; state: PublicationState; manifest_json: string; created_at: string; updated_at: string }>;
  const items = rows.slice(offset, offset + 20).map((row) => {
    const manifest = parseManifest(row.manifest_json);
    return {
      batch_id: row.id,
      preview_hash: row.preview_hash,
      faction_id: row.faction_id,
      state: row.state,
      reauthor: manifest.reauthor,
      ability_ids: manifest.drafts.map((draft) => draft.ability_id),
      before_hash: manifest.before_hash,
      after_hash: manifest.after_hash,
      receipt: manifest.receipt ?? null,
      failure: manifest.failure ?? null,
      evidence_status: row.state === "published" ? evidenceStatus(db, manifest) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
  return {
    items,
    next_cursor: offset + 20 < rows.length ? Buffer.from(JSON.stringify({ offset: offset + 20 }), "utf8").toString("base64url") : null,
    total: rows.length,
  };
}

export function getPublicationReport(db: DatabaseSync): Record<string, unknown> {
  const rows = db.prepare("SELECT state, manifest_json FROM publication_batches ORDER BY created_at, id")
    .all() as Array<{ state: PublicationState; manifest_json: string }>;
  const states: Record<PublicationState, number> = { prepared: 0, publishing: 0, published: 0, failed: 0 };
  const stalePublished = new Set<string>();
  for (const row of rows) {
    states[row.state] += 1;
    if (row.state !== "published") continue;
    const manifest = parseManifest(row.manifest_json);
    if (evidenceStatus(db, manifest) === "stale") {
      for (const draft of manifest.drafts) stalePublished.add(`${manifest.faction_id}/${draft.ability_id}`);
    }
  }
  const recent = listPublications(db);
  return {
    states,
    stale_published_abilities: [...stalePublished].sort(),
    recent_batches: recent.items,
    total_batches: recent.total,
  };
}
