import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { prepareWrites } from "../mfm/apply.js";
import { hashJson } from "../canonical-hash.js";
import { sourceDigest } from "../source-digest.js";
import { compilationInputsHash, compiledIdentity, getCompiledEntry } from "./compiled.js";
import { canonicalDataRoot, semanticAuthoringDataRoot, schemaTreeHash, type Mechanics } from "./entries.js";
import { recordGateErrors } from "./gates.js";
import { bumpWorkbenchRevision, withTransaction } from "./db.js";
import { gameVersionForDataVersion } from "../mfm/dataslate.js";
import { fullyDescribed } from "./leaf-view.js";
import { PublicationError, projectRecords, record, stagedWrites, type PublicationDiff, type PublicationStamp } from "./publication-projection.js";
import { coreManifest, coreReplicaManifests, observeFile, type CoreManifest, type CoreProjection } from "./publish-core.js";
import {
  loadBatch, parseManifest, receiptFromBatch, sha256Bytes,
  type PublicationEntrySnapshot, type PublicationManifest, type PublicationReceipt, type PublicationReceiptData, type PublicationState,
} from "./publish-batch.js";
import { reconcilePublicationBatches } from "./publish-recovery.js";
import { loadSourceRecords, type SourceRecord } from "./source.js";

export type { PublicationReceipt } from "./publish-batch.js";
export { reconcilePublicationBatches } from "./publish-recovery.js";

type PublicationProjection = {
  dataRoot: string;
  file: string;
  relativePath: string;
  beforeHash: string;
  afterHash: string;
  afterText: string;
  entries: Array<Record<string, unknown>>;
  snapshots: PublicationEntrySnapshot[];
  diff: PublicationDiff[];
  core: CoreProjection | null;
};

export type PublicationPreview = {
  batch_id: string;
  preview_hash: string;
  faction_id: string;
  ability_ids: string[];
  before_hash: string;
  after_hash: string;
  diff: PublicationDiff[];
};

export type PublicationPage = {
  items: Array<Record<string, unknown>>;
  next_cursor: string | null;
  total: number;
};

/** The fresh source records of the selected abilities, and the dump `data_version` they were read from. */
function freshSourceMap(rows: EntryRow[]): { records: Map<string, SourceRecord>; dataVersion: number | undefined } {
  const selected = new Set(rows.map((row) => `${row.faction_id}\u0000${row.ability_id}`));
  const source = loadSourceRecords();
  const selectedConflicts = source.conflicts.filter((conflict) => selected.has(`${conflict.factionId}\u0000${conflict.abilityId}`));
  if (selectedConflicts.length > 0) {
    throw new PublicationError(409, `Publication source is ambiguous for ${selectedConflicts.map((item) => `${item.factionId}/${item.abilityId}`).join(", ")}.`);
  }
  const records = new Map(source.records
    .filter((item) => selected.has(`${item.factionId}\u0000${item.abilityId}`))
    .map((item) => [`${item.factionId}\u0000${item.abilityId}`, item]));
  return { records, dataVersion: source.dataVersion };
}

type EntryRow = {
  id: string;
  status: string;
  shape_signature: string;
  mechanics: Mechanics;
  core: { target_restrictions: Record<string, unknown> | Array<Record<string, unknown>> } | null;
  inputs_hash: string;
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_type: string | null;
  fragments_json: string;
  current: number;
};

function loadEntryRows(db: DatabaseSync, factionId: string, entryIds: string[]): EntryRow[] {
  if (!factionId.trim()) throw new PublicationError(422, "faction_id is required.");
  if (entryIds.length === 0) throw new PublicationError(422, "At least one compiled entry id is required.");
  if (new Set(entryIds).size !== entryIds.length || entryIds.some((id) => !id.trim())) {
    throw new PublicationError(422, "Compiled entry ids must be nonempty and unique.");
  }
  const ability = db.prepare(`
    SELECT faction_id, ability_id, source_hash, source_type, fragments_json, current FROM abilities WHERE id = ?
  `);
  const rows = entryIds.map((entryId): EntryRow => {
    const entry = getCompiledEntry(db, entryId);
    if (!entry) throw new PublicationError(404, `Unknown compiled entry ${entryId}.`);
    const source = ability.get(entry.ability_version_id) as Omit<EntryRow, keyof typeof entry> | undefined;
    if (!source) throw new PublicationError(409, `Compiled entry ${entryId} has no source version.`);
    if (source.faction_id !== factionId) throw new PublicationError(422, `Compiled entry ${entryId} belongs to faction ${source.faction_id}, not ${factionId}.`);
    return { ...entry, ...source };
  });
  const duplicateAbility = rows.find((row, index) => rows.findIndex((candidate) => candidate.ability_id === row.ability_id) !== index);
  if (duplicateAbility) throw new PublicationError(422, `Multiple compiled entries target ability ${duplicateAbility.ability_id}.`);
  return rows;
}

/** The hash a publication snapshot records for an entry's mechanics and core patch, and checks it against. */
function mechanicsHash(entry: { mechanics: Mechanics; core: EntryRow["core"] }): string {
  return hashJson(compiledIdentity(entry.mechanics, entry.core));
}

function sourceMatchHash(sourceType: string | null, fragments: unknown): string {
  return hashJson({ source_type: sourceType, fragments });
}

/**
 * Pin an approved entry to its current evidence: the source version must still be current and
 * byte-identical to its source prose, and the leaves it compiled from must be unchanged.
 */
function approvedEntrySnapshot(db: DatabaseSync, row: EntryRow, freshSource: SourceRecord): PublicationEntrySnapshot {
  if (row.status !== "approved" || row.current !== 1) {
    throw new PublicationError(409, `Compiled entry ${row.id} is not an approved entry for a current source version.`);
  }
  const storedMatchHash = sourceMatchHash(row.source_type, JSON.parse(row.fragments_json));
  if (freshSource.sourceHash !== row.source_hash || sourceMatchHash(freshSource.sourceType, freshSource.fragments) !== storedMatchHash) {
    throw new PublicationError(409, `Compiled entry ${row.id} source changed after approval.`);
  }
  if (compilationInputsHash(db, row.ability_version_id) !== row.inputs_hash) {
    throw new PublicationError(409, `Compiled entry ${row.id} leaves changed after approval; approve its shape again.`);
  }
  return {
    entry_id: row.id,
    ability_id: row.ability_id,
    ability_version_id: row.ability_version_id,
    shape_signature: row.shape_signature,
    inputs_hash: row.inputs_hash,
    mechanics_hash: mechanicsHash(row),
    source_hash: row.source_hash,
    source_digest: sourceDigest(freshSource.text),
    source_match_hash: storedMatchHash,
  };
}

function buildProjection(
  db: DatabaseSync,
  options: { faction_id: string; entry_ids: string[] },
): PublicationProjection {
  const dataRoot = canonicalDataRoot(semanticAuthoringDataRoot());
  const rows = loadEntryRows(db, options.faction_id, options.entry_ids);
  // The inputs hash pins leaves and reviewed relations; an undone connective can leave both intact
  // while the source is no longer fully described, which revokes what the approval judged.
  const described = fullyDescribed(db, rows.map((row) => row.ability_version_id));
  const incomplete = rows.find((row) => !described.has(row.ability_version_id));
  if (incomplete) throw new PublicationError(409, `Compiled entry ${incomplete.id} source is no longer fully described; review it again.`);
  const sources = freshSourceMap(rows);
  const snapshots = rows.map((row) => {
    const source = sources.records.get(`${row.faction_id}\u0000${row.ability_id}`);
    if (!source) throw new PublicationError(409, `Fresh source is missing for ${row.faction_id}/${row.ability_id}.`);
    return approvedEntrySnapshot(db, row, source);
  });
  // Prose read from a known dump stamps that dump's dataslate on the records digested from it.
  const stamp: PublicationStamp | undefined = sources.dataVersion === undefined ? undefined : {
    gameVersion: gameVersionForDataVersion(sources.dataVersion),
    digests: new Map([...sources.records.values()].map((source) => [source.abilityId, sourceDigest(source.text)])),
  };
  const projected = projectRecords(dataRoot, options.faction_id, rows.map((row, index) => ({ ...row, source_digest: snapshots[index]!.source_digest })), stamp);
  // An approval judged the record gates against the data root of its day; the entry written now is judged again.
  const published = new Set(snapshots.map((snapshot) => snapshot.ability_id));
  for (const entry of projected.entries) {
    if (typeof entry.ability_id !== "string" || !published.has(entry.ability_id)) continue;
    const errors = recordGateErrors(dataRoot, options.faction_id, entry.ability_id, entry);
    if (errors.length > 0) throw new PublicationError(422, `${options.faction_id}/${entry.ability_id} fails its record gates: ${errors.join("; ")}`);
  }
  return {
    core: projected.core,
    dataRoot,
    file: projected.file,
    relativePath: projected.relativePath,
    beforeHash: sha256Bytes(projected.beforeText),
    afterHash: sha256Bytes(projected.afterText),
    afterText: projected.afterText,
    entries: projected.entries,
    snapshots,
    diff: projected.diff,
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
    || hashJson(projection.snapshots) !== hashJson(manifest.entries)
    || hashJson(projection.diff) !== hashJson(manifest.diff)
    || hashJson(coreManifest(projection.core) ?? null) !== hashJson(manifest.core ?? null)
    || hashJson(coreReplicaManifests(projection.core)) !== hashJson(manifest.core_replicas ?? [])
  ) throw new PublicationError(409, "Publication preview is stale; prepare a new batch.");
}

/** Validate and persist a no-write publication preview for one faction file. */
export async function preparePublication(
  db: DatabaseSync,
  options: { faction_id: string; entry_ids: string[] },
): Promise<PublicationPreview> {
  reconcilePublicationBatches(db);
  const projection = buildProjection(db, options);
  const batchId = `pub_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const manifest: PublicationManifest = {
    schema_version: 2,
    batch_id: batchId,
    faction_id: options.faction_id,
    data_root: projection.dataRoot,
    destination: projection.file,
    relative_path: projection.relativePath,
    before_hash: projection.beforeHash,
    after_hash: projection.afterHash,
    after_text: projection.afterText,
    schema_hash: schemaTreeHash(),
    entries: projection.snapshots,
    diff: projection.diff,
    created_at: createdAt,
    ...(projection.core ? { core: coreManifest(projection.core) } : {}),
    ...(projection.core?.replicas.length ? { core_replicas: coreReplicaManifests(projection.core) } : {}),
  };
  const previewHash = hashJson(manifest);
  await prepareWrites(
    stagedWrites(projection, projection.afterText, projection.core?.afterText),
    { label: `semantic-authoring publication ${batchId}`, dataRoot: projection.dataRoot },
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
    ability_ids: projection.snapshots.map((snapshot) => snapshot.ability_id),
    before_hash: projection.beforeHash,
    after_hash: projection.afterHash,
    diff: projection.diff,
  };
}

/**
 * Validate what publishing these entries would write, exactly as `preparePublication` does,
 * without recording a batch: the projected dataset passes or the error lists every failure.
 */
export async function checkPublication(db: DatabaseSync, options: { faction_id: string; entry_ids: string[] }): Promise<{ faction_id: string; ability_ids: string[]; valid: true }> {
  const projection = buildProjection(db, options);
  await prepareWrites(
    stagedWrites(projection, projection.afterText, projection.core?.afterText),
    { label: `semantic-authoring publication check ${options.faction_id}`, dataRoot: projection.dataRoot },
  );
  return { faction_id: options.faction_id, ability_ids: projection.snapshots.map((snapshot) => snapshot.ability_id), valid: true };
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
    entry_ids: batch.manifest.entries.map((entry) => entry.entry_id),
  };
  let projection = buildProjection(db, publicationOptions);
  assertProjectionMatchesManifest(projection, batch.manifest);
  const prepared = await prepareWrites(
    stagedWrites(projection, batch.manifest.after_text, batch.manifest.core?.after_text, (batch.manifest.core_replicas ?? []).map((replica) => replica.after_text)),
    { label: `semantic-authoring publication ${options.batch_id}`, dataRoot: projection.dataRoot },
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
      const holds = (manifest: CoreManifest) => { const observed = observeFile(manifest.destination); return "hash" in observed && observed.hash === manifest.after_hash; };
      if (batch.manifest.core && !holds(batch.manifest.core)) {
        throw new PublicationError(409, "Core stratagems.json does not match the validated staged bytes after commit.");
      }
      if ((batch.manifest.core_replicas ?? []).some((replica) => !holds(replica))) {
        throw new PublicationError(409, "A replicated core stratagems.json does not match the validated staged bytes after commit.");
      }
      const receipt: PublicationReceiptData = {
        published_at: new Date().toISOString(),
        actual_after_hash: actualAfterHash,
        recovered: false,
        ability_ids: batch.manifest.entries.map((entry) => entry.ability_id),
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

/** A published batch is stale once any entry it published no longer matches its approval evidence. */
function evidenceStatus(db: DatabaseSync, manifest: PublicationManifest): "current" | "stale" {
  if (manifest.schema_hash !== schemaTreeHash()) return "stale";
  const ability = db.prepare("SELECT source_hash, source_type, fragments_json, current FROM abilities WHERE id = ?");
  for (const snapshot of manifest.entries) {
    const entry = getCompiledEntry(db, snapshot.entry_id);
    const source = entry ? ability.get(entry.ability_version_id) as { source_hash: string; source_type: string | null; fragments_json: string; current: number } | undefined : undefined;
    if (
      !entry || !source
      || entry.status !== "approved"
      || entry.inputs_hash !== snapshot.inputs_hash
      || mechanicsHash(entry) !== snapshot.mechanics_hash
      || compilationInputsHash(db, entry.ability_version_id) !== snapshot.inputs_hash
      || source.current !== 1
      || source.source_hash !== snapshot.source_hash
      || sourceMatchHash(source.source_type, JSON.parse(source.fragments_json)) !== snapshot.source_match_hash
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
      ability_ids: manifest.entries.map((entry) => entry.ability_id),
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
      for (const entry of manifest.entries) stalePublished.add(`${manifest.faction_id}/${entry.ability_id}`);
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
