/**
 * attachment.ts — derive the leader/support attachment model from the GW MFM dump,
 * the authoritative source (the 10e `leader_head` scrape in `known-support-10e.ts`
 * is the fallback for dump-absent units).
 *
 * The dump models attachment in `datasheet_bodyguard_group`: each row's
 * `datasheetId` is the *attaching character* (the leader), `bodyguardType ∈
 * {leader, support}` is that character's role, and `datasheet_bodyguard_group_datasheet`
 * lists the datasheets it may join. `factionKeywordId` is null in this dump, so
 * faction scope comes from the leader datasheet's publication — handled exactly the
 * way {@link runWargearBudgets} scopes (candidateDirs / homeScore / nameToId).
 *
 * Two repo artifacts are derived, per faction dir:
 *   - `units.json` `attachment_role` — set on every leader the dump describes.
 *     Mixed detachment-scoped leader/support rows use `leader` as the flat
 *     fallback, so a character that can operate alone is not forced to attach.
 *     Roster-scoped groups retain their own role in `leader-attachments.json`.
 *   - `leader-attachments.json` eligibility (`leader_id → eligible_bodyguard_ids`),
 *     including roster-conditional groups from the two roster-datasheet junctions.
 *
 * Non-destructive (additive): a role is only ever *set* for a leader the dump
 * describes — never cleared — so dump-absent units keep their scrape-derived role.
 * Likewise the eligibility file is *merged* by `leader_id`: a dump-derived record
 * supersedes the same leader's existing record, and existing records for leaders the
 * dump does not describe are preserved (fallback). Routed through {@link applyWrites}
 * (AJV + integrity, throws on any failure in dry-run OR write).
 */
import * as fs from "fs";
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import {
  MfmDump,
  type DatasheetRow,
  type PublicationRow,
  type DatasheetBodyguardGroupRow,
  type DatasheetBodyguardGroupDatasheetRow,
} from "./loader.js";
import { repoDirs } from "./faction-map.js";
import { keywordLabel } from "./keywords.js";
import { CONFIRMED, candidateDirs, homeScore } from "./wargear.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import type { StagedWrite } from "./apply.js";

interface UnitRecord {
  id: string;
  attachment_role?: "leader" | "support" | null;
  [k: string]: unknown;
}
interface ConditionalAttachmentGroup {
  role: "leader" | "support";
  eligible_bodyguard_ids: string[];
  required_roster_unit_ids?: string[];
  excluded_roster_unit_ids?: string[];
}
interface LeaderAttachmentRecord {
  leader_id: string;
  eligible_bodyguard_ids: string[];
  eligible_bodyguard_keywords?: string[];
  conditional_groups?: ConditionalAttachmentGroup[];
  game_version: { edition: string; dataslate: string };
  [k: string]: unknown;
}

/** True when a datasheet's publication is a Combat Patrol box (excluded). */
function isCombatPatrolDatasheet(dump: MfmDump, ds: DatasheetRow): boolean {
  const pub = dump.byId("publication").get(ds.publicationId);
  return !!pub?.isCombatPatrol;
}

export interface DirAttachmentResult {
  dir: string;
  /** datasheets with a bodyguard group matched to a repo unit in this dir. */
  matched: number;
  rolesChanged: number;
  /** leader-attachment records emitted from the dump (≥1 resolvable bodyguard). */
  leadersEmitted: number;
  /** existing leader-attachment records preserved (dump did not describe the leader). */
  leadersPreserved: number;
  /** leaders the dump describes but whose bodyguards did not resolve to repo ids. */
  unresolvedLeaders: { id: string; names: string[] }[];
  /** human-readable role changes (id: old → new) for the report. */
  changes: { id: string; from: string; to: string }[];
}
export interface AttachmentReport {
  dirs: DirAttachmentResult[];
  staged: StagedWrite[];
}

/**
 * Derive `attachment_role` + `leader-attachments.json` for every faction dir (or one
 * via `onlyDir`). Pure over the dump + the on-disk repo; the caller persists via
 * {@link applyWrites}.
 */
export function runAttachmentRoles(dump: MfmDump, onlyDir?: string): AttachmentReport {
  const dirs = repoDirs();
  // Bucket non-Legends datasheets by candidate repo dir (home + shared-roster parents).
  const byDir = new Map<string, DatasheetRow[]>();
  for (const ds of dump.table("datasheet")) {
    if (ds.isLegends) continue;
    for (const dir of candidateDirs(dump, ds)) {
      if (!dirs.has(dir)) continue;
      (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(ds);
    }
  }

  const groupsByDs = dump.groupBy("datasheet_bodyguard_group", "datasheetId");
  const eligByGroup = dump.groupBy("datasheet_bodyguard_group_datasheet", "datasheetBodyguardGroupId");
  const keywordsByGroup = dump.groupBy("datasheet_bodyguard_group_keyword", "datasheetBodyguardGroupId");
  const excludedRosterByGroup = dump.groupBy(
    "datasheet_bodyguard_group_excluded_roster_datasheet",
    "datasheetBodyguardGroupId",
  );
  const requiredRosterByGroup = dump.groupBy(
    "datasheet_bodyguard_group_required_roster_datasheet",
    "datasheetBodyguardGroupId",
  );
  const dsById = dump.byId("datasheet");

  const results: DirAttachmentResult[] = [];
  const staged: StagedWrite[] = [];
  for (const dir of [...dirs].sort()) {
    if (onlyDir && dir !== onlyDir) continue;
    const upath = path.join(CORE_DIR, dir, "units.json");
    if (!fs.existsSync(upath)) continue;
    const lapath = path.join(CORE_DIR, dir, "leader-attachments.json");

    const units = readJsonArray<UnitRecord>(upath);
    const byId = new Map(units.map((u) => [u.id, u]));
    const unitIds = new Set(units.map((u) => u.id));
    const existingLa = readJsonArray<LeaderAttachmentRecord>(lapath);

    const res: DirAttachmentResult = {
      dir,
      matched: 0,
      rolesChanged: 0,
      leadersEmitted: 0,
      leadersPreserved: 0,
      unresolvedLeaders: [],
      changes: [],
    };

    // Home-faction datasheets before shared-roster imports, first-candidate-wins —
    // so a shared chassis (e.g. master-of-executions) gets its own faction's role.
    const dsList = (byDir.get(dir) ?? [])
      .slice()
      .sort((a, b) => homeScore(dump, a, dir) - homeScore(dump, b, dir));
    const matchedRepoIds = new Set<string>();
    const dumpLa = new Map<string, LeaderAttachmentRecord>();
    let unitsChanged = false;

    for (const ds of dsList) {
      if (isCombatPatrolDatasheet(dump, ds)) continue;
      const name = dump.enName(ds);
      if (!name) continue;
      let id: string;
      try {
        id = nameToId(name);
      } catch {
        continue;
      }
      const rec = byId.get(id);
      if (!rec || matchedRepoIds.has(id)) continue;
      const groups = groupsByDs.get(ds.id!) ?? [];
      if (!groups.length) continue; // not an attaching leader — leave its role alone
      matchedRepoIds.add(id);
      res.matched++;

      // ── attachment_role (leader-wins) ──
      const role: "leader" | "support" = groups.every((g) => g.bodyguardType === "support")
        ? "support"
        : "leader";
      if (rec.attachment_role !== role) {
        res.changes.push({ id, from: String(rec.attachment_role ?? "(none)"), to: role });
        rec.attachment_role = role;
        res.rolesChanged++;
        unitsChanged = true;
      }

      // Each conditional source group retains its own role and roster constraints;
      // flattening it into the unconditional pool would admit illegal attachments.
      const eligible = new Set<string>();
      const conditionalGroups: ConditionalAttachmentGroup[] = [];
      const unresolved: string[] = [];
      const keywords = new Set<string>();
      const rosterIds = (datasheetIds: readonly string[]): string[] =>
        datasheetIds.map((datasheetId) => {
          const rosterName = dump.enName(dsById.get(datasheetId));
          if (!rosterName) throw new Error(`Unresolved roster-condition datasheet ${datasheetId}`);
          const rosterId = nameToId(rosterName);
          if (!unitIds.has(rosterId)) {
            throw new Error(`Roster-condition unit ${rosterId} is absent from ${dir}`);
          }
          return rosterId;
        }).sort();
      for (const g of groups) {
        const bodyguards = new Set<string>();
        for (const j of eligByGroup.get(g.id) ?? []) {
          const bgName = dump.enName(dsById.get(j.datasheetId));
          if (!bgName) continue;
          let bgId: string;
          try {
            bgId = nameToId(bgName);
          } catch {
            continue;
          }
          if (unitIds.has(bgId)) bodyguards.add(bgId);
          else unresolved.push(bgName);
        }
        const required = requiredRosterByGroup.get(g.id) ?? [];
        const excluded = excludedRosterByGroup.get(g.id) ?? [];
        if (required.length || excluded.length) {
          if ((keywordsByGroup.get(g.id) ?? []).length) {
            throw new Error(`Conditional bodyguard group ${g.id} has keyword eligibility that cannot be represented`);
          }
          if (!bodyguards.size) {
            throw new Error(`Conditional bodyguard group ${g.id} has no resolvable bodyguard in ${dir}`);
          }
          conditionalGroups.push({
            role: g.bodyguardType === "support" ? "support" : "leader",
            eligible_bodyguard_ids: [...bodyguards].sort(),
            ...(required.length ? { required_roster_unit_ids: rosterIds(required.map((row) => row.datasheetId)) } : {}),
            ...(excluded.length ? { excluded_roster_unit_ids: rosterIds(excluded.map((row) => row.datasheetId)) } : {}),
          });
          continue;
        }
        for (const bgId of bodyguards) eligible.add(bgId);
        for (const kw of keywordsByGroup.get(g.id) ?? []) {
          const label = keywordLabel(dump, kw.keywordId);
          if (label) keywords.add(label);
        }
      }
      if (eligible.size || conditionalGroups.length) {
        dumpLa.set(id, {
          leader_id: id,
          eligible_bodyguard_ids: [...eligible].sort(),
          ...(keywords.size ? { eligible_bodyguard_keywords: [...keywords] } : {}),
          ...(conditionalGroups.length ? { conditional_groups: conditionalGroups } : {}),
          game_version: { ...CONFIRMED },
        });
      } else if (unresolved.length) {
        res.unresolvedLeaders.push({ id, names: [...new Set(unresolved)].sort() });
      }
    }

    if (unitsChanged) staged.push({ path: upath, value: units });

    // Merge eligibility by leader_id: dump record supersedes same-leader existing
    // record; existing records the dump did not produce are preserved (fallback).
    const merged = new Map<string, LeaderAttachmentRecord>();
    for (const e of existingLa) {
      if (dumpLa.has(e.leader_id)) continue; // dump wins
      merged.set(e.leader_id, e);
      res.leadersPreserved++;
    }
    for (const [lid, rec] of dumpLa) {
      merged.set(lid, rec);
      res.leadersEmitted++;
    }
    const mergedArr = [...merged.values()].sort((a, b) => a.leader_id.localeCompare(b.leader_id));
    // Stage iff the file content actually changes (or we have records for a new file).
    const before = existingLa.slice().sort((a, b) => a.leader_id.localeCompare(b.leader_id));
    if (mergedArr.length && JSON.stringify(before) !== JSON.stringify(mergedArr)) {
      staged.push({ path: lapath, value: mergedArr });
    }

    res.changes.sort((a, b) => a.id.localeCompare(b.id));
    res.unresolvedLeaders.sort((a, b) => a.id.localeCompare(b.id));
    results.push(res);
  }

  return { dirs: results, staged };
}

export function buildAttachmentReport(report: AttachmentReport, write: boolean): string {
  const { dirs } = report;
  const sum = (f: (d: DirAttachmentResult) => number) => dirs.reduce((a, d) => a + f(d), 0);
  const L: string[] = [];
  L.push(`# MFM attachment-role — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  L.push("Dump-primary `attachment_role` + `leader-attachments.json` from");
  L.push("`datasheet_bodyguard_group`. Leader-wins for mixed leader/support datasheets;");
  L.push("eligibility merged by `leader_id` (existing records preserved where the dump is silent).");
  L.push("");
  L.push("| Dir | Matched | Roles Δ | Leaders (dump) | Leaders (kept) | Unresolved leaders |");
  L.push("|---|--:|--:|--:|--:|--:|");
  for (const d of dirs.filter((d) => d.matched || d.leadersEmitted || d.leadersPreserved)) {
    L.push(
      `| ${d.dir} | ${d.matched} | ${d.rolesChanged} | ${d.leadersEmitted} | ${d.leadersPreserved} | ${d.unresolvedLeaders.length} |`,
    );
  }
  L.push(
    `| **TOTAL** | **${sum((d) => d.matched)}** | **${sum((d) => d.rolesChanged)}** | **${sum((d) => d.leadersEmitted)}** | **${sum((d) => d.leadersPreserved)}** | **${sum((d) => d.unresolvedLeaders.length)}** |`,
  );
  L.push("");
  for (const d of dirs) {
    if (!d.changes.length && !d.unresolvedLeaders.length) continue;
    L.push(`## ${d.dir}`);
    if (d.changes.length) {
      L.push("", "**attachment_role changes (old → new):**");
      d.changes.forEach((c) => L.push(`- \`${c.id}\`: ${c.from} → ${c.to}`));
    }
    if (d.unresolvedLeaders.length) {
      L.push("", "**Leaders the dump describes but whose bodyguards did not resolve (existing record kept):**");
      d.unresolvedLeaders.forEach((u) => L.push(`- \`${u.id}\` — ${u.names.join(", ")}`));
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}
