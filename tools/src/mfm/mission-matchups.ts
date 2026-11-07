/**
 * mission-matchups.ts — reconcile `mission-matchup` records against the GW MFM
 * dump (the `mission-matchups` ingest subcommand).
 *
 * The dump models the primary-mission-by-disposition matrix relationally in
 * `force_disposition_mission`: each row pairs a friendly + opposition force
 * disposition with the primary mission they play. The repo carries the same 25
 * pairings in `data/core/mission-matchups.json`. This pass re-derives them from
 * the dump so a future dataslate that re-pairs dispositions propagates
 * automatically instead of silently drifting from the authored copy.
 *
 * Id + fields are DERIVED from the dump:
 *   - id                    ← `${disposition}-vs-${opponent_disposition}`
 *   - disposition           ← friendlyForceDispositionId → force_disposition name
 *                             → repo disposition slug (dispositions.ts#dispositionIdMap).
 *   - opponent_disposition  ← oppositionForceDispositionId, same resolution.
 *   - mission_id            ← primaryMissionId → primary_mission name → nameToId
 *                             (matches missions.ts' `nameToId(en-name)` card ids).
 *
 * `game_version` is repo-authored; seeded records carry the dump's current dataslate.
 * Existing records are corrected field-by-field (dump is authoritative); a repo
 * record with no dump row is reported (possible removal), never deleted here.
 *
 * Like every MFM subcommand, mutations are applied in BOTH dry-run and write
 * modes and routed through {@link applyWrites}, which validates the projected
 * dataset (AJV + integrity) and only persists on --write.
 */
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import { formatCompact } from "../compact-json.js";
import { MfmDump } from "./loader.js";
import { dispositionIdMap } from "./dispositions.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import type { StagedWrite } from "./apply.js";
import { currentGameVersion } from "./dataslate.js";

const MATCHUPS_PATH = path.join(CORE_DIR, "mission-matchups.json");

interface MatchupRecord {
  id: string;
  disposition: string;
  opponent_disposition: string;
  mission_id: string;
  game_version?: { edition: string; dataslate: string };
  [k: string]: unknown;
}

export interface MatchupCanon {
  disposition: string;
  opponent_disposition: string;
  mission_id: string;
}

/** dump `force_disposition_mission` → repo matchup canon, keyed by matchup id.
 *  Rows whose disposition or mission id can't resolve are pushed to `unresolved`
 *  (never emitted as a partial record). */
export function buildMatchupCanon(dump: MfmDump, unresolved?: string[]): Map<string, MatchupCanon> {
  const disp = dispositionIdMap(dump);
  const missionId = new Map<string, string>();
  for (const m of dump.table("primary_mission")) {
    const name = dump.enName(m);
    if (!name) continue;
    try {
      missionId.set(m.id, nameToId(name));
    } catch {
      /* unsluggable name — leave unresolved */
    }
  }
  const out = new Map<string, MatchupCanon>();
  for (const r of dump.table("force_disposition_mission")) {
    const disposition = disp.get(r.friendlyForceDispositionId);
    const opponent = disp.get(r.oppositionForceDispositionId);
    const mission = missionId.get(r.primaryMissionId);
    if (!disposition || !opponent || !mission) {
      unresolved?.push(r.id);
      continue;
    }
    out.set(`${disposition}-vs-${opponent}`, {
      disposition,
      opponent_disposition: opponent,
      mission_id: mission,
    });
  }
  return out;
}

/** Repo matchup-ids the dump reconciles — reused so a golden inventory can't
 *  drift from what this pass actually matches. */
export function matchupInventory(dump: MfmDump): string[] {
  return [...buildMatchupCanon(dump).keys()];
}

export interface MatchupReport {
  matched: number;
  seeded: string[];
  corrected: { id: string; field: string; from: string; to: string }[];
  /** Authored records with no dump row (possible removal — reported, not deleted). */
  repoOnly: string[];
  /** Dump rows whose disposition/mission couldn't resolve to a repo slug. */
  unresolvedDump: string[];
  staged: StagedWrite[];
}

const FIELDS = ["disposition", "opponent_disposition", "mission_id"] as const;

export function runMissionMatchups(dump: MfmDump): MatchupReport {
  const confirmed = currentGameVersion(dump);
  const unresolvedDump: string[] = [];
  const canon = buildMatchupCanon(dump, unresolvedDump);
  const records = readJsonArray<MatchupRecord>(MATCHUPS_PATH);
  const byId = new Map(records.map((r) => [r.id, r]));

  const report: MatchupReport = {
    matched: 0,
    seeded: [],
    corrected: [],
    repoOnly: [],
    unresolvedDump,
    staged: [],
  };
  let dirty = false;

  for (const [id, c] of canon) {
    const rec = byId.get(id);
    if (!rec) {
      const seed: MatchupRecord = {
        id,
        disposition: c.disposition,
        opponent_disposition: c.opponent_disposition,
        mission_id: c.mission_id,
        game_version: { ...confirmed },
      };
      records.push(seed);
      byId.set(id, seed);
      report.seeded.push(id);
      dirty = true;
      continue;
    }
    report.matched++;
    for (const f of FIELDS) {
      if (rec[f] !== c[f]) {
        report.corrected.push({ id, field: f, from: String(rec[f]), to: c[f] });
        rec[f] = c[f];
        dirty = true;
      }
    }
  }

  const canonIds = new Set(canon.keys());
  report.repoOnly = records.filter((r) => !canonIds.has(r.id)).map((r) => r.id);

  if (dirty) {
    // Persist in the file's canonical compact style so the diff is only the
    // changed values, not a full reflow.
    report.staged.push({ path: MATCHUPS_PATH, value: records, text: formatCompact(records) });
  }
  return report;
}

export function buildMatchupReport(report: MatchupReport, write: boolean): string {
  const L: string[] = [];
  L.push(`# MFM mission-matchups — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  L.push("Re-derives the primary-mission-by-disposition matrix from the dump's");
  L.push("`force_disposition_mission` table (25 pairings). Dump is authoritative for");
  L.push("`disposition`/`opponent_disposition`/`mission_id`; `game_version` is authored.");
  L.push("");
  L.push("| Metric | Count |");
  L.push("|---|--:|");
  L.push(`| Matched | ${report.matched} |`);
  L.push(`| Seeded (dump-only) | ${report.seeded.length} |`);
  L.push(`| Corrected fields | ${report.corrected.length} |`);
  L.push(`| Repo-only (possible removal) | ${report.repoOnly.length} |`);
  L.push(`| Unresolved dump rows | ${report.unresolvedDump.length} |`);
  L.push("");
  if (report.seeded.length) {
    L.push("## Seeded", "");
    report.seeded.forEach((id) => L.push(`- ${id}`));
    L.push("");
  }
  if (report.corrected.length) {
    L.push("## Corrected (dump-authoritative)", "");
    report.corrected.forEach((c) => L.push(`- ${c.id} ${c.field}: ${c.from} → ${c.to}`));
    L.push("");
  }
  if (report.repoOnly.length) {
    L.push("## Repo-only — no dump pairing (review, not deleted)", "");
    report.repoOnly.forEach((id) => L.push(`- ${id}`));
    L.push("");
  }
  if (report.unresolvedDump.length) {
    L.push("## Unresolved dump rows", "");
    report.unresolvedDump.forEach((id) => L.push(`- ${id}`));
    L.push("");
  }
  return L.join("\n") + "\n";
}
