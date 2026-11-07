import type { DatabaseSync } from "node:sqlite";

import { bumpWorkbenchRevision, withTransaction } from "./db.js";
import { loadBatch, manifestFile, parseManifest, receiptFromBatch, type PublicationFailureData, type PublicationReceipt, type PublicationReceiptData } from "./publish-batch.js";
import { observeFile } from "./publish-core.js";

/** Recovery of a batch left publishing: the destination bytes decide whether it published, failed, or is unread. */

function finishPublishingBatch(db: DatabaseSync, batchId: string, observedHash: string, observedCore: string | null, observedReplicas: ReadonlyArray<string | null> = []): PublicationReceipt | null {
  const batch = loadBatch(db, batchId);
  if (batch.state === "published") return receiptFromBatch(batchId, batch.preview_hash, batch.faction_id, batch.manifest);
  if (batch.state !== "publishing") return null;
  const now = new Date().toISOString();
  // Every file is written in one commit: published only when each holds its staged bytes.
  const core = batch.manifest.core;
  const replicas = batch.manifest.core_replicas ?? [];
  // Each destination file against its before and staged bytes: the abilities file, then core, then each replica.
  const files = [
    { observed: observedHash, before: batch.manifest.before_hash, after: batch.manifest.after_hash },
    ...(core ? [{ observed: observedCore, before: core.before_hash, after: core.after_hash }] : []),
    ...replicas.map((replica, position) => ({ observed: observedReplicas[position], before: replica.before_hash, after: replica.after_hash })),
  ];
  const states = files.map((file) => file.observed === file.after ? "after" : file.observed === file.before ? "before" : "other");
  if (states.every((state) => state === "after")) {
    const receipt: PublicationReceiptData = {
      published_at: now,
      actual_after_hash: observedHash,
      recovered: true,
      ability_ids: batch.manifest.entries.map((entry) => entry.ability_id),
    };
    const manifest = { ...batch.manifest, receipt };
    const changed = db.prepare("UPDATE publication_batches SET state = 'published', manifest_json = ?, updated_at = ? WHERE id = ? AND state = 'publishing'")
      .run(JSON.stringify(manifest), now, batchId);
    if (changed.changes === 1) bumpWorkbenchRevision(db);
    return receiptFromBatch(batchId, batch.preview_hash, batch.faction_id, manifest);
  }
  const failure: PublicationFailureData = {
    failed_at: now,
    reason_code: states.every((state) => state === "before") ? "NO_WRITE_OBSERVED" : states.includes("other") ? "EXTERNAL_CHANGE_CONFLICT" : "PARTIAL_WRITE_OBSERVED",
    observed_hash: observedHash,
  };
  const changed = db.prepare("UPDATE publication_batches SET state = 'failed', manifest_json = ?, updated_at = ? WHERE id = ? AND state = 'publishing'")
    .run(JSON.stringify({ ...batch.manifest, failure }), now, batchId);
  if (changed.changes === 1) bumpWorkbenchRevision(db);
  return null;
}

/** Reconcile durable publishing markers against the only authoritative observation: destination bytes. */
export function reconcilePublicationBatches(db: DatabaseSync, batchId?: string): { recovered: PublicationReceipt[]; failed: string[]; unobserved: Array<{ batch_id: string; errors: string[] }> } {
  const rows = db.prepare(`
    SELECT id, manifest_json FROM publication_batches
    WHERE state = 'publishing' ${batchId === undefined ? "" : "AND id = ?"}
    ORDER BY created_at, id
  `).all(...(batchId === undefined ? [] : [batchId])) as Array<{ id: string; manifest_json: string }>;
  const recovered: PublicationReceipt[] = [];
  const failed: string[] = [];
  const unobserved: Array<{ batch_id: string; errors: string[] }> = [];
  for (const row of rows) {
    const manifest = parseManifest(row.manifest_json);
    let main: ReturnType<typeof observeFile>;
    try {
      main = observeFile(manifestFile(manifest));
    } catch (error) {
      main = { error: error instanceof Error ? error.message : String(error) };
    }
    const core = manifest.core ? observeFile(manifest.core.destination) : null;
    const replicas = (manifest.core_replicas ?? []).map((replica) => observeFile(replica.destination));
    const errors = [main, core, ...replicas].flatMap((observation) => (observation && "error" in observation ? [observation.error] : []));
    if (errors.length > 0) {
      // Unread destinations prove nothing either way: keep the marker and the reason, and retry later.
      withTransaction(db, () => db.prepare("UPDATE publication_batches SET manifest_json = json_set(manifest_json, '$.unobserved', json(?)), updated_at = ? WHERE id = ? AND state = 'publishing'")
        .run(JSON.stringify({ observed_at: new Date().toISOString(), errors }), new Date().toISOString(), row.id));
      unobserved.push({ batch_id: row.id, errors });
      continue;
    }
    const hashOf = (observation: ReturnType<typeof observeFile>) => (observation as { hash: string }).hash;
    const receipt = withTransaction(db, () => finishPublishingBatch(db, row.id, hashOf(main), core && hashOf(core), replicas.map(hashOf)));
    if (receipt) recovered.push(receipt);
    else failed.push(row.id);
  }
  return { recovered, failed, unobserved };
}
