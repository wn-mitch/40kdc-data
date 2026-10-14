import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { compilationInputsHash, getCompiledEntry } from "./compiled.js";
import { entryWithMechanics, resolveAbilityEntity, round5cDataRoot } from "./entries.js";

/**
 * Approved compiled entries that would change a tracked ability file, grouped by faction.
 * An entry is listed only while its source version is current and its leaves are unchanged
 * since approval; the publisher re-checks all of that before writing.
 */

export type PublishableEntry = { entry_id: string; ability_id: string; shape_signature: string; changes: string[] };
export type PublishableFaction = { faction_id: string; entries: PublishableEntry[] };

const FIELDS = ["effect", "scope", "behavior", "trigger", "usage", "applies_to"] as const;

export function publishableEntries(db: DatabaseSync): { factions: PublishableFaction[]; stale: number; unchanged: number } {
  const rows = db.prepare(`
    SELECT compiled_entries.id, abilities.faction_id, abilities.ability_id
    FROM compiled_entries JOIN abilities ON abilities.id = compiled_entries.ability_version_id
    WHERE compiled_entries.status = 'approved' AND abilities.current = 1
    ORDER BY abilities.faction_id, abilities.ability_id
  `).all() as Array<{ id: string; faction_id: string; ability_id: string }>;
  const factions = new Map<string, PublishableEntry[]>();
  let stale = 0;
  let unchanged = 0;
  for (const row of rows) {
    const entry = getCompiledEntry(db, row.id)!;
    if (compilationInputsHash(db, entry.ability_version_id) !== entry.inputs_hash) { stale += 1; continue; }
    let original: Record<string, unknown>;
    try {
      original = resolveAbilityEntity(round5cDataRoot(), row.faction_id, row.ability_id).entry;
    } catch {
      stale += 1;
      continue;
    }
    const projected = entryWithMechanics(original, entry.mechanics);
    const changes = FIELDS.filter((field) => hashJson(original[field] ?? null) !== hashJson(projected[field] ?? null));
    if (changes.length === 0) { unchanged += 1; continue; }
    const list = factions.get(row.faction_id) ?? [];
    list.push({ entry_id: entry.id, ability_id: row.ability_id, shape_signature: entry.shape_signature, changes: [...changes] });
    factions.set(row.faction_id, list);
  }
  return { factions: [...factions].map(([faction_id, entries]) => ({ faction_id, entries })), stale, unchanged };
}
