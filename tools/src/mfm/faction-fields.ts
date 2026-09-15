/**
 * faction-fields.ts — WS3: reconcile faction entity fields against the GW MFM dump.
 *
 * Reconciles three fields on the per-faction `factions.json` record, all fill-only
 * and non-destructive (mirroring the enhancement field reconcile):
 *   - faction_rule_ids  ← army_rule via army_rule_faction_keyword → nameToId
 *   - parent_faction_id ← faction_keyword.parentFactionKeywordId → repo dir
 *   - aliases           ← faction_keyword.localisations.en.commonName (additive)
 *
 * `faction_rule_ids` contains every faction-wide ability slug in display order.
 * When the dump owns rules, reconciliation fills an absent authored field with all
 * candidates, confirms order-insensitive set equality, and reports both sets on a
 * mismatch. It never overwrites an authored array.
 *
 * IP: reads only ids and English display names (army-rule / faction-keyword names),
 * never rules or lore prose.
 */
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import { MfmDump } from "./loader.js";
import { readJsonArray, CORE_DIR } from "./repo-files.js";
import { repoDirs, repoDirForFactionName } from "./faction-map.js";
import type { StagedWrite } from "./apply.js";

interface FactionRecord {
  id: string;
  name: string;
  faction_rule_ids?: string[];
  parent_faction_id?: string | null;
  aliases?: string[];
  [k: string]: unknown;
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

  // fkId → nameToId of every army rule the keyword owns. Strip a trailing
  // parenthetical tag ("Nurgle's Gift (Aura)") the repo drops from the slug, so the
  // derived candidate matches the authored faction_rule_ids (mirrors cleanEnhName).
  const armyRuleById = dump.byId("army_rule");
  const armyRulesByFk = new Map<string, string[]>();
  for (const edge of dump.table("army_rule_faction_keyword")) {
    const name = dump.enName(armyRuleById.get(edge.armyRuleId))?.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!name) continue;
    let slug: string;
    try {
      slug = nameToId(name);
    } catch {
      continue;
    }
    const list = armyRulesByFk.get(edge.factionKeywordId) ?? [];
    if (!list.includes(slug)) list.push(slug);
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

    const fkId = fkByDir.get(dir);
    if (!fkId) {
      unresolvedDirs.push(dir);
      continue;
    }

    const res: DirFactionResult = { dir, aliasesAdded: [] };
    let changed = false;

    // faction_rule_ids — fill-only / confirm / review.
    const candidates = armyRulesByFk.get(fkId) ?? [];
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
