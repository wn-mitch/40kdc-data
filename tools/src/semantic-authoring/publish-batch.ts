import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../canonical-hash.js";
import { abilityFilePath, canonicalDataRoot } from "./entries.js";
import { PublicationError, record, relativeAbilityPath, type PublicationDiff } from "./publication-projection.js";
import { coreStratagemFile, type CoreManifest } from "./publish-core.js";

/** A publication batch as stored: its manifest, how it is read back and checked, and its receipt. */

export type PublicationState = "prepared" | "publishing" | "published" | "failed";

/** What one approved compiled entry was when its publication was prepared. */
export type PublicationEntrySnapshot = {
  entry_id: string;
  ability_id: string;
  ability_version_id: number;
  shape_signature: string;
  inputs_hash: string;
  mechanics_hash: string;
  source_hash: string;
  source_digest: string;
  source_match_hash: string;
};

export type PublicationReceiptData = {
  published_at: string;
  actual_after_hash: string;
  recovered: boolean;
  ability_ids: string[];
};

export type PublicationFailureData = {
  failed_at: string;
  // PARTIAL_WRITE_OBSERVED: each file holds its before or its staged bytes, and not all the same (a commit stopped
  // between files). EXTERNAL_CHANGE_CONFLICT: some file holds bytes that are neither.
  reason_code: "NO_WRITE_OBSERVED" | "PARTIAL_WRITE_OBSERVED" | "EXTERNAL_CHANGE_CONFLICT";
  observed_hash: string;
};

export type PublicationManifest = {
  schema_version: 2;
  batch_id: string;
  faction_id: string;
  data_root: string;
  destination: string;
  relative_path: string;
  before_hash: string;
  after_hash: string;
  after_text: string;
  schema_hash: string;
  entries: PublicationEntrySnapshot[];
  diff: PublicationDiff[];
  created_at: string;
  /** The faction's core stratagems.json, when approved leaves set a stratagem's target. */
  core?: CoreManifest;
  /** Other factions' core stratagems.json holding a replicated copy of a changed stratagem. */
  core_replicas?: CoreManifest[];
  receipt?: PublicationReceiptData;
  failure?: PublicationFailureData;
  /** Why the last reconciliation could not observe the destinations; the batch stays publishing. */
  unobserved?: { observed_at: string; errors: string[] };
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

export function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseManifest(serialized: string): PublicationManifest {
  const value = record(JSON.parse(serialized), "Publication manifest is malformed.");
  if (
    value.schema_version !== 2
    || typeof value.batch_id !== "string"
    || typeof value.faction_id !== "string"
    || typeof value.data_root !== "string"
    || typeof value.destination !== "string"
    || typeof value.relative_path !== "string"
    || typeof value.before_hash !== "string"
    || typeof value.after_hash !== "string"
    || typeof value.after_text !== "string"
    || typeof value.schema_hash !== "string"
    || !Array.isArray(value.entries)
    || !Array.isArray(value.diff)
    || typeof value.created_at !== "string"
  ) throw new PublicationError(409, "Publication manifest is malformed.");
  if (sha256Bytes(value.after_text) !== value.after_hash) {
    throw new PublicationError(409, "Publication manifest staged bytes do not match their hash.");
  }
  if (value.core_replicas !== undefined && (!Array.isArray(value.core_replicas) || value.core === undefined)) {
    throw new PublicationError(409, "Publication manifest core replicas are malformed.");
  }
  for (const item of [...(value.core !== undefined ? [value.core] : []), ...((value.core_replicas as unknown[] | undefined) ?? [])]) {
    const core = record(item, "Publication manifest core file is malformed.");
    if (["destination", "relative_path", "before_hash", "after_hash", "after_text"].some((key) => typeof core[key] !== "string")) {
      throw new PublicationError(409, "Publication manifest core file is malformed.");
    }
    if (sha256Bytes(core.after_text as string) !== core.after_hash) throw new PublicationError(409, "Publication manifest core staged bytes do not match their hash.");
  }
  return value as PublicationManifest;
}

export function manifestFile(manifest: PublicationManifest): string {
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
    || (manifest.core !== undefined && manifest.core.destination !== coreStratagemFile(root, manifest.faction_id))
    || (manifest.core_replicas ?? []).some((replica) => !isReplicaDestination(root, manifest.faction_id, replica))
  ) throw new PublicationError(409, "Publication manifest destination no longer matches its pinned root and faction.");
  return expected;
}

/** A replica destination is another faction's core stratagems.json under the pinned root, named by its own relative path. */
export function isReplicaDestination(root: string, factionId: string, replica: CoreManifest): boolean {
  const match = /^core\/([a-z0-9][a-z0-9-]*[a-z0-9])\/stratagems\.json$/u.exec(replica.relative_path);
  return match !== null && match[1] !== factionId && replica.destination === coreStratagemFile(root, match[1]!);
}

export function loadBatch(db: DatabaseSync, batchId: string): { preview_hash: string; faction_id: string; state: PublicationState; manifest: PublicationManifest } {
  const row = db.prepare("SELECT preview_hash, faction_id, state, manifest_json FROM publication_batches WHERE id = ?")
    .get(batchId) as { preview_hash: string; faction_id: string; state: PublicationState; manifest_json: string } | undefined;
  if (!row) throw new PublicationError(404, `Unknown publication batch ${batchId}.`);
  const manifest = parseManifest(row.manifest_json);
  if (manifest.batch_id !== batchId || manifest.faction_id !== row.faction_id) throw new PublicationError(409, "Publication batch identity does not match its manifest.");
  const previewManifest = { ...manifest };
  delete previewManifest.receipt;
  delete previewManifest.failure;
  delete previewManifest.unobserved;
  if (hashJson(previewManifest) !== row.preview_hash) throw new PublicationError(409, "Publication manifest no longer matches its preview hash.");
  return { preview_hash: row.preview_hash, faction_id: row.faction_id, state: row.state, manifest };
}

export function receiptFromBatch(batchId: string, previewHash: string, factionId: string, manifest: PublicationManifest): PublicationReceipt {
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
