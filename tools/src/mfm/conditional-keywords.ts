import * as fs from "fs";
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import type { StagedWrite } from "./apply.js";
import { candidateDirs, homeScore } from "./wargear.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import { repoDirs } from "./faction-map.js";
import { factionKeywordLabel, keywordLabel } from "./keywords.js";
import type { DatasheetRow } from "./dump.generated.js";
import type { MfmDump } from "./loader.js";
import { currentGameVersion } from "./dataslate.js";

interface ConditionalKeyword {
  keyword: string;
  required_detachment_id?: string | null;
  required_faction_keyword?: string | null;
  choice_group?: string;
}

/** A keyword-choice group (`keyword-choice-groups.json`): the dump's allegiance ability group. */
export interface KeywordChoiceGroup {
  id: string;
  name: string;
  detachment_id: string | null;
  mandatory: boolean;
  min_units: number | null;
  max_units: number | null;
  game_version: unknown;
}

export const CHOICE_GROUPS_PATH = path.join(CORE_DIR, "keyword-choice-groups.json");

/**
 * The dump's allegiance ability groups as keyword-choice groups, keyed by allegiance ability id. A
 * group's id is its name's slug, then its detachment's slug when it has one. Groups the dump prints
 * apart under one id (two Mark of Chaos groups in one detachment) are one group when their
 * mandatory flag and limits agree, and throw otherwise.
 */
export function choiceGroups(dump: MfmDump): { byAbility: Map<string, string>; groups: KeywordChoiceGroup[] } {
  const detachments = dump.byId("detachment");
  const gameVersion = currentGameVersion(dump);
  const groups = new Map<string, KeywordChoiceGroup>();
  const byGroup = new Map<string, string>();
  for (const group of dump.table("allegiance_ability_group")) {
    const name = dump.enName(group);
    if (!name) continue;
    const detachmentName = group.detachmentId ? dump.enName(detachments.get(group.detachmentId)) : undefined;
    if (group.detachmentId && !detachmentName) continue;
    const detachmentId = detachmentName ? nameToId(detachmentName) : null;
    const id = detachmentId ? `${nameToId(name)}-${detachmentId}` : nameToId(name);
    const next: KeywordChoiceGroup = {
      id, name, detachment_id: detachmentId, mandatory: group.isMandatory === true,
      min_units: group.minRosterLimit ?? null, max_units: group.maxRosterLimit ?? null, game_version: gameVersion,
    };
    const seen = groups.get(id);
    if (seen && (seen.mandatory !== next.mandatory || seen.min_units !== next.min_units || seen.max_units !== next.max_units)) {
      throw new Error(`Allegiance groups named ${id} disagree on their mandatory flag or limits.`);
    }
    groups.set(id, seen ?? next);
    byGroup.set(group.id, id);
  }
  const byAbility = new Map<string, string>();
  for (const ability of dump.table("allegiance_ability")) {
    const groupId = byGroup.get(ability.allegianceAbilityGroupId);
    if (groupId) byAbility.set(ability.id, groupId);
  }
  return { byAbility, groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

interface UnitRecord {
  id: string;
  conditional_keywords?: ConditionalKeyword[];
  [key: string]: unknown;
}

export interface ConditionalKeywordDirResult {
  dir: string;
  matched: number;
  changed: number;
}

export interface ConditionalKeywordReport {
  dirs: ConditionalKeywordDirResult[];
  unsupported: { unit_id: string; source_id: string; condition: string }[];
  unresolved: { unit_id: string; source_id: string; field: string }[];
  staged: StagedWrite[];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function sortEntries(entries: Iterable<ConditionalKeyword>): ConditionalKeyword[] {
  const unique = new Map<string, ConditionalKeyword>();
  for (const entry of entries) unique.set(JSON.stringify(entry), entry);
  return [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** Reconcile source-owned conditional keyword grants onto every matched repo unit. */
export function runConditionalKeywords(dump: MfmDump, onlyDir?: string): ConditionalKeywordReport {
  const dirs = repoDirs();
  const byDir = new Map<string, DatasheetRow[]>();
  for (const datasheet of dump.table("datasheet")) {
    if (datasheet.isLegends) continue;
    for (const dir of candidateDirs(dump, datasheet)) {
      if (!dirs.has(dir)) continue;
      (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(datasheet);
    }
  }

  const conditionsByDatasheet = dump.groupBy("conditional_keyword", "datasheetId");
  const choices = choiceGroups(dump);
  const usedGroups = new Set<string>();
  const detachments = dump.byId("detachment");
  // Detachments the dump prints. A repo grant tied to any other detachment (a faction-pack
  // detachment the dump does not carry yet) is outside the dump's say and is kept.
  const dumpDetachmentIds = new Set<string>();
  for (const detachment of dump.table("detachment")) {
    const name = dump.enName(detachment);
    if (!name) continue;
    try {
      dumpDetachmentIds.add(nameToId(name));
    } catch {
      continue;
    }
  }
  const staged: StagedWrite[] = [];
  const results: ConditionalKeywordDirResult[] = [];
  const unsupported: ConditionalKeywordReport["unsupported"] = [];
  const unresolved: ConditionalKeywordReport["unresolved"] = [];

  for (const dir of [...dirs].sort()) {
    if (onlyDir && dir !== onlyDir) continue;
    const unitPath = path.join(CORE_DIR, dir, "units.json");
    if (!fs.existsSync(unitPath)) continue;
    const units = readJsonArray<UnitRecord>(unitPath);
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const grantsByUnit = new Map<string, ConditionalKeyword[]>();
    const matched = new Set<string>();

    const datasheets = (byDir.get(dir) ?? [])
      .slice()
      .sort((a, b) => homeScore(dump, a, dir) - homeScore(dump, b, dir));
    for (const datasheet of datasheets) {
      const name = dump.enName(datasheet);
      if (!name) continue;
      let unitId: string;
      try {
        unitId = nameToId(name);
      } catch {
        continue;
      }
      if (!byId.has(unitId)) continue;
      matched.add(unitId);

      for (const source of conditionsByDatasheet.get(datasheet.id) ?? []) {
        if (source.requiredWarlordMiniatureId) {
          unsupported.push({ unit_id: unitId, source_id: source.id, condition: "requiredWarlordMiniatureId" });
          continue;
        }
        const keyword = keywordLabel(dump, source.keywordId);
        if (!keyword) {
          unresolved.push({ unit_id: unitId, source_id: source.id, field: "keywordId" });
          continue;
        }
        const entry: ConditionalKeyword = { keyword };
        // "Mark of Chaos", "Daemonic Allegiance": the keyword is one option of a muster-time choice.
        if (source.requiredAllegianceAbilityId) {
          const group = choices.byAbility.get(source.requiredAllegianceAbilityId);
          if (!group) {
            unresolved.push({ unit_id: unitId, source_id: source.id, field: "requiredAllegianceAbilityId" });
            continue;
          }
          entry.choice_group = group;
          usedGroups.add(group);
        }
        if (source.requiredDetachmentId) {
          const detachmentName = dump.enName(detachments.get(source.requiredDetachmentId));
          if (!detachmentName) {
            unresolved.push({ unit_id: unitId, source_id: source.id, field: "requiredDetachmentId" });
            continue;
          }
          entry.required_detachment_id = nameToId(detachmentName);
        }
        if (source.requiredRosterFactionKeywordId) {
          const factionKeyword = factionKeywordLabel(dump, source.requiredRosterFactionKeywordId);
          if (!factionKeyword) {
            unresolved.push({ unit_id: unitId, source_id: source.id, field: "requiredRosterFactionKeywordId" });
            continue;
          }
          entry.required_faction_keyword = factionKeyword;
        }
        (grantsByUnit.get(unitId) ?? grantsByUnit.set(unitId, []).get(unitId)!).push(entry);
      }
    }

    let changed = 0;
    for (const unitId of matched) {
      const unit = byId.get(unitId)!;
      const kept = (unit.conditional_keywords ?? []).filter(
        (entry) => entry.required_detachment_id && !dumpDetachmentIds.has(entry.required_detachment_id),
      );
      const next = sortEntries([...(grantsByUnit.get(unitId) ?? []), ...kept]);
      if (same(unit.conditional_keywords, next)) continue;
      if (next.length) unit.conditional_keywords = next;
      else delete unit.conditional_keywords;
      changed += 1;
    }
    if (changed) staged.push({ path: unitPath, value: units });
    if (matched.size || changed) results.push({ dir, matched: matched.size, changed });
  }

  // Every group an option names, unfiltered by onlyDir only when the whole dataset ran.
  if (!onlyDir) {
    const groups = choices.groups.filter((group) => usedGroups.has(group.id));
    const current = fs.existsSync(CHOICE_GROUPS_PATH) ? readJsonArray<KeywordChoiceGroup>(CHOICE_GROUPS_PATH) : [];
    if (!same(current, groups)) staged.push({ path: CHOICE_GROUPS_PATH, value: groups });
  }
  unsupported.sort((a, b) => `${a.unit_id}:${a.source_id}`.localeCompare(`${b.unit_id}:${b.source_id}`));
  unresolved.sort((a, b) => `${a.unit_id}:${a.source_id}`.localeCompare(`${b.unit_id}:${b.source_id}`));
  return { dirs: results, unsupported, unresolved, staged };
}

export function buildConditionalKeywordReport(
  report: ConditionalKeywordReport,
  write: boolean,
): string {
  const lines = [
    `# MFM conditional-keywords — ${write ? "APPLIED" : "DRY RUN"}`,
    "",
    "Source-owned conditional unit keywords from `conditional_keyword`.",
    "An allegiance-ability condition is one option of a keyword-choice group (`keyword-choice-groups.json`); warlord-miniature conditions are reported, not flattened.",
    "",
    "| Dir | Matched | Changed |",
    "|---|--:|--:|",
    ...report.dirs.map((entry) => `| ${entry.dir} | ${entry.matched} | ${entry.changed} |`),
    "",
    `Unsupported source conditions: ${report.unsupported.length}`,
    `Unresolved source references: ${report.unresolved.length}`,
    "",
  ];
  return lines.join("\n");
}
