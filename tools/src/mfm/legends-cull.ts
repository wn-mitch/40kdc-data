/**
 * legends-cull.ts — drop dump-absent Legends/Forge-World units from the repo and
 * prune every reference to them.
 *
 * The MFM dump is the authoritative live roster. A repo unit whose name resolves
 * to NO live (non-isLegends) dump datasheet is a Legends/Forge-World holdover the
 * live game no longer carries. This is exactly the coverage "repo-only" signal.
 *
 * Drop criterion: unit id ∉ the global set of live datasheet name-slugs. The set
 * is global (routing-agnostic), so a culled unit matches no live datasheet
 * anywhere by construction. Two safety nets:
 *   - a sanity tripwire aborts --write if the cull is implausibly large (a future
 *     dump/matching regression), and
 *   - an advisory near-match check flags any culled unit whose slug is a prefix of
 *     (or shares a prefix with) a live datasheet slug — a possible rename/name-match
 *     bug — for review. It does NOT block the drop (the decision is to drop all
 *     dump-absent units), it just surfaces suspects.
 *
 * Prune cascade (inverse-keyed — these files point back at the unit):
 *   units.json               — remove the unit
 *   wargear-options.json     — remove entries whose unit_id was dropped
 *   unit-compositions.json   — remove entries whose unit_id was dropped
 *   leader-attachments.json  — remove entries whose leader_id was dropped; strip
 *                              dropped ids from eligible_bodyguard_ids (drop the
 *                              whole entry if it empties — schema minItems 1)
 *   weapons.json / wargear.json — remove items referenced by zero SURVIVING
 *                              unit.weapon_ids / wargear-option refs /
 *                              unit-composition models[].default_weapon_ids
 *
 * Enrichment abilities follow their units (see `ability-prune.ts`): dead `unit_ids`
 * are stripped, and an ability no surviving unit carries is removed with its phase
 * mappings. That pass runs against every surviving unit, so it also clears abilities
 * left behind by an earlier cull.
 */
import * as fs from "fs";
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import { MfmDump, type DatasheetRow } from "./loader.js";
import { readJsonArray, CORE_DIR } from "./repo-files.js";
import { repoDirForFactionName, repoDirs } from "./faction-map.js";
import { effectiveDir } from "./seed-units.js";
import type { StagedWrite } from "./apply.js";
import { pruneAbilities, type AbilityPrune } from "./ability-prune.js";



/** Above this total, assume a matching/dump regression and refuse to --write. */
const SANITY_MAX_DROP = 260;

interface Unit {
  id: string;
  name?: string;
  weapon_ids?: string[];
  is_legend?: boolean;
  [k: string]: unknown;
}
interface WargearOption {
  id?: string;
  unit_id: string;
  replaces?: string[];
  replacement?: string[];
  replacement_choice?: string[][];
  [k: string]: unknown;
}
interface CompModel {
  default_weapon_ids?: string[];
}
interface UnitComposition {
  unit_id: string;
  models?: CompModel[];
  [k: string]: unknown;
}
interface LeaderAttachment {
  leader_id: string;
  eligible_bodyguard_ids: string[];
  [k: string]: unknown;
}
interface IdItem {
  id?: string;
}



export interface DirCull {
  dir: string;
  dropped: { id: string; kind: "legends" | "forge-world"; flaggedLegend: boolean }[];
  suspicious: { id: string; near: string }[];
  wargearOptionsRemoved: number;
  compositionsRemoved: number;
  leaderEntriesRemoved: number;
  bodyguardRefsStripped: number;
  weaponsRemoved: string[];
  wargearRemoved: string[];
}
export interface CullReport {
  dirs: DirCull[];
  totalDropped: number;
  aborted: string | null; // reason, if the sanity tripwire fired
  abilities: AbilityPrune[];
  staged: StagedWrite[];
}

/** Build the global live + Legends datasheet name-slug sets from the dump, the live slugs routed
 *  to each repo dir (a supplement's datasheets file under its parent roster's dir), and the live
 *  datasheet ids. */
export function dumpSlugSets(dump: MfmDump): { live: Set<string>; legends: Set<string>; liveByDir: Map<string, Set<string>>; liveIds: Set<string> } {
  const live = new Set<string>();
  const legends = new Set<string>();
  const liveByDir = new Map<string, Set<string>>();
  const liveIds = new Set<string>();
  const fkNames = dump.byId("faction_keyword");
  for (const ds of dump.table("datasheet")) {
    const n = dump.enName(ds);
    if (!n) continue;
    let id: string;
    try {
      id = nameToId(n);
    } catch {
      continue;
    }
    (ds.isLegends ? legends : live).add(id);
    if (ds.isLegends) continue;
    liveIds.add(ds.id);
    const fk = dump.factionKeywordOfDatasheet(ds.id);
    const routed = fk ? repoDirForFactionName(dump.enName(fkNames.get(fk))) : null;
    const dir = routed ? (effectiveDir(routed) ?? routed) : null;
    if (dir) (liveByDir.get(dir) ?? liveByDir.set(dir, new Set()).get(dir)!).add(id);
  }
  return { live, legends, liveByDir, liveIds };
}

/** Advisory: a culled slug that is a prefix of (or shares a prefix with) a live
 * slug *whose unit the repo doesn't already have* may be the same unit under a
 * drifted name — surface it without blocking. A live base that IS a repo unit
 * (e.g. `land-raider` for the dropped `land-raider-achilles`) is a genuine
 * distinct variant, not a drift, so it is not flagged. */
function nearLiveSlug(droppedId: string, live: Set<string>, repoUnitIds: Set<string>): string | undefined {
  if (droppedId.length < 5) return undefined;
  for (const liveId of live) {
    if (liveId === droppedId || repoUnitIds.has(liveId)) continue;
    if (liveId.startsWith(droppedId) || droppedId.startsWith(liveId)) return liveId;
  }
  return undefined;
}

/**
 * Live in THIS dir: the unit links a live datasheet, or a live datasheet its dir's books print has
 * its name. A same-named datasheet in another faction's book (the Grey Knights Razorback) does not
 * keep a Space Marine copy that only Legends still prints.
 */
export function liveInDir(
  unit: { id: string; external_refs?: { namespace?: string; id?: string }[] },
  dir: string,
  sets: { liveByDir: Map<string, Set<string>>; liveIds: Set<string> },
): boolean {
  const refs = (unit.external_refs ?? []).filter((r) => r.namespace === "mfm" && r.id).map((r) => r.id!);
  return refs.some((m) => sets.liveIds.has(m)) || (sets.liveByDir.get(dir)?.has(unit.id) ?? false);
}

export function runCull(dump: MfmDump, write: boolean): CullReport {
  const { live, legends, liveByDir, liveIds } = dumpSlugSets(dump);

  // First pass (read-only): compute drops per dir and the grand total, so the
  // sanity tripwire can refuse a write BEFORE any file is touched.
  interface DirData {
    dir: string;
    units: Unit[];
    options: WargearOption[];
    comps: UnitComposition[];
    dropList: Unit[];
    droppedIds: Set<string>;
  }
  const all: DirData[] = [];
  const allRepoUnitIds = new Set<string>();
  // GLOBAL set of weapon/wargear ids still referenced by a surviving entity in
  // ANY faction. Orphan removal is global: weapon ids are duplicated across
  // factions (often with divergent stats), and the loadout resolver picks the
  // first match in the merged bundle — so removing a still-used id from one
  // faction would shift another faction's resolution. A weapon kept anywhere is
  // kept everywhere; only ids referenced nowhere are truly orphaned.
  const globalReferenced = new Set<string>();
  for (const dir of [...repoDirs()].sort()) {
    const units = readJsonArray<Unit>(path.join(CORE_DIR, dir, "units.json"));
    if (!units.length) continue;
    for (const u of units) allRepoUnitIds.add(u.id);
    const dropList = units.filter((u) => !liveInDir(u, dir, { liveByDir, liveIds }));
    const droppedIds = new Set(dropList.map((u) => u.id));
    const options = readJsonArray<WargearOption>(path.join(CORE_DIR, dir, "wargear-options.json"));
    const comps = readJsonArray<UnitComposition>(path.join(CORE_DIR, dir, "unit-compositions.json"));
    for (const u of units)
      if (!droppedIds.has(u.id)) for (const w of u.weapon_ids ?? []) globalReferenced.add(w);
    for (const o of options)
      if (!droppedIds.has(o.unit_id)) {
        for (const w of o.replaces ?? []) globalReferenced.add(w);
        for (const w of o.replacement ?? []) globalReferenced.add(w);
        for (const grp of o.replacement_choice ?? []) for (const w of grp) globalReferenced.add(w);
      }
    for (const c of comps)
      if (!droppedIds.has(c.unit_id))
        for (const m of c.models ?? []) for (const w of m.default_weapon_ids ?? []) globalReferenced.add(w);
    all.push({ dir, units, options, comps, dropList, droppedIds });
  }
  const totalDropped = all.reduce((n, d) => n + d.dropList.length, 0);
  if (totalDropped > SANITY_MAX_DROP) {
    return {
      dirs: [],
      totalDropped,
      aborted: `cull set is ${totalDropped} units (> ${SANITY_MAX_DROP}) — implausible; refusing to write. Inspect the dump / name matching before proceeding.`,
      staged: [],
      abilities: [],
    };
  }

  const dirs: DirCull[] = [];
  const staged: StagedWrite[] = [];
  for (const { dir, units, options, comps, dropList, droppedIds } of all) {
    if (!dropList.length) continue;
    const res: DirCull = {
      dir,
      dropped: [],
      suspicious: [],
      wargearOptionsRemoved: 0,
      compositionsRemoved: 0,
      leaderEntriesRemoved: 0,
      bodyguardRefsStripped: 0,
      weaponsRemoved: [],
      wargearRemoved: [],
    };

    for (const u of dropList) {
      res.dropped.push({
        id: u.id,
        kind: legends.has(u.id) ? "legends" : "forge-world",
        flaggedLegend: u.is_legend === true,
      });
      const near = nearLiveSlug(u.id, live, allRepoUnitIds);
      if (near) res.suspicious.push({ id: u.id, near });
    }

    const survivingUnits = units.filter((u) => !droppedIds.has(u.id));
    const optPath = path.join(CORE_DIR, dir, "wargear-options.json");
    const survivingOptions = options.filter((o) => !droppedIds.has(o.unit_id));
    res.wargearOptionsRemoved = options.length - survivingOptions.length;
    const compPath = path.join(CORE_DIR, dir, "unit-compositions.json");
    const survivingComps = comps.filter((c) => !droppedIds.has(c.unit_id));
    res.compositionsRemoved = comps.length - survivingComps.length;

    // leader-attachments
    const leaderPath = path.join(CORE_DIR, dir, "leader-attachments.json");
    const leaders = readJsonArray<LeaderAttachment>(leaderPath);
    const survivingLeaders: LeaderAttachment[] = [];
    for (const la of leaders) {
      if (droppedIds.has(la.leader_id)) {
        res.leaderEntriesRemoved++;
        continue;
      }
      const kept = la.eligible_bodyguard_ids.filter((b) => !droppedIds.has(b));
      const stripped = la.eligible_bodyguard_ids.length - kept.length;
      res.bodyguardRefsStripped += stripped;
      if (kept.length === 0) {
        // every eligible bodyguard was a dropped unit — the attachment is dead
        res.leaderEntriesRemoved++;
        continue;
      }
      survivingLeaders.push(stripped ? { ...la, eligible_bodyguard_ids: kept } : la);
    }

    // orphan weapons/wargear: referenced by zero surviving entity ANYWHERE (global)
    const weaponsPath = path.join(CORE_DIR, dir, "weapons.json");
    const weapons = readJsonArray<IdItem>(weaponsPath);
    const survivingWeapons = weapons.filter((w) => w.id && globalReferenced.has(w.id));
    res.weaponsRemoved = weapons.filter((w) => w.id && !globalReferenced.has(w.id)).map((w) => w.id!).sort();

    const wargearPath = path.join(CORE_DIR, dir, "wargear.json");
    const wargear = readJsonArray<IdItem>(wargearPath);
    const survivingWargear = wargear.filter((w) => w.id && globalReferenced.has(w.id));
    res.wargearRemoved = wargear.filter((w) => w.id && !globalReferenced.has(w.id)).map((w) => w.id!).sort();

    // Stage the surviving sets in BOTH modes (same per-file conditions as the prior
    // write) so the dry-run rehearsal validates the post-cull tree — catching e.g. a
    // surviving option/composition that referenced a now-dropped unit. applyWrites
    // persists all-or-nothing only on --write.
    staged.push({ path: path.join(CORE_DIR, dir, "units.json"), value: survivingUnits });
    if (fs.existsSync(optPath) && res.wargearOptionsRemoved)
      staged.push({ path: optPath, value: survivingOptions });
    if (fs.existsSync(compPath) && res.compositionsRemoved)
      staged.push({ path: compPath, value: survivingComps });
    if (fs.existsSync(leaderPath) && (res.leaderEntriesRemoved || res.bodyguardRefsStripped))
      staged.push({ path: leaderPath, value: survivingLeaders });
    if (fs.existsSync(weaponsPath) && res.weaponsRemoved.length)
      staged.push({ path: weaponsPath, value: survivingWeapons });
    if (fs.existsSync(wargearPath) && res.wargearRemoved.length)
      staged.push({ path: wargearPath, value: survivingWargear });

    dirs.push(res);
  }

  const surviving = new Map(all.map((d) => [d.dir, d.units.filter((u) => !d.droppedIds.has(u.id))]));
  const abilities = pruneAbilities(surviving as Map<string, { id: string; ability_ids?: string[] }[]>);
  staged.push(...abilities.staged);
  return { dirs, totalDropped, aborted: null, staged, abilities: abilities.dirs };
}

export function buildCullReport(report: CullReport, write: boolean): string {
  const { dirs, totalDropped, aborted } = report;
  const L: string[] = [];
  L.push(`# MFM Legends cull — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  if (aborted) {
    L.push(`> **ABORTED** — ${aborted}`);
    L.push("");
    return L.join("\n") + "\n";
  }
  L.push(
    "Drops repo units absent from the live (non-Legends) dump and prunes their wargear-options,"
  );
  L.push(
    "unit-compositions, leader-attachment refs, and now-orphaned weapons/wargear. Abilities follow"
  );
  L.push("their units: dead `unit_ids` are stripped, and an ability no surviving unit carries is removed.");
  L.push("");
  const sum = (f: (d: DirCull) => number) => dirs.reduce((a, d) => a + f(d), 0);
  L.push(
    "| Dir | Units dropped | (legends/FW) | Wargear-opts | Comps | Leader entries | Bodyguard refs | Weapons | Wargear |"
  );
  L.push("|---|--:|:--|--:|--:|--:|--:|--:|--:|");
  for (const d of dirs) {
    const leg = d.dropped.filter((x) => x.kind === "legends").length;
    const fw = d.dropped.filter((x) => x.kind === "forge-world").length;
    L.push(
      `| ${d.dir} | ${d.dropped.length} | ${leg}/${fw} | ${d.wargearOptionsRemoved} | ${d.compositionsRemoved} | ${d.leaderEntriesRemoved} | ${d.bodyguardRefsStripped} | ${d.weaponsRemoved.length} | ${d.wargearRemoved.length} |`
    );
  }
  L.push(
    `| **TOTAL** | **${totalDropped}** | ${sum((d) => d.dropped.filter((x) => x.kind === "legends").length)}/${sum((d) => d.dropped.filter((x) => x.kind === "forge-world").length)} | **${sum((d) => d.wargearOptionsRemoved)}** | **${sum((d) => d.compositionsRemoved)}** | **${sum((d) => d.leaderEntriesRemoved)}** | **${sum((d) => d.bodyguardRefsStripped)}** | **${sum((d) => d.weaponsRemoved.length)}** | **${sum((d) => d.wargearRemoved.length)}** |`
  );
  L.push("");

  const suspicious = dirs.flatMap((d) => d.suspicious.map((s) => ({ dir: d.dir, ...s })));
  if (suspicious.length) {
    L.push("## ⚠ Possible name-match bugs (dropped anyway — review)");
    L.push("");
    L.push("A dropped unit whose slug closely matches a live dump unit — could be the same");
    L.push("unit under a drifted name rather than a true Legends entry.");
    L.push("");
    for (const s of suspicious) L.push(`- ${s.dir}/${s.id} ~ live \`${s.near}\``);
    L.push("");
  }

  for (const d of dirs) {
    if (!d.dropped.length) continue;
    L.push(`## ${d.dir} — dropped ${d.dropped.length}`);
    L.push("");
    for (const x of d.dropped)
      L.push(`- ${x.id} (${x.kind}${x.flaggedLegend ? ", is_legend" : ""})`);
    if (d.weaponsRemoved.length) L.push("", `**Weapons removed (orphaned):** ${d.weaponsRemoved.join(", ")}`);
    if (d.wargearRemoved.length) L.push("", `**Wargear removed (orphaned):** ${d.wargearRemoved.join(", ")}`);
    L.push("");
  }
  if (report.abilities.length) {
    L.push("## Abilities", "");
    L.push("| Dir | Removed | Unit refs stripped | Phase mappings removed |");
    L.push("|---|--:|--:|--:|");
    for (const a of report.abilities)
      L.push(`| ${a.dir} | ${a.removed.length} | ${a.unitRefsStripped} | ${a.phaseMappingsRemoved} |`);
    L.push("");
    for (const a of report.abilities)
      if (a.removed.length) L.push(`- ${a.dir}: ${a.removed.join(", ")}`);
    L.push("");
  }
  return L.join("\n") + "\n";
}
