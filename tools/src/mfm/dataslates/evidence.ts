/**
 * evidence.ts — what the dump and the other MFM passes say about each record, gathered once
 * for the `dataslates` pass. Every reconciler runs in memory over the on-disk dataset (no writes);
 * a record "matches its pass" when the pass's projection leaves it unchanged, `game_version`
 * aside (the stamp is what this pass decides).
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../../round4/hash.js";
import { entryWithMechanics } from "../../semantic-authoring/entries.js";
import { compilationInputsHash } from "../../semantic-authoring/compiled.js";
import { loadDumpSourceRecords } from "../../semantic-authoring/dump-source.js";
import { sourceDigest } from "../../source-digest.js";
import type { StagedWrite } from "../apply.js";
import { runAttachmentRoles } from "../attachment.js";
import type { GameVersion } from "../dataslate.js";
import { runDetachmentFields } from "../detachment-fields.js";
import { runDispositions } from "../dispositions.js";
import { buildEnhCanon, runEnhancements } from "../enhancements.js";
import { mintWeapon, type WeaponRecord } from "../gear-projection.js";
import type { MfmDump } from "../loader.js";
import { runPoints } from "../points.js";
import { buildStratCanon, type StratagemCanon } from "../stratagems.js";
import { runCompositionNames, runCompositionTiers, runWargear, wargearItemsForDatasheet } from "../wargear.js";
import { abilityVerified, type ApprovedEntry, type FreshSource } from "./verdict.js";

type Json = Record<string, unknown>;

/** `<dir>/<key>` — the identity of one record within its faction dir. */
export const scoped = (dir: string, key: string): string => `${dir}/${key}`;

/** The dump ids a record references in the `mfm` namespace. */
export function mfmRefs(record: Json): string[] {
  if (!Array.isArray(record.external_refs)) return [];
  return record.external_refs.flatMap((ref) =>
    ref && typeof ref === "object" && (ref as Json).namespace === "mfm" && typeof (ref as Json).id === "string" ? [(ref as Json).id as string] : [],
  );
}

function readArray(file: string): Json[] {
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? (parsed as Json[]) : [];
}

function withoutStamp(record: Json): string {
  const { game_version: _stamp, ...rest } = record;
  return JSON.stringify(rest);
}

/**
 * Keys (per `keyOf`) whose records a staged projection of `file` would add, remove, or change.
 * A file the projection does not stage changes nothing.
 */
export function changedKeys(staged: readonly StagedWrite[], file: string, keyOf: (record: Json) => string | undefined): Set<string> {
  const changed = new Set<string>();
  const write = staged.find((item) => path.resolve(item.path) === path.resolve(file));
  if (!write || !Array.isArray(write.value)) return changed;
  const group = (records: readonly Json[]): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const record of records) {
      const key = keyOf(record);
      if (key === undefined) continue;
      (out.get(key) ?? out.set(key, []).get(key)!).push(withoutStamp(record));
    }
    return out;
  };
  const before = group(readArray(file));
  const after = group(write.value as Json[]);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))) changed.add(key);
  }
  return changed;
}

/** The records of `file` a staged projection writes (by key), or null when it is not staged. */
function projectedRecords(staged: readonly StagedWrite[], file: string, keyOf: (record: Json) => string | undefined): Map<string, string> | null {
  const write = staged.find((item) => path.resolve(item.path) === path.resolve(file));
  if (!write || !Array.isArray(write.value)) return null;
  const out = new Map<string, string>();
  for (const record of write.value as Json[]) {
    const key = keyOf(record);
    if (key !== undefined) out.set(key, withoutStamp(record));
  }
  return out;
}

const idOf = (record: Json): string | undefined => (typeof record.id === "string" ? record.id : undefined);
const unitIdOf = (record: Json): string | undefined => (typeof record.unit_id === "string" ? record.unit_id : undefined);
const leaderIdOf = (record: Json): string | undefined => (typeof record.leader_id === "string" ? record.leader_id : undefined);

export interface CoreEvidence {
  /** Units the points reconciliation matched to a live, referenced datasheet at the dump's price. */
  units: Set<string>;
  /** Dump wargear item ids reachable from a live datasheet's loadout. */
  loadoutItems: Set<string>;
  /** Units whose compositions the wargear, composition-names and composition-tiers passes leave unchanged. */
  compositions: Set<string>;
  /** Wargear options the wargear pass rebuilds from the dump exactly as stored. */
  options: Set<string>;
  /** Leader attachments the attachment-role pass emits from the dump exactly as stored. */
  leaders: Set<string>;
  /** Enhancements the dump prints that the enhancements pass leaves unchanged. */
  enhancements: Set<string>;
  /** Detachments with a live dump ref that the dispositions and detachment-fields passes leave unchanged. */
  detachments: Set<string>;
  /** Dump-derived stratagem structure by repo id. */
  stratagems: Map<string, StratagemCanon>;
}

/** Run every dump reconciler in memory and keep what each says matches the dump. */
export function gatherCoreEvidence(dump: MfmDump, coreDir: string, dirs: readonly string[]): CoreEvidence {
  const datasheets = dump.byId("datasheet");
  const liveDatasheet = (id: string): boolean => {
    const row = datasheets.get(id);
    return !!row && !row.isLegends;
  };

  // A unit's ref may name a same-named reprint of the datasheet points priced it from.
  const nameOf = (id: string): string | undefined => dump.enName(datasheets.get(id))?.trim().toLowerCase();
  const units = new Set<string>();
  for (const result of runPoints(dump, false).dirs) {
    const byId = new Map(readArray(path.join(coreDir, result.dir, "units.json")).map((unit) => [unit.id, unit]));
    for (const { id, datasheetId } of result.pointsVerified) {
      const unit = byId.get(id);
      const name = nameOf(datasheetId);
      if (unit && name && mfmRefs(unit).some((ref) => liveDatasheet(ref) && nameOf(ref) === name)) units.add(scoped(result.dir, id));
    }
  }

  const loadoutItems = new Set<string>();
  for (const datasheet of dump.table("datasheet")) {
    if (datasheet.isLegends || !datasheet.id) continue;
    for (const item of wargearItemsForDatasheet(dump, datasheet.id)) if (item.id) loadoutItems.add(item.id);
  }

  const wargear = runWargear(dump, false);
  const names = runCompositionNames(dump);
  const tiers = runCompositionTiers(dump);
  const compositions = new Set<string>();
  const options = new Set<string>();
  for (const result of wargear.dirs) {
    const compFile = path.join(coreDir, result.dir, "unit-compositions.json");
    const changed = new Set([
      ...changedKeys(wargear.staged, compFile, unitIdOf),
      ...changedKeys(names.staged, compFile, unitIdOf),
      ...changedKeys(tiers.staged, compFile, unitIdOf),
    ]);
    for (const unitId of result.matchedUnitIds) if (!changed.has(unitId)) compositions.add(scoped(result.dir, unitId));

    const optionFile = path.join(coreDir, result.dir, "wargear-options.json");
    const built = projectedRecords(wargear.staged, optionFile, idOf);
    if (!built) continue;
    const matched = new Set(result.matchedUnitIds);
    for (const option of readArray(optionFile)) {
      const id = idOf(option);
      if (id && matched.has(String(option.unit_id)) && built.get(id) === withoutStamp(option)) options.add(scoped(result.dir, id));
    }
  }

  const attachment = runAttachmentRoles(dump);
  const leaders = new Set<string>();
  for (const result of attachment.dirs) {
    const file = path.join(coreDir, result.dir, "leader-attachments.json");
    const changed = changedKeys(attachment.staged, file, leaderIdOf);
    for (const id of result.emittedLeaderIds) if (!changed.has(id)) leaders.add(scoped(result.dir, id));
  }

  const enhancementCanon = buildEnhCanon(dump);
  const enhancementRun = runEnhancements(dump, false, { includeCombatPatrol: true });
  const dumpEnhancements = dump.byId("enhancement");
  const enhancements = new Set<string>();
  const dispositions = runDispositions(dump, false, { includeCombatPatrol: true });
  const detachmentFields = runDetachmentFields(dump);
  const dumpDetachments = dump.byId("detachment");
  const detachments = new Set<string>();
  for (const dir of dirs) {
    const enhFile = path.join(coreDir, dir, "enhancements.json");
    const enhChanged = changedKeys(enhancementRun.staged, enhFile, idOf);
    for (const record of readArray(enhFile)) {
      const id = idOf(record);
      if (id && enhancementCanon.has(id) && !enhChanged.has(id) && mfmRefs(record).some((ref) => dumpEnhancements.has(ref))) {
        enhancements.add(scoped(dir, id));
      }
    }
    const detFile = path.join(coreDir, dir, "detachments.json");
    const detChanged = new Set([...changedKeys(dispositions.staged, detFile, idOf), ...changedKeys(detachmentFields.staged, detFile, idOf)]);
    for (const record of readArray(detFile)) {
      const id = idOf(record);
      if (id && !detChanged.has(id) && mfmRefs(record).some((ref) => dumpDetachments.has(ref))) detachments.add(scoped(dir, id));
    }
  }

  return { units, loadoutItems, compositions, options, leaders, enhancements, detachments, stratagems: buildStratCanon(dump) };
}

export type WeaponReason = "verified" | "no-ref" | "dangling-ref" | "unmintable" | "unmapped-keyword" | "differs";

/** Re-mint a weapon from its dump item and compare (see {@link weaponMatchesMinted}). */
export function weaponReason(
  dump: MfmDump,
  record: Json,
  now: GameVersion,
  matches: (record: Json, minted: WeaponRecord) => boolean,
): WeaponReason {
  const refs = mfmRefs(record);
  if (refs.length === 0) return "no-ref";
  const items = dump.byId("wargear_item");
  const live = refs.map((ref) => items.get(ref)).filter((row) => !!row);
  if (live.length === 0) return "dangling-ref";
  // One id can name the same weapon on several datasheets, and a Combat Patrol box may print an
  // older line under the same item name: the record verifies when it equals any item it names.
  const reasons = live.map((item): WeaponReason => {
    const warnings: string[] = [];
    let minted: WeaponRecord;
    try {
      minted = mintWeapon({ dump, gv: now, warnings }, item, String(record.id), String(record.name));
    } catch {
      return "unmintable";
    }
    // A keyword the mapper cannot express is a mechanic this comparison cannot check.
    if (warnings.length > 0) return "unmapped-keyword";
    return matches(record, minted) ? "verified" : "differs";
  });
  for (const reason of ["verified", "unmapped-keyword", "unmintable"] as const) if (reasons.includes(reason)) return reason;
  return "differs";
}

export type AbilityReason = "verified" | "stub" | "no-source" | "ambiguous-source" | "digest-differs" | "unpublished";

/** `<faction>\u0000<ability id>`. */
const abilityKey = (faction: string, abilityId: string): string => `${faction}\u0000${abilityId}`;

/**
 * The verdict of every enrichment ability: its dump prose (the source publication digests) and
 * the workbench's approved, current entries for it.
 */
export function gatherAbilityVerdicts(
  options: { dataRoot: string; dumpPath: string; db: DatabaseSync },
  enrichment: ReadonlyMap<string, readonly Json[]>,
): Map<string, AbilityReason> {
  const source = loadDumpSourceRecords({ dataRoot: options.dataRoot, dumpPath: options.dumpPath });
  const fresh = new Map<string, FreshSource>();
  for (const record of source.records) {
    fresh.set(abilityKey(record.factionId, record.abilityId), {
      digest: sourceDigest(record.text),
      sourceHash: record.sourceHash,
      matchHash: hashJson({ source_type: record.sourceType, fragments: record.fragments }),
    });
  }
  const conflicts = new Set(source.conflicts.map((conflict) => abilityKey(conflict.factionId, conflict.abilityId)));

  const rows = options.db.prepare(`
    SELECT compiled_entries.ability_version_id, compiled_entries.inputs_hash, compiled_entries.mechanics_json,
      abilities.faction_id, abilities.ability_id, abilities.source_hash, abilities.source_type, abilities.fragments_json
    FROM compiled_entries JOIN abilities ON abilities.id = compiled_entries.ability_version_id
    WHERE compiled_entries.status = 'approved' AND abilities.current = 1
  `).all() as Array<{
    ability_version_id: number; inputs_hash: string; mechanics_json: string; faction_id: string; ability_id: string;
    source_hash: string; source_type: string | null; fragments_json: string;
  }>;
  const approved = new Map<string, ApprovedEntry[]>();
  for (const row of rows) {
    const key = abilityKey(row.faction_id, row.ability_id);
    (approved.get(key) ?? approved.set(key, []).get(key)!).push({
      inputsCurrent: compilationInputsHash(options.db, row.ability_version_id) === row.inputs_hash,
      sourceHash: row.source_hash,
      matchHash: hashJson({ source_type: row.source_type, fragments: JSON.parse(row.fragments_json) }),
      mechanics: JSON.parse(row.mechanics_json),
    });
  }

  const verdicts = new Map<string, AbilityReason>();
  for (const [faction, records] of enrichment) {
    for (const record of records) {
      if (typeof record.ability_id !== "string") continue;
      const key = abilityKey(faction, record.ability_id);
      const source = fresh.get(key) ?? null;
      let reason: AbilityReason;
      if (record.stub === true) reason = "stub";
      else if (conflicts.has(key)) reason = "ambiguous-source";
      else if (!source) reason = "no-source";
      else if (record.source_digest !== source.digest) reason = "digest-differs";
      else reason = abilityVerified(record, source, approved.get(key) ?? [], entryWithMechanics as never) ? "verified" : "unpublished";
      verdicts.set(scoped(faction, record.ability_id), reason);
    }
  }
  return verdicts;
}
