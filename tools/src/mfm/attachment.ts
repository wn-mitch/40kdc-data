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
 *     **leader-wins** for the 11 mixed datasheets (Lieutenant, Judiciar, …) whose
 *     `support` rows are detachment-scoped (`requiredDetachmentId`): a unit is
 *     `support` only when *all* its groups are `support`; any `leader` group →
 *     `leader`. The repo's flat field can't carry detachment scope, and `support`
 *     ("must attach") is the more-constraining value, so leader-wins never
 *     over-constrains a solo-capable character. This is the bug fix: WE Master of
 *     Executions (a single `leader` group) flips from the scrape's wrong `support`
 *     to `leader`; the CSM MoE (all `support`) stays `support`.
 *   - `leader-attachments.json` eligibility (`leader_id → eligible_bodyguard_ids`),
 *     rebuilt from the junction.
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
import { candidateDirs, homeScore } from "./wargear.js";
import { currentGameVersion } from "./dataslate.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import type { StagedWrite } from "./apply.js";

interface UnitRecord {
  id: string;
  attachment_role?: "leader" | "support" | null;
  keywords?: string[];
  faction_keywords?: string[];
  [k: string]: unknown;
}
interface LeaderAttachmentRecord {
  leader_id: string;
  eligible_bodyguard_ids: string[];
  eligible_bodyguard_keywords?: string[];
  game_version: { edition: string; dataslate: string };
  [k: string]: unknown;
}



/** True when a datasheet's publication is a Combat Patrol box (excluded). */
function isCombatPatrolDatasheet(dump: MfmDump, ds: DatasheetRow): boolean {
  const pub = dump.byId("publication").get(ds.publicationId);
  return !!pub?.isCombatPatrol;
}


/**
 * The record's `eligible_bodyguard_keywords` from a leader's keyword groups. The field holds one
 * clause whose keywords a unit must all carry, so a single keyword group becomes that clause.
 * Several keyword groups are alternatives ("can lead an X or a Y unit"), which one clause cannot
 * say: each group's clause is resolved to the units in this faction that meet it, added to
 * `eligible`, and no clause is kept.
 */
export function keywordEligibility(clauses: readonly string[][], units: readonly UnitRecord[], eligible: Set<string>): string[] | undefined {
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  for (const clause of clauses) {
    for (const unit of units) {
      const own = new Set([...(unit.keywords ?? []), ...(unit.faction_keywords ?? [])].map((keyword) => keyword.toLowerCase()));
      if (clause.every((keyword) => own.has(keyword.toLowerCase()))) eligible.add(unit.id);
    }
  }
  return undefined;
}

export interface DirAttachmentResult {
  dir: string;
  /** datasheets with a bodyguard group matched to a repo unit in this dir. */
  matched: number;
  rolesChanged: number;
  /** leader-attachment records emitted from the dump (≥1 resolvable bodyguard). */
  leadersEmitted: number;
  /** leader ids of the records emitted from the dump. */
  emittedLeaderIds: string[];
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
  const confirmed = currentGameVersion(dump);
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
      emittedLeaderIds: [],
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

      // ── eligibility: junction bodyguard datasheets → repo unit ids in this dir ──
      const eligible = new Set<string>();
      const unresolved: string[] = [];
      // Keyword-based eligibility ("any unit with ALL these keywords qualifies", e.g.
      // an Inquisitor leading any IMPERIUM BATTLELINE INFANTRY unit). Dump-edge order
      // is GW's canonical keyword order, so the insertion-ordered Set preserves it —
      // no sort, which would spuriously reorder the authored value.
      // Each group is one alternative; within a group, its keywords all apply.
      const clauses: string[][] = [];
      for (const g of groups) {
        for (const j of eligByGroup.get(g.id) ?? []) {
          const bgName = dump.enName(dsById.get(j.datasheetId));
          if (!bgName) continue;
          let bgId: string;
          try {
            bgId = nameToId(bgName);
          } catch {
            continue;
          }
          if (unitIds.has(bgId)) eligible.add(bgId);
          else unresolved.push(bgName);
        }
        const clause = new Set<string>();
        for (const kw of keywordsByGroup.get(g.id) ?? []) {
          const label = keywordLabel(dump, kw.keywordId);
          if (label) clause.add(label);
        }
        if (clause.size) clauses.push([...clause]);
      }
      const keywords = keywordEligibility(clauses, units, eligible);
      if (eligible.size) {
        // eligible_bodyguard_keywords is additive to the required ids (schema mandates
        // ≥1 id); a keyword-only leader cannot be represented, so it rides an id record.
        dumpLa.set(id, {
          leader_id: id,
          eligible_bodyguard_ids: [...eligible].sort(),
          ...(keywords ? { eligible_bodyguard_keywords: keywords } : {}),
          game_version: { ...confirmed },
        });
      } else if (unresolved.length) {
        // Dump describes this leader but no bodyguard resolved — skip emitting (schema
        // requires minItems:1); the existing record (if any) is preserved below.
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
      res.emittedLeaderIds.push(lid);
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
