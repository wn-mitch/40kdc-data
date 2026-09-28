/**
 * allies.ts — regenerate `data/core/allies.json` from the GW MFM dump's
 * `allied_faction` table family.
 *
 * The list-builder only ever offered ally pools for the few hand-authored rules
 * (Chaos soup + Genestealer Cults); every other faction showed an empty Allies
 * panel, pushing players to swap the army faction (which wipes enhancements).
 * GW's dump already encodes every faction's ally restrictions structurally, so
 * this extractor mirrors them wholesale: one {@link AlliedRuleOut} per
 * `allied_faction` row, with its host keyword gate, detachment gate, explicit
 * datasheet allowlist, points caps, per-keyword count caps, enhancement/warlord
 * locks and the specific characters allowed to be Warlord.
 *
 * Resolution is name-based: the dump carries GW GUIDs, our entities carry
 * `nameToId`-derived kebab ids, so a datasheet/detachment/keyword English name
 * slugged with {@link nameToId} matches our id. A pool that resolves to zero
 * datasheets is skipped and logged (today: the two Titan pools, whose datasheets
 * are not yet ported into `data/core`); a partially-resolving pool emits with its
 * resolved members and logs the rest.
 *
 * The dump has no display names for these rules and a couple of constraints that
 * live only in rules prose (Daemonic Pact's per-god Battleline ratio, Brood
 * Brothers' removed ability + GSC-Warlord requirement). A small curated
 * {@link OVERLAY}, keyed by the dump's `allied_faction` GUID, supplies stable
 * ids/labels/names and those text-only fields, preserving existing rule ids
 * where a pool maps onto a current hand-authored rule.
 */
import { readdirSync } from "node:fs";
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import {
  MfmDump,
  type AlliedFactionDatasheetRow,
  type AlliedFactionKeywordRow,
  type AlliedFactionPointsLimitRow,
  type AlliedFactionRequiredDetachmentRow,
  type AlliedFactionRow,
  type BattleSizeRow,
  type DatasheetRow,
  type DetachmentRow,
  type FactionKeywordAlliedFactionRow,
  type FactionKeywordRow,
  type KeywordRow,
  type MiniatureRow,
} from "./loader.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import type { StagedWrite } from "./apply.js";


// ─────────────────── output shape ───────────────────

type BattleSizeEnum = "incursion" | "strike-force" | "onslaught";

interface AlliedKeywordLimitOut {
  keyword: string;
  battle_size: BattleSizeEnum;
  max_count: number;
}
interface AlliedPointsLimitOut {
  battle_size: BattleSizeEnum;
  max_points: number;
}
/** Mirrors the AlliedRule schema; built field-by-field so the JSON diff stays readable. */
interface AlliedRuleOut {
  id: string;
  name: string;
  label?: string;
  army_keywords_any?: string[];
  detachment_ids?: string[];
  source_faction_id?: string;
  source_datasheet_ids?: string[];
  points_limits?: AlliedPointsLimitOut[];
  keyword_limits?: AlliedKeywordLimitOut[];
  cannot_be_warlord?: boolean;
  cannot_take_enhancements?: boolean;
  warlord_datasheet_ids?: string[];
  warlord_required_keyword?: string;
  removes_ability_ids?: string[];
  battleline_ratio_keywords?: string[];
  game_version: { edition: string; dataslate: string };
  notes?: string;
}

const GAME_VERSION = { edition: "11th", dataslate: "pre-launch-provisional" };

// ─────────────────── curated overlay (keyed by allied_faction GUID) ───────────────────

interface OverlayEntry {
  id: string;
  name: string;
  label: string;
  notes?: string;
  battleline_ratio_keywords?: string[];
  removes_ability_ids?: string[];
  warlord_required_keyword?: string;
}

/**
 * Stable id/name/label per GW pool plus the few prose-only constraints the dump
 * tables don't carry. Ids match the current hand-authored rules where a pool
 * maps onto one, so existing share tokens keep resolving for those. The two
 * Titan GUIDs are intentionally absent — they resolve to zero datasheets and are
 * skipped, not authored.
 */
const OVERLAY: Record<string, OverlayEntry> = {
  "2c3e6117-fa73-4efc-9ec0-ce49dc1f92ce": {
    id: "daemonic-pact",
    name: "Daemonic Pact",
    label: "Daemons",
    battleline_ratio_keywords: ["Khorne", "Tzeentch", "Nurgle", "Slaanesh"],
    notes:
      "Shared by Chaos Knights and Heretic Astartes armies. Per-god Battleline ratio: non-Battleline units of a god included this way cannot exceed Battleline units of that god included this way.",
  },
  "22b393df-b22e-41e5-a6bc-5f3f5af6e041": {
    id: "iconoclast-fiefdom-damned",
    name: "Iconoclast Fiefdom — Wretched Thralls",
    label: "Damned",
  },
  "a814d19e-0e59-458e-be17-84405a5a997e": {
    id: "brood-brothers",
    name: "Brood Brothers",
    label: "Brood Brothers",
    removes_ability_ids: ["voice-of-command-astra-militarum"],
    warlord_required_keyword: "Genestealer Cults",
    notes:
      "A Genestealer Cults army may include ASTRA MILITARUM units. A GENESTEALER CULTS model must be the Warlord; included Astra Militarum models lose Voice of Command.",
  },
  "00983515-39af-4945-9345-6cef812df85a": {
    id: "star-childrens-blessings",
    name: "The Star Children's Blessings",
    label: "Tyranids",
  },
  "6d007a58-b5ca-445b-8882-2e04ef3de422": {
    id: "world-eaters-khorne-daemons",
    name: "World Eaters — Khorne Daemons Allies",
    label: "Daemons of Khorne",
  },
  "daf6b1ee-6f0e-4f0d-b61b-09fad4f5fce1": {
    id: "death-guard-nurgle-daemons",
    name: "Death Guard — Nurgle Daemons Allies",
    label: "Daemons of Nurgle",
  },
  "e94941b5-db69-4f97-ae04-d2473eb18d8e": {
    id: "emperors-children-slaanesh-daemons",
    name: "Emperor's Children — Slaanesh Daemons Allies",
    label: "Daemons of Slaanesh",
  },
  "0360d685-082a-4a2c-ac55-cc54f9728982": {
    id: "thousand-sons-tzeentch-daemons",
    name: "Thousand Sons — Tzeentch Daemons Allies",
    label: "Daemons of Tzeentch",
  },
  "6d4e8d4c-f87a-4722-a7de-67638a6c98b5": {
    id: "chaos-knights-allies",
    name: "Chaos Knights Allies",
    label: "Chaos Knights",
  },
  "572c1fa2-6073-46ca-b933-e7d49bf3c9f9": {
    id: "chaos-daemons-shadow-legion",
    name: "Shadow Legion",
    label: "Heretic Astartes",
  },
  "dc938d45-5631-49ef-9150-670f01620798": {
    id: "agents-of-the-imperium-allies",
    name: "Agents of the Imperium",
    label: "Imperial Agents",
  },
  "be1bdcb9-29ef-41fa-aca7-cef778b7a1be": {
    id: "agents-of-the-imperium-deathwatch",
    name: "Agents of the Imperium — Deathwatch",
    label: "Imperial Agents",
  },
  "2905bc88-e9cd-484f-a477-9757bdfd98be": {
    id: "imperial-knights-questor-forgepact",
    name: "Questor Forgepact",
    label: "Questor Forgepact",
  },
  "ab5961ee-a678-4fc4-9547-2c6af45bfe8e": {
    id: "imperial-knights-allies",
    name: "Questoris Allies",
    label: "Questoris Allies",
  },
  "a83eaa78-8fd7-4e56-a324-869e933376d5": {
    id: "chaos-space-marines-renegades",
    name: "Renegades",
    label: "Renegades",
  },
  "bc1730e1-c1bc-4826-b9a3-8b656df87360": {
    id: "drukhari-aeldari",
    name: "Aeldari Allies",
    label: "Aeldari",
  },
  "2659fb9c-fb1f-4537-b108-8bca2f10fdc4": {
    id: "drukhari-harlequins",
    name: "Harlequins",
    label: "Harlequins",
  },
  "a80f5c03-528e-4dde-89f2-d125029dcc35": {
    id: "aeldari-harlequins",
    name: "Harlequins",
    label: "Harlequins",
  },
  "f9cc7f92-32ee-4494-99b3-1ca01c84252f": {
    id: "aeldari-ynnari",
    name: "Ynnari",
    label: "Ynnari",
  },
};

// ─────────────────── helpers ───────────────────

interface CoreUnit {
  id: string;
  name: string;
  faction_id: string;
}
interface CoreEntity {
  id: string;
}



/** Faction dirs under data/core (skipping the `_`-prefixed bookkeeping dirs). */
function coreDirs(): string[] {
  return readdirSync(CORE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);
}

/** unit id → the set of faction ids that own a copy of it (a chassis can be shared). */
function loadUnitFactions(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const dir of coreDirs()) {
    for (const u of readJsonArray<CoreUnit>(path.join(CORE_DIR, dir, "units.json"))) {
      const set = out.get(u.id) ?? out.set(u.id, new Set()).get(u.id)!;
      set.add(u.faction_id);
    }
  }
  return out;
}

/** Every detachment id authored across data/core. */
function loadDetachmentIds(): Set<string> {
  const out = new Set<string>();
  for (const dir of coreDirs()) {
    for (const d of readJsonArray<CoreEntity>(path.join(CORE_DIR, dir, "detachments.json"))) {
      out.add(d.id);
    }
  }
  return out;
}

/** Safe slug — null instead of throwing on an unsluggable name. */
function slug(name: string | undefined): string | null {
  if (!name) return null;
  try {
    return nameToId(name);
  } catch {
    return null;
  }
}

const BATTLE_SIZE_ORDER: Record<BattleSizeEnum, number> = {
  incursion: 0,
  "strike-force": 1,
  onslaught: 2,
};

// ─────────────────── report ───────────────────

export interface AlliesReport {
  rules: AlliedRuleOut[];
  /** Per emitted pool: a one-line coverage record. */
  emitted: {
    id: string;
    hosts: string[];
    sourceFaction: string | null;
    datasheets: number;
    detachments: number;
    warlordDatasheets: number;
    keywordLimits: number;
  }[];
  /** Pools resolving to zero datasheets (skipped, not emitted). */
  skipped: { guid: string; label: string; missingDatasheets: string[] }[];
  /** Per pool: datasheet/detachment names that did not resolve to a data/core id. */
  unresolved: { guid: string; id: string; datasheets: string[]; detachments: string[] }[];
  /** GUIDs with resolvable datasheets but absent from OVERLAY (a new GW pool). */
  unknownPools: string[];
  staged: StagedWrite[];
}

// ─────────────────── extractor ───────────────────

export function runAllies(dump: MfmDump): AlliesReport {
  const unitFactions = loadUnitFactions();
  const detachmentIds = loadDetachmentIds();

  const fk = dump.byId("faction_keyword");
  const ds = dump.byId("datasheet");
  const det = dump.byId("detachment");
  const kw = dump.byId("keyword");
  const mini = dump.byId("miniature");

  const hostsByAf = dump.groupBy("faction_keyword_allied_faction", "alliedFactionId");
  const dsByAf = dump.groupBy("allied_faction_datasheet", "alliedFactionId");
  const detByAf = dump.groupBy("allied_faction_required_detachment", "alliedFactionId");
  const ptsByAf = dump.groupBy("allied_faction_points_limit", "alliedFactionId");
  const kwLimByAf = dump.groupBy("allied_faction_keyword", "alliedFactionId");
  const warlordByAf = dump.groupBy("allied_faction_allowed_warlord_miniature", "alliedFactionId");
  // The pool's "source" faction keyword(s) — used for labels/skip logging when
  // the overlay has no entry (a new GW pool, or a skipped Titan pool).
  const parentByAf = dump.groupBy("allied_faction_parent_faction_keyword", "alliedFactionId");

  // battle_size GUID → enum.
  const battleSizeEnum = new Map<string, BattleSizeEnum>();
  const BS_NAME_TO_ENUM: Record<string, BattleSizeEnum> = {
    Incursion: "incursion",
    "Strike Force": "strike-force",
    Onslaught: "onslaught",
  };
  for (const bs of dump.table("battle_size")) {
    const e = BS_NAME_TO_ENUM[dump.enName(bs) ?? ""];
    if (bs.id && e) battleSizeEnum.set(bs.id, e);
  }

  const report: AlliesReport = {
    rules: [],
    emitted: [],
    skipped: [],
    unresolved: [],
    unknownPools: [],
    staged: [],
  };

  for (const af of dump.table("allied_faction")) {
    const overlay = OVERLAY[af.id];

    // (2) datasheets → resolved unit ids + the faction(s) each lives in.
    const resolved: { id: string; factions: Set<string> }[] = [];
    const missingDatasheets: string[] = [];
    for (const row of dsByAf.get(af.id) ?? []) {
      const name = dump.enName(ds.get(row.datasheetId));
      const id = slug(name);
      const factions = id ? unitFactions.get(id) : undefined;
      if (!id || !factions) {
        missingDatasheets.push(name ?? row.datasheetId);
        continue;
      }
      resolved.push({ id, factions });
    }

    const parentNames = [
      ...new Set(
        (parentByAf.get(af.id) ?? [])
          .map((r) => dump.enName(fk.get(r.factionKeywordId)))
          .filter((n): n is string => !!n)
      ),
    ];
    const label = overlay?.label ?? (parentNames.join(" / ") || af.id);

    if (resolved.length === 0) {
      report.skipped.push({ guid: af.id, label, missingDatasheets });
      continue;
    }

    // (3) source faction = intersection of every resolved datasheet's factions.
    let intersection: Set<string> | null = null;
    for (const r of resolved) {
      if (intersection === null) {
        intersection = new Set(r.factions);
      } else {
        const prev: Set<string> = intersection;
        intersection = new Set([...prev].filter((f) => r.factions.has(f)));
      }
    }
    const sourceFaction = intersection && intersection.size === 1 ? [...intersection][0] : null;

    // (4) datasheet allowlist (scoped to the source faction when known).
    const datasheetIds = [
      ...new Set(
        resolved
          .filter((r) => (sourceFaction ? r.factions.has(sourceFaction) : true))
          .map((r) => r.id)
      ),
    ].sort();

    // (1) host keyword gate.
    const hosts = [
      ...new Set(
        (hostsByAf.get(af.id) ?? [])
          .map((r) => dump.enName(fk.get(r.factionKeywordId)))
          .filter((n): n is string => !!n)
      ),
    ].sort();

    // (5) detachment gate.
    const dets: string[] = [];
    const missingDetachments: string[] = [];
    for (const row of detByAf.get(af.id) ?? []) {
      const name = dump.enName(det.get(row.detachmentId));
      const id = slug(name);
      if (id && detachmentIds.size > 0 && detachmentIds.has(id)) dets.push(id);
      else missingDetachments.push(name ?? row.detachmentId);
    }
    const detIds = [...new Set(dets)].sort();

    // (6) points caps.
    const pointsLimits: AlliedPointsLimitOut[] = (ptsByAf.get(af.id) ?? [])
      .map((r) => ({ battle_size: battleSizeEnum.get(r.battleSizeId), max_points: r.pointsLimit }))
      .filter((p): p is AlliedPointsLimitOut => p.battle_size !== undefined)
      .sort((a, b) => BATTLE_SIZE_ORDER[a.battle_size] - BATTLE_SIZE_ORDER[b.battle_size]);

    // (9) warlord allowlist: allowed-warlord minis (+ a required mini) → datasheets.
    // The association table is unobserved as of data_version 895 (emptied by
    // the app export), so its generated row type carries no fields; keep
    // consuming it loosely so rows re-enter the allowlist when a future
    // snapshot repopulates the table.
    const warlordMiniIds = new Set(
      (warlordByAf.get(af.id) ?? [])
        .map((r) => (r as { miniatureId?: string }).miniatureId)
        .filter((id): id is string => typeof id === "string")
    );
    if (af.requiredWarlordMiniatureId) warlordMiniIds.add(af.requiredWarlordMiniatureId);
    const warlordDatasheetIds = [
      ...new Set(
        [...warlordMiniIds]
          .map((mid) => slug(dump.enName(ds.get(mini.get(mid)?.datasheetId ?? ""))))
          .filter((id): id is string => !!id && unitFactions.has(id))
      ),
    ].sort();

    // (10) per-keyword count caps.
    const keywordLimits: AlliedKeywordLimitOut[] = (kwLimByAf.get(af.id) ?? [])
      .map((r) => ({
        keyword: dump.enName(kw.get(r.keywordId)),
        battle_size: battleSizeEnum.get(r.battleSizeId),
        max_count: r.limitCount,
      }))
      .filter(
        (k): k is AlliedKeywordLimitOut => k.keyword !== undefined && k.battle_size !== undefined
      )
      .sort(
        (a, b) =>
          a.keyword.localeCompare(b.keyword) ||
          BATTLE_SIZE_ORDER[a.battle_size] - BATTLE_SIZE_ORDER[b.battle_size]
      );

    // (11) id / name from the overlay, or a synthesized fallback for a new pool.
    let id: string;
    let name: string;
    if (overlay) {
      id = overlay.id;
      name = overlay.name;
    } else {
      report.unknownPools.push(af.id);
      const base = sourceFaction ?? "mixed";
      id = detIds.length > 0 ? `${base}-allies-${detIds[0]}` : `${base}-allies`;
      name = label;
    }

    // Build the rule in display order; emit only present fields.
    const rule: AlliedRuleOut = { id, name, game_version: GAME_VERSION };
    rule.label = overlay?.label ?? label;
    if (hosts.length > 0) rule.army_keywords_any = hosts;
    if (detIds.length > 0) rule.detachment_ids = detIds;
    if (sourceFaction) rule.source_faction_id = sourceFaction;
    if (datasheetIds.length > 0) rule.source_datasheet_ids = datasheetIds;
    if (pointsLimits.length > 0) rule.points_limits = pointsLimits;
    if (keywordLimits.length > 0) rule.keyword_limits = keywordLimits;

    // (8) warlord lock: a pool with no allowed-warlord minis bars its units from
    // Warlord; one with an allowlist instead names exactly who may be Warlord.
    if (warlordDatasheetIds.length > 0) rule.warlord_datasheet_ids = warlordDatasheetIds;
    else rule.cannot_be_warlord = true;

    // (7) enhancement lock.
    if (!af.canTakeEnhancements) rule.cannot_take_enhancements = true;

    if (overlay?.warlord_required_keyword)
      rule.warlord_required_keyword = overlay.warlord_required_keyword;
    if (overlay?.removes_ability_ids) rule.removes_ability_ids = overlay.removes_ability_ids;
    if (overlay?.battleline_ratio_keywords)
      rule.battleline_ratio_keywords = overlay.battleline_ratio_keywords;
    if (overlay?.notes) rule.notes = overlay.notes;

    report.rules.push(rule);
    report.emitted.push({
      id,
      hosts,
      sourceFaction,
      datasheets: datasheetIds.length,
      detachments: detIds.length,
      warlordDatasheets: warlordDatasheetIds.length,
      keywordLimits: keywordLimits.length,
    });
    if (missingDatasheets.length > 0 || missingDetachments.length > 0) {
      report.unresolved.push({
        guid: af.id,
        id,
        datasheets: missingDatasheets,
        detachments: missingDetachments,
      });
    }
  }

  report.rules.sort((a, b) => a.id.localeCompare(b.id));
  report.emitted.sort((a, b) => a.id.localeCompare(b.id));
  report.staged.push({ path: path.join(CORE_DIR, "allies.json"), value: report.rules });
  return report;
}

export function buildAlliesReport(report: AlliesReport, write: boolean): string {
  const lines: string[] = [];
  lines.push("# MFM allies ingest", "");
  lines.push(write ? "Mode: **write**" : "Mode: **dry run**", "");
  lines.push(`Pools emitted: **${report.rules.length}**, skipped: **${report.skipped.length}**.`, "");

  lines.push("## Emitted", "");
  lines.push("| id | hosts | source faction | datasheets | detachments | warlord | kw-limits |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const e of report.emitted) {
    lines.push(
      `| ${e.id} | ${e.hosts.join(", ")} | ${e.sourceFaction ?? "—"} | ${e.datasheets} | ` +
        `${e.detachments || "—"} | ${e.warlordDatasheets || "—"} | ${e.keywordLimits || "—"} |`
    );
  }
  lines.push("");

  if (report.skipped.length > 0) {
    lines.push("## Skipped (0 datasheets resolved)", "");
    for (const s of report.skipped) {
      lines.push(`- \`${s.guid}\` (${s.label}): ${s.missingDatasheets.join("; ")}`);
    }
    lines.push("");
  }

  if (report.unresolved.length > 0) {
    lines.push("## Partially unresolved", "");
    for (const u of report.unresolved) {
      const parts: string[] = [];
      if (u.datasheets.length) parts.push(`datasheets: ${u.datasheets.join("; ")}`);
      if (u.detachments.length) parts.push(`detachments: ${u.detachments.join("; ")}`);
      lines.push(`- ${u.id}: ${parts.join(" | ")}`);
    }
    lines.push("");
  }

  if (report.unknownPools.length > 0) {
    lines.push("## New pools (not in overlay — synthesized id)", "");
    for (const g of report.unknownPools) lines.push(`- \`${g}\``);
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
