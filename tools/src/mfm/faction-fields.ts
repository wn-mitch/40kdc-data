/**
 * faction-fields.ts — WS3: reconcile faction entity fields against the GW MFM dump.
 *
 * Reconciles three fields on the per-faction `factions.json` record, all fill-only
 * and non-destructive (mirroring the enhancement field reconcile):
 *   - faction_rule_ids  ← army_rule via army_rule_faction_keyword → nameToId
 *   - parent_faction_id ← faction_keyword.parentFactionKeywordId → repo dir
 *   - aliases           ← faction_keyword.localisations.en.commonName (additive)
 *   - keyword_limits    ← keyword_restriction_group (+ _keyword), authoritative
 *
 * `faction_rule_ids` contains every faction-wide ability slug in display order.
 * When the dump owns rules, reconciliation fills an absent authored field with all
 * candidates, confirms order-insensitive set equality, and reports both sets on a
 * mismatch. It never overwrites an authored array.
 *
 * IP: reads only ids and English display names (army-rule / faction-keyword names),
 * never rules or lore prose.
 */
import { mirrorIds } from "./mirror/ids.js";
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import { MfmDump } from "./loader.js";
import { readJsonArray, CORE_DIR } from "./repo-files.js";
import { repoDirs, repoDirForFactionName } from "./faction-map.js";
import { factionKeywordLabel, keywordLabel } from "./keywords.js";
import type { StagedWrite } from "./apply.js";

interface FactionRecord {
  id: string;
  name: string;
  faction_rule_ids?: string[];
  parent_faction_id?: string | null;
  aliases?: string[];
  keyword_limits?: KeywordLimit[];
  [k: string]: unknown;
}

/** One army-wide keyword cap (see the faction schema's `keyword_limits`). */
export interface KeywordLimit {
  keywords: string[];
  max: number;
  mode?: "alternatives";
  exempt_faction_keywords?: string[];
}

/**
 * Label set per live (non-Legends) datasheet: its miniatures' keywords, its faction
 * keywords and its own name — the same identity a roster check matches against.
 */
function datasheetLabelSets(dump: MfmDump): Set<string>[] {
  const minis = dump.groupBy("miniature", "datasheetId");
  const mkByMini = dump.groupBy("miniature_keyword", "miniatureId");
  const dfk = dump.groupBy("datasheet_faction_keyword", "datasheetId");
  const out: Set<string>[] = [];
  for (const ds of dump.table("datasheet")) {
    if (ds.isLegends) continue;
    const labels = new Set<string>();
    const name = dump.enName(ds);
    if (name) labels.add(name);
    for (const m of minis.get(ds.id!) ?? [])
      for (const r of mkByMini.get(m.id!) ?? []) {
        const k = keywordLabel(dump, r.keywordId);
        if (k) labels.add(k);
      }
    for (const r of dfk.get(ds.id!) ?? []) {
      const k = factionKeywordLabel(dump, r.factionKeywordId);
      if (k) labels.add(k);
    }
    out.push(labels);
  }
  return out;
}

/**
 * Army-wide keyword caps per repo dir, from `keyword_restriction_group`: the group's
 * faction keyword routes to the dir (Asuryani → aeldari), its keyword rows become
 * `keywords` (a unit counts when it carries all of them), `limit` becomes `max`, and
 * `excludedFactionKeywordId` becomes `exempt_faction_keywords`. A group with no
 * limit (Chaos Knights' WAR DOG group, which only carries Houndpack Lance's minimum)
 * imposes no army-wide cap and is skipped. Sorted for a stable diff.
 *
 * How a group's keywords combine follows from where they live. When one live
 * datasheet carries them all (EPIC HERO + YVRAINE, or a single PATRIARCH keyword),
 * they name that datasheet and the cap counts units carrying all of them. When no
 * datasheet carries them all, each keyword names a different datasheet — the group
 * lists alternatives — and the cap counts distinct alternatives present (`mode:
 * "alternatives"`): COMMANDER FARSIGHT / ETHEREAL with limit 1 is "Farsight or
 * Ethereals, never both", COMMISSAR GRAVES / COMMISSAR GRAVES ON FOOT is "one
 * version of Graves", matching the datasheet rules the dump prints for both.
 */
export function keywordLimitsByDir(dump: MfmDump): Map<string, KeywordLimit[]> {
  const out = new Map<string, KeywordLimit[]>();
  const labelSets = datasheetLabelSets(dump);
  const kwByGroup = dump.groupBy("keyword_restriction_group_keyword", "keywordRestrictionGroupId");
  for (const g of dump.table("keyword_restriction_group")) {
    if (g.limit === null || g.limit === undefined) continue;
    const dir = repoDirForFactionName(factionKeywordLabel(dump, g.factionKeywordId) ?? undefined);
    if (!dir) continue;
    const keywords = [
      ...new Set((kwByGroup.get(g.id) ?? []).map((r) => keywordLabel(dump, r.keywordId)).filter((k): k is string => !!k)),
    ].sort((a, b) => a.localeCompare(b));
    if (keywords.length === 0) continue;
    const exempt = factionKeywordLabel(dump, g.excludedFactionKeywordId);
    const alternatives = keywords.length > 1 && !labelSets.some((labels) => keywords.every((k) => labels.has(k)));
    const entry: KeywordLimit = {
      keywords,
      max: g.limit,
      ...(alternatives ? { mode: "alternatives" as const } : {}),
      ...(exempt ? { exempt_faction_keywords: [exempt] } : {}),
    };
    (out.get(dir) ?? out.set(dir, []).get(dir)!).push(entry);
  }
  for (const list of out.values())
    list.sort((a, b) => a.keywords.join("+").localeCompare(b.keywords.join("+")));
  return out;
}

export interface DirFactionResult {
  dir: string;
  ruleFilled?: string[];
  ruleConfirmed?: boolean;
  ruleReview?: { authored: string[]; candidates: string[] };
  parentFilled?: string;
  parentConfirmed?: boolean;
  parentReview?: { authored: string; derived: string };
  aliasesAdded: string[];
  keywordLimitsChanged?: boolean;
}

export interface FactionFieldsReport {
  dirs: DirFactionResult[];
  /** Repo faction dirs with no matching dump faction keyword (left untouched). */
  unresolvedDirs: string[];
  staged: StagedWrite[];
}

/** Order-insensitive equality for schema-validated unique string arrays. */
function same(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((value, index) => value === y[index]);
}

/** Repo faction dir → its dump faction-keyword id. Skips a dir that more than one
 *  keyword resolves to (ambiguous — safer to leave it out than guess). */
function factionKeywordByDir(dump: MfmDump): Map<string, string> {
  const byDir = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const fk of dump.table("faction_keyword")) {
    const name = dump.enName(fk);
    if (!name) continue;
    const dir = repoDirForFactionName(name);
    if (!dir) continue;
    // Prefer the keyword whose own slug equals the dir (the faction's home keyword)
    // over an alias that also routes here.
    if (nameToId(name) === dir) {
      byDir.set(dir, fk.id);
      continue;
    }
    if (byDir.has(dir)) {
      if (nameToId(dump.enName(dump.byId("faction_keyword").get(byDir.get(dir)!)) ?? "") === dir) continue;
      ambiguous.add(dir);
    } else {
      byDir.set(dir, fk.id);
    }
  }
  for (const dir of ambiguous) byDir.delete(dir);
  return byDir;
}

export function runFactionFields(dump: MfmDump): FactionFieldsReport {
  const fkByDir = factionKeywordByDir(dump);
  const limitsByDir = keywordLimitsByDir(dump);

  // fkId → the army rule rows the keyword owns; each becomes the id `mfm:mirror` gives it
  // in the faction's dir (`<name>-<faction>`).
  const armyRuleById = dump.byId("army_rule");
  const ids = mirrorIds(dump);
  const armyRulesByFk = new Map<string, string[]>();
  for (const edge of dump.table("army_rule_faction_keyword")) {
    if (!armyRuleById.get(edge.armyRuleId)) continue;
    const list = armyRulesByFk.get(edge.factionKeywordId) ?? [];
    if (!list.includes(edge.armyRuleId)) list.push(edge.armyRuleId);
    armyRulesByFk.set(edge.factionKeywordId, list);
  }

  const fkById = dump.byId("faction_keyword");

  const dirs: DirFactionResult[] = [];
  const unresolvedDirs: string[] = [];
  const staged: StagedWrite[] = [];

  for (const dir of [...repoDirs()].sort()) {
    const p = path.join(CORE_DIR, dir, "factions.json");
    const records = readJsonArray<FactionRecord>(p);
    const record = records.find((r) => r.id === dir) ?? records[0];
    if (!record) continue;

    const res: DirFactionResult = { dir, aliasesAdded: [] };
    let changed = false;

    // keyword_limits — authoritative: replace, or clear when the dump has none. Keyed by
    // the group's own faction keyword route, so it applies even when the dir's home
    // keyword is ambiguous (aeldari: Asuryani / Harlequins / Ynnari).
    const limits = limitsByDir.get(dir) ?? [];
    if (JSON.stringify(record.keyword_limits ?? []) !== JSON.stringify(limits)) {
      if (limits.length) record.keyword_limits = limits;
      else delete record.keyword_limits;
      res.keywordLimitsChanged = true;
      changed = true;
    }

    const fkId = fkByDir.get(dir);
    if (!fkId) {
      unresolvedDirs.push(dir);
      if (changed) {
        staged.push({ path: p, value: records });
        dirs.push(res);
      }
      continue;
    }

    // faction_rule_ids — fill-only / confirm / review.
    const candidates = [...new Set((armyRulesByFk.get(fkId) ?? []).flatMap((row) => {
      const id = ids.idOf("army_rule", row, dir) ?? ids.idOf("army_rule", row);
      return id ? [id] : [];
    }))];
    const ruleAuthored = record.faction_rule_ids;
    if (candidates.length > 0) {
      if (ruleAuthored === undefined) {
        record.faction_rule_ids = [...candidates];
        res.ruleFilled = [...candidates];
        changed = true;
      } else if (same(ruleAuthored, candidates)) {
        res.ruleConfirmed = true;
      } else {
        res.ruleReview = { authored: [...ruleAuthored], candidates: [...candidates] };
      }
    }

    // parent_faction_id — fill-only / confirm / review.
    const parentFkId = fkById.get(fkId)?.parentFactionKeywordId ?? null;
    const parentDerived = parentFkId ? repoDirForFactionName(dump.enName(fkById.get(parentFkId))) : null;
    const parentAuthored = record.parent_faction_id ?? null;
    if (parentDerived) {
      if (parentAuthored === null) {
        record.parent_faction_id = parentDerived;
        res.parentFilled = parentDerived;
        changed = true;
      } else if (parentAuthored === parentDerived) {
        res.parentConfirmed = true;
      } else {
        res.parentReview = { authored: parentAuthored, derived: parentDerived };
      }
    }

    // aliases — additive: append the localized common name when distinct and absent.
    const common = (fkById.get(fkId)?.localisations?.en as { commonName?: string } | undefined)?.commonName?.trim();
    if (common && common !== record.name) {
      const aliases = record.aliases ?? [];
      if (!aliases.includes(common)) {
        aliases.push(common);
        record.aliases = aliases;
        res.aliasesAdded.push(common);
        changed = true;
      }
    }

    if (changed) staged.push({ path: p, value: records });
    dirs.push(res);
  }

  return { dirs, unresolvedDirs, staged };
}

export function buildFactionFieldsReport(report: FactionFieldsReport, write: boolean): string {
  const { dirs, unresolvedDirs } = report;
  const L: string[] = [];
  L.push(`# MFM faction fields — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  L.push("Fill-only reconcile of `faction_rule_ids` (all owned army rules), `parent_faction_id`");
  L.push("(dump faction hierarchy), and `aliases` (localized common name, additive). Authored");
  L.push("values are compared as sets and surfaced for review on mismatch, never overwritten. Prose untouched.");
  L.push("");
  const n = (b: unknown) => (b ? 1 : 0);
  L.push("| Dir | rule-fill | rule-ok | rule-rev | parent-fill | parent-ok | parent-rev | aliases+ |");
  L.push("|---|--:|--:|--:|--:|--:|--:|--:|");
  for (const d of dirs) {
    if (!d.ruleFilled && !d.ruleConfirmed && !d.ruleReview && !d.parentFilled && !d.parentConfirmed && !d.parentReview && !d.aliasesAdded.length) continue;
    L.push(
      `| ${d.dir} | ${n(d.ruleFilled)} | ${n(d.ruleConfirmed)} | ${n(d.ruleReview)} | ${n(d.parentFilled)} | ${n(d.parentConfirmed)} | ${n(d.parentReview)} | ${d.aliasesAdded.length} |`,
    );
  }
  L.push("");
  for (const d of dirs) {
    const details: string[] = [];
    if (d.ruleFilled) details.push(`- faction_rule_ids filled: [${d.ruleFilled.join(", ")}]`);
    if (d.ruleReview) details.push(`- faction_rule_ids REVIEW: authored [${d.ruleReview.authored.join(", ")}] vs owned [${d.ruleReview.candidates.join(", ")}]`);
    if (d.parentFilled) details.push(`- parent_faction_id filled: ${d.parentFilled}`);
    if (d.parentReview) details.push(`- parent_faction_id REVIEW: authored ${d.parentReview.authored} vs dump ${d.parentReview.derived}`);
    if (d.aliasesAdded.length) details.push(`- aliases added: ${d.aliasesAdded.join(", ")}`);
    if (d.keywordLimitsChanged) details.push(`- keyword_limits replaced from keyword_restriction_group`);
    if (details.length) {
      L.push(`## ${d.dir}`, ...details, "");
    }
  }
  if (unresolvedDirs.length) {
    L.push(`## Repo faction dirs with no dump faction keyword (left as-is): ${unresolvedDirs.length}`, "");
    unresolvedDirs.forEach((d) => L.push(`- ${d}`));
    L.push("");
  }
  return L.join("\n") + "\n";
}
