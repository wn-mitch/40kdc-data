import type { DatabaseSync } from "node:sqlite";
import { hashJson } from "../round4/hash.js";
import { compilationInputsHash, getCompiledEntry } from "./compiled.js";
import { existsSync, readFileSync } from "node:fs";

import { keywordIndex } from "./core-keywords.js";
import { entryWithMechanics, resolveAbilityEntity, semanticAuthoringDataRoot } from "./entries.js";
import { canonicalTarget, coreStratagemFile } from "./publish-core.js";

/**
 * Approved compiled entries that would change a tracked ability file, or a stratagem's target in its
 * faction's core stratagems.json, grouped by faction.
 * An entry is listed only while its source version is current and its leaves are unchanged
 * since approval; the publisher re-checks all of that before writing.
 */

export type PublishableEntry = { entry_id: string; ability_id: string; shape_signature: string; changes: string[] };
export type PublishableFaction = { faction_id: string; entries: PublishableEntry[] };

const FIELDS = ["effect", "scope", "behavior", "trigger", "usage", "applies_to"] as const;

const coreFiles = new Map<string, Array<Record<string, unknown>> | null>();
let keywords: Map<string, string> | null = null;

/**
 * Whether an approved stratagem target differs from the one core publishes: "blocked" when it cannot
 * be projected (no core record, or keywords core does not know), which the publisher would refuse.
 */
function coreTargetChanges(factionId: string, abilityId: string, target: Record<string, unknown> | Array<Record<string, unknown>>): boolean | "blocked" {
  const root = semanticAuthoringDataRoot();
  if (!coreFiles.has(factionId)) {
    const file = coreStratagemFile(root, factionId);
    coreFiles.set(factionId, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>> : null);
  }
  const record = coreFiles.get(factionId)?.find((item) => (item.ability_id ?? item.id) === abilityId);
  if (!record) return "blocked";
  try {
    keywords ??= keywordIndex(root);
    return hashJson(record.target_restrictions ?? null) !== hashJson(canonicalTarget(target, keywords));
  } catch {
    return "blocked";
  }
}

export function publishableEntries(db: DatabaseSync): { factions: PublishableFaction[]; stale: number; unchanged: number; blocked: string[] } {
  const rows = db.prepare(`
    SELECT compiled_entries.id, abilities.faction_id, abilities.ability_id
    FROM compiled_entries JOIN abilities ON abilities.id = compiled_entries.ability_version_id
    WHERE compiled_entries.status = 'approved' AND abilities.current = 1
    ORDER BY abilities.faction_id, abilities.ability_id
  `).all() as Array<{ id: string; faction_id: string; ability_id: string }>;
  coreFiles.clear();
  const factions = new Map<string, PublishableEntry[]>();
  let stale = 0;
  let unchanged = 0;
  // Approved stratagems whose target core cannot take as compiled; listed so they are not lost.
  const blocked: string[] = [];
  for (const row of rows) {
    const entry = getCompiledEntry(db, row.id)!;
    if (compilationInputsHash(db, entry.ability_version_id) !== entry.inputs_hash) { stale += 1; continue; }
    let original: Record<string, unknown>;
    try {
      original = resolveAbilityEntity(semanticAuthoringDataRoot(), row.faction_id, row.ability_id).entry;
    } catch {
      stale += 1;
      continue;
    }
    const projected = entryWithMechanics(original, entry.mechanics);
    const changes: string[] = FIELDS.filter((field) => hashJson(original[field] ?? null) !== hashJson(projected[field] ?? null));
    const core = entry.core ? coreTargetChanges(row.faction_id, row.ability_id, entry.core.target_restrictions) : false;
    if (core === "blocked") { blocked.push(row.ability_id); continue; }
    if (core) changes.push("core.target_restrictions");
    if (changes.length === 0) { unchanged += 1; continue; }
    const list = factions.get(row.faction_id) ?? [];
    list.push({ entry_id: entry.id, ability_id: row.ability_id, shape_signature: entry.shape_signature, changes: [...changes] });
    factions.set(row.faction_id, list);
  }
  return { factions: [...factions].map(([faction_id, entries]) => ({ faction_id, entries })), stale, unchanged, blocked };
}
