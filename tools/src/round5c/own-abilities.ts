import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { abilityIdsOf } from "../data/ability-refs.js";

/**
 * The ability "this ability" names on a record. Usually the record's own id; but a duplicate stub
 * (a record no datasheet carries, with the same MFM references and the same text as one record of
 * its faction that datasheets do carry) names that canonical record, the ability units actually
 * have.
 */

export type AbilityIdentity = {
  ability_id: string;
  faction_id: string;
  /** Hash of the record's source text. */
  source_hash: string;
  /** The MFM dump references the record's text was read from. */
  mfm_refs: readonly string[];
  /** Whether a datasheet carries the ability (a unit lists it, or the record names its units). */
  carried: boolean;
};

const refSet = (refs: readonly string[]) => [...new Set(refs)].sort().join("\u0000");

/**
 * The canonical id for `record` among `records`: its own id when a datasheet carries it or no
 * carried record duplicates it; the one carried record of the same faction with the same text and
 * the same MFM references when it is a stub. Two such records leave "this ability" undecided, so
 * the lookup throws rather than pick one.
 */
export function canonicalAbilityId(record: AbilityIdentity, records: readonly AbilityIdentity[]): string {
  if (record.carried || record.mfm_refs.length === 0) return record.ability_id;
  const refs = refSet(record.mfm_refs);
  const matches = [...new Set(records.filter((other) => other.ability_id !== record.ability_id && other.carried
    && other.faction_id === record.faction_id && other.source_hash === record.source_hash && refSet(other.mfm_refs) === refs)
    .map((other) => other.ability_id))].sort();
  if (matches.length > 1) throw new Error(`${record.faction_id}/${record.ability_id} duplicates ${matches.join(", ")}; "this ability" has no one canonical record.`);
  return matches[0] ?? record.ability_id;
}

function readArray(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
}

/** `<faction>\u0000<ability id>` for every ability a datasheet carries, from the repo data root. */
function carriedAbilities(dataRoot: string): Set<string> {
  const carried = new Set<string>();
  for (const kind of ["core", "enrichment"]) {
    const root = join(dataRoot, kind);
    if (!existsSync(root)) continue;
    for (const faction of readdirSync(root).sort()) {
      if (kind === "core") {
        for (const unit of readArray(join(root, faction, "units.json"))) for (const id of abilityIdsOf(unit.ability_ids)) carried.add(`${faction}\u0000${id}`);
      } else {
        for (const ability of readArray(join(root, faction, "abilities.json"))) {
          if (typeof ability.ability_id === "string" && Array.isArray(ability.unit_ids) && ability.unit_ids.length > 0) carried.add(`${faction}\u0000${ability.ability_id}`);
        }
      }
    }
  }
  return carried;
}

function mfmRefs(metadataJson: string | null): string[] {
  try {
    const refs = (JSON.parse(metadataJson ?? "null") as { source?: { kind?: unknown; refs?: unknown } } | null)?.source;
    return refs?.kind === "mfm" && Array.isArray(refs.refs) ? refs.refs.filter((ref): ref is string => typeof ref === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Ability version id → the ability "this ability" names, for every current workbench record. A
 * record whose duplicates are ambiguous is left out, so a leaf naming its own ability refuses.
 */
export function ownAbilityIds(db: DatabaseSync, dataRoot: string): Map<number, string> {
  const carried = carriedAbilities(dataRoot);
  const rows = db.prepare("SELECT id, faction_id, ability_id, source_hash, metadata_json FROM abilities WHERE current = 1").all() as Array<{ id: number; faction_id: string; ability_id: string; source_hash: string; metadata_json: string | null }>;
  const records = rows.map((row) => ({
    id: row.id, ability_id: row.ability_id, faction_id: row.faction_id, source_hash: row.source_hash,
    mfm_refs: mfmRefs(row.metadata_json), carried: carried.has(`${row.faction_id}\u0000${row.ability_id}`),
  }));
  const byFaction = new Map<string, AbilityIdentity[]>();
  for (const record of records) byFaction.set(record.faction_id, [...(byFaction.get(record.faction_id) ?? []), record]);
  const result = new Map<number, string>();
  for (const record of records) {
    try {
      result.set(record.id, canonicalAbilityId(record, byFaction.get(record.faction_id)!));
    } catch {
      // Ambiguous duplicates: no id, so "this ability" refuses to compile on this record.
    }
  }
  return result;
}
