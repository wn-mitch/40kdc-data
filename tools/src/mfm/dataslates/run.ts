/**
 * run.ts — the `ingest-mfm dataslates` pass: stamp every dump-verifiable record with the current
 * dump's dataslate, and demote to provisional every record that claims dump confirmation but no
 * longer verifies (see `verdict.ts` for the stamp rule, `evidence.ts` for what each entity is
 * checked against).
 *
 * Covered: per-faction units, weapons, wargear, unit-compositions, wargear-options,
 * leader-attachments, enhancements, detachments, stratagems (plus core/stratagems.json), and
 * per-faction enrichment abilities, phase-mappings and resource-pools (plus `_core`). Root-level
 * files the dump does not own (terrain, allies, game modes, missions, keywords…) are not read.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { applyReplacements, type Replacement } from "../../round6/json-spans.js";
import type { StagedWrite } from "../apply.js";
import { currentGameVersion, type GameVersion } from "../dataslate.js";
import type { MfmDump } from "../loader.js";
import { CORE_FACTION } from "../dump-prose-rows.js";
import {
  gatherAbilityVerdicts,
  gatherCoreEvidence,
  mfmRefs,
  scoped,
  weaponReason,
  type AbilityReason,
  type CoreEvidence,
  type WeaponReason,
} from "./evidence.js";
import {
  detachmentRuleIds,
  detachmentVerified,
  stampAction,
  stratagemStructureMatches,
  weaponMatchesMinted,
  type StampAction,
} from "./verdict.js";

type Json = Record<string, unknown>;

export const DATASLATE_ENTITIES = [
  "units",
  "weapons",
  "wargear",
  "unit-compositions",
  "wargear-options",
  "leader-attachments",
  "enhancements",
  "detachments",
  "stratagems",
  "abilities",
  "phase-mappings",
  "resource-pools",
] as const;
export type DataslateEntity = (typeof DATASLATE_ENTITIES)[number];

export type ActionCounts = Record<StampAction, number>;

export interface DataslatesReport {
  current: GameVersion;
  /** entity → faction dir (`(core)` for core/stratagems.json) → counts. */
  counts: Map<DataslateEntity, Map<string, ActionCounts>>;
  /** Why abilities did not verify, by faction. */
  abilityReasons: Map<string, Map<AbilityReason, number>>;
  /** Why weapons did not verify. */
  weaponReasons: Map<WeaponReason, number>;
  staged: StagedWrite[];
}

const emptyCounts = (): ActionCounts => ({ promote: 0, demote: 0, kept: 0, untouched: 0 });

function readText(file: string): { text: string; records: Json[] } | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array in ${file}`);
  return { text, records: parsed as Json[] };
}

function subdirs(root: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && keep(entry.name)).map((entry) => entry.name).sort();
}

export interface DataslatesOptions {
  dataRoot: string;
  dumpPath: string;
  /** The semantic-authoring workbench, read only; abilities verify against its approved entries. */
  db: DatabaseSync;
}

/** Decide every covered record's stamp and stage the files whose stamps change. */
export function runDataslates(dump: MfmDump, options: DataslatesOptions): DataslatesReport {
  const now = currentGameVersion(dump);
  const coreDir = path.join(options.dataRoot, "core");
  const enrichmentDir = path.join(options.dataRoot, "enrichment");
  const coreDirs = subdirs(coreDir, (name) => !name.startsWith("_"));
  const enrichmentDirs = subdirs(enrichmentDir, (name) => !name.startsWith("_") || name === CORE_FACTION);

  const enrichment = new Map<string, Json[]>();
  for (const dir of enrichmentDirs) enrichment.set(dir, readText(path.join(enrichmentDir, dir, "abilities.json"))?.records ?? []);
  const abilityVerdicts = gatherAbilityVerdicts(options, enrichment);
  const abilityOk = (faction: string, abilityId: unknown): boolean =>
    typeof abilityId === "string" && abilityVerdicts.get(scoped(faction, abilityId)) === "verified";
  const evidence: CoreEvidence = gatherCoreEvidence(dump, coreDir, coreDirs);

  const report: DataslatesReport = { current: now, counts: new Map(), abilityReasons: new Map(), weaponReasons: new Map(), staged: [] };

  const stampFile = (entity: DataslateEntity, dir: string, file: string, verified: (record: Json) => boolean): void => {
    const loaded = readText(file);
    if (!loaded) return;
    const byEntity = report.counts.get(entity) ?? report.counts.set(entity, new Map()).get(entity)!;
    const counts = byEntity.get(dir) ?? byEntity.set(dir, emptyCounts()).get(dir)!;
    const replacements: Replacement[] = [];
    const records = structuredClone(loaded.records);
    records.forEach((record, index) => {
      const stamp = record.game_version as GameVersion | undefined;
      const { action, next } = stampAction(stamp && typeof stamp === "object" ? stamp : undefined, verified(record), now);
      counts[action] += 1;
      if (!next) return;
      record.game_version = next;
      replacements.push({ path: [index, "game_version"], value: next });
    });
    if (replacements.length === 0) return;
    // Files in the default layout are re-serialized; any other keeps its own bytes outside the edits.
    const canonical = `${JSON.stringify(loaded.records, null, 2)}\n` === loaded.text;
    report.staged.push(canonical ? { path: file, value: records } : { path: file, value: records, text: applyReplacements(loaded.text, replacements) });
  };

  for (const dir of coreDirs) {
    const at = (name: string): string => path.join(coreDir, dir, name);
    const key = (value: unknown): string => scoped(dir, String(value));
    stampFile("units", dir, at("units.json"), (record) => evidence.units.has(key(record.id)));
    stampFile("weapons", dir, at("weapons.json"), (record) => {
      const reason = weaponReason(dump, record, now, weaponMatchesMinted);
      report.weaponReasons.set(reason, (report.weaponReasons.get(reason) ?? 0) + 1);
      return reason === "verified";
    });
    stampFile("wargear", dir, at("wargear.json"), (record) => mfmRefs(record).some((ref) => evidence.loadoutItems.has(ref)));
    stampFile("unit-compositions", dir, at("unit-compositions.json"), (record) => evidence.compositions.has(key(record.unit_id)));
    stampFile("wargear-options", dir, at("wargear-options.json"), (record) => evidence.options.has(key(record.id)));
    stampFile("leader-attachments", dir, at("leader-attachments.json"), (record) => evidence.leaders.has(key(record.leader_id)));
    stampFile("enhancements", dir, at("enhancements.json"), (record) => evidence.enhancements.has(key(record.id)));
    stampFile("detachments", dir, at("detachments.json"), (record) =>
      detachmentVerified(evidence.detachments.has(key(record.id)), detachmentRuleIds(record), (rule) => abilityOk(dir, rule)),
    );
    stampFile("stratagems", dir, at("stratagems.json"), (record) => stratagemVerified(evidence, record, (id) => abilityOk(dir, id)));
  }
  stampFile("stratagems", "(core)", path.join(coreDir, "stratagems.json"), (record) =>
    stratagemVerified(evidence, record, (id) => abilityOk(CORE_FACTION, id)),
  );

  for (const dir of enrichmentDirs) {
    const at = (name: string): string => path.join(enrichmentDir, dir, name);
    const reasons = report.abilityReasons.get(dir) ?? report.abilityReasons.set(dir, new Map()).get(dir)!;
    stampFile("abilities", dir, at("abilities.json"), (record) => {
      const reason = abilityVerdicts.get(scoped(dir, String(record.ability_id))) ?? "no-source";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      return reason === "verified";
    });
    // A phase mapping restates when its source ability acts; it verifies with that ability.
    stampFile("phase-mappings", dir, at("phase-mappings.json"), (record) => {
      const id = record.source_id;
      const local = typeof id === "string" && abilityVerdicts.has(scoped(dir, id));
      return local ? abilityOk(dir, id) : abilityOk(CORE_FACTION, id);
    });
    // Resource pools name no ability, so no dump prose can confirm one.
    stampFile("resource-pools", dir, at("resource-pools.json"), () => false);
  }
  return report;
}

function stratagemVerified(evidence: CoreEvidence, record: Json, abilityOk: (abilityId: unknown) => boolean): boolean {
  const canon = typeof record.id === "string" ? evidence.stratagems.get(record.id) : undefined;
  if (!canon || !stratagemStructureMatches(record, canon)) return false;
  return abilityOk(record.ability_id ?? record.id);
}

/** Markdown summary of a run: per-entity actions, per-faction ability actions, and failure reasons. */
export function buildDataslatesReport(report: DataslatesReport, write: boolean): string {
  const L: string[] = [];
  const total = (byDir: Map<string, ActionCounts>): ActionCounts => {
    const sum = emptyCounts();
    for (const counts of byDir.values()) for (const action of Object.keys(sum) as StampAction[]) sum[action] += counts[action];
    return sum;
  };
  const row = (label: string, c: ActionCounts): string => `| ${label} | ${c.promote} | ${c.demote} | ${c.kept} | ${c.untouched} |`;
  L.push(`# MFM dataslates — ${write ? "APPLIED" : "DRY RUN"}`, "");
  L.push(`Current dataslate: \`${report.current.edition}/${report.current.dataslate}\`.`, "");
  L.push("Promote: verified, stamped current. Demote: claimed dump confirmation, failed verification,");
  L.push("stamped provisional. Kept: verified and already current. Untouched: unverified and not claiming");
  L.push("dump confirmation.", "");
  L.push("| Entity | Promote | Demote | Kept | Untouched |", "|---|--:|--:|--:|--:|");
  for (const entity of DATASLATE_ENTITIES) {
    const byDir = report.counts.get(entity);
    if (byDir) L.push(row(entity, total(byDir)));
  }
  L.push("", "## Abilities by faction", "", "| Faction | Promote | Demote | Kept | Untouched |", "|---|--:|--:|--:|--:|");
  for (const [dir, counts] of [...(report.counts.get("abilities") ?? new Map<string, ActionCounts>())].sort(([a], [b]) => a.localeCompare(b))) {
    L.push(row(dir, counts));
  }
  L.push("", "## Ability verification outcomes", "", "| Faction | Outcome | Records |", "|---|---|--:|");
  for (const [dir, reasons] of [...report.abilityReasons].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [reason, count] of [...reasons].sort(([a], [b]) => a.localeCompare(b))) L.push(`| ${dir} | ${reason} | ${count} |`);
  }
  L.push("", "## Weapon verification outcomes", "", "| Outcome | Records |", "|---|--:|");
  for (const [reason, count] of [...report.weaponReasons].sort(([a], [b]) => a.localeCompare(b))) L.push(`| ${reason} | ${count} |`);
  return `${L.join("\n")}\n`;
}
