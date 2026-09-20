import type { DatabaseSync } from "node:sqlite";

import { withTransaction } from "./db.js";
import { currentReadiness } from "./readiness.js";
import { getAbility, reviewAbility, WorkbenchError } from "./review.js";

/**
 * The composition queue: sources whose every byte is reviewed. `ready` still need the explicit
 * whole-context check; `queued` are checked and have an open composition gap, which the
 * reviewer fires in blocks. A gap already inside a pending work run is reported as in flight.
 */

const LIST_LIMIT = 200;
/** A block larger than this is split into several prepared packets by the caller. */
export const MAX_BLOCK = 60;

export type ReadyItem = {
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  name: string | null;
  source_hash: string;
  source_text: string;
  review_evidence_hash: string;
};

export type QueuedItem = ReadyItem & { escalation_id: string; in_flight_run_id: number | null };

export type CompositionQueue = { ready: ReadyItem[]; queued: QueuedItem[]; ready_total: number; queued_total: number };

function inFlight(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare(`
    SELECT model_runs.id, json_extract(item.value, '$.item_id') AS item_id
    FROM model_runs, json_each(model_runs.config_json, '$.items') AS item
    WHERE model_runs.status = 'pending'
      AND json_extract(model_runs.config_json, '$.protocol') = 'round5c-work/v1'
      AND json_extract(model_runs.config_json, '$.purpose') = 'propose-rule'
  `).all() as Array<{ id: number; item_id: string }>;
  return new Map(rows.map((row) => [row.item_id, row.id]));
}

export function getCompositionQueue(db: DatabaseSync, options: { factionId?: string } = {}): CompositionQueue {
  const factionId = options.factionId?.trim() || null;
  const readiness = currentReadiness(db);
  const rows = db.prepare(`
    SELECT id, faction_id, ability_id FROM abilities
    WHERE current = 1 AND (? IS NULL OR faction_id = ?) ORDER BY faction_id, ability_id, id
  `).all(factionId, factionId) as Array<{ id: number; faction_id: string; ability_id: string }>;
  const readyIds = rows.filter((row) => readiness.get(row.id)?.ready && !readiness.get(row.id)?.whole_context_checked).map((row) => row.id);
  const eligibleIds = rows.filter((row) => readiness.get(row.id)?.composition_eligible).map((row) => row.id);
  const flights = inFlight(db);
  const item = (id: number): ReadyItem => {
    const view = getAbility(db, id);
    return {
      ability_version_id: view.id, faction_id: view.faction_id, ability_id: view.ability_id, name: view.name,
      source_hash: view.source_hash, source_text: view.source_text, review_evidence_hash: view.review_evidence_hash,
    };
  };
  // Only sources with an open composition gap are queued; a checked source whose gap was
  // closed by an approved rule has moved on to Drafts.
  const queued: QueuedItem[] = [];
  let queuedTotal = 0;
  for (const id of eligibleIds) {
    const view = getAbility(db, id);
    if (!view.composition_escalation_id) continue;
    queuedTotal += 1;
    if (queued.length < LIST_LIMIT) queued.push({ ...item(id), escalation_id: view.composition_escalation_id, in_flight_run_id: flights.get(view.composition_escalation_id) ?? null });
  }
  return {
    ready: readyIds.slice(0, LIST_LIMIT).map(item),
    queued,
    ready_total: readyIds.length,
    queued_total: queuedTotal,
  };
}

/**
 * Record the whole-context check for several fully reviewed sources at once, atomically. Each
 * source must still be current, unchanged since it was listed, and ready; otherwise nothing
 * is recorded. Each check opens that source's composition gap.
 */
export function reviewAbilities(db: DatabaseSync, body: unknown): { checked: number; escalation_ids: string[] } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new WorkbenchError(422, "Expected {reviewer, items}.");
  const input = body as { reviewer?: unknown; items?: unknown };
  if (typeof input.reviewer !== "string" || !input.reviewer.trim()) throw new WorkbenchError(422, "reviewer is required.");
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_BLOCK) {
    throw new WorkbenchError(422, `items must list 1 to ${MAX_BLOCK} sources.`);
  }
  const reviewer = input.reviewer;
  const items = input.items as Array<{ ability_version_id?: unknown; source_hash?: unknown; expected_review_hash?: unknown }>;
  return withTransaction(db, () => {
    const escalationIds: string[] = [];
    for (const [index, entry] of items.entries()) {
      if (typeof entry?.ability_version_id !== "number" || typeof entry.source_hash !== "string" || typeof entry.expected_review_hash !== "string") {
        throw new WorkbenchError(422, `items[${index}] needs ability_version_id, source_hash, and expected_review_hash.`);
      }
      const before = getAbility(db, entry.ability_version_id);
      if (!before.progress.readiness.ready) {
        throw new WorkbenchError(409, `${before.faction_id}/${before.ability_id} is no longer fully reviewed; reload the composition queue.`);
      }
      const view = reviewAbility(db, entry.ability_version_id, {
        source_hash: entry.source_hash, expected_review_hash: entry.expected_review_hash, reviewer, whole_context_checked: true,
      });
      if (!view.composition_escalation_id) throw new WorkbenchError(409, `${view.faction_id}/${view.ability_id} did not open a composition gap.`);
      escalationIds.push(view.composition_escalation_id);
    }
    return { checked: escalationIds.length, escalation_ids: escalationIds };
  });
}
