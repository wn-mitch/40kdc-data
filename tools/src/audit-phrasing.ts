/**
 * Phrasing audit: catalogue the generated English text for *every* authored
 * ability and flag mechanical phrasing defects, so an across-the-board prose
 * cleanup has a worklist.
 *
 * The DSL→English describer (`describeAbility`, a.k.a. `ability.print()`) is the
 * user-facing rules readout in downstream consumers. This tool runs that *real*
 * describer over each `data/enrichment/<faction>/abilities.json` entry and runs
 * a set of regex heuristics over the output, flagging the defect classes a
 * manual audit turned up: leftover `?` placeholders (modifier field-name
 * mismatches), unmapped `[type]` fallbacks, raw `snake_case` identifiers that
 * leaked into prose, doubled prepositions ("at on model destroyed"), `0"` noise
 * on movement grants, `(s)` pluralization stubs, and empty output.
 *
 * This is a TS-only analysis utility — it *consumes* the conformance-pinned
 * describer, it does not change it — so it needs no SPEC_VERSION bump and no
 * Rust/Python port (mirrors `audit-coverage.ts`).
 *
 * Usage:
 *   npx tsx tools/src/audit-phrasing.ts            (pretty report to stdout)
 *   npx tsx tools/src/audit-phrasing.ts --json     (machine-readable)
 *   npx tsx tools/src/audit-phrasing.ts --write     (also emit data/_audit/phrasing.*)
 *
 * Wired as `40kdc-validate audit-phrasing` and `npm run audit:phrasing`.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { describeAbility, type Effect, type AbilityScope, type AbilityAppliesTo } from "./translate/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const AUDIT_DIR = resolve(DATA_ROOT, "_audit");

/** Shape of an authored ability entry (only the fields the describer reads). */
interface AbilityEntry {
  ability_id: string;
  name?: string;
  effect?: Effect;
  scope?: AbilityScope;
  applies_to?: AbilityAppliesTo | null;
}

/** One catalogued ability: its identity, the generated text, and any defect flags. */
export interface PhrasingRow {
  faction: string;
  ability_id: string;
  name: string;
  /** Full multi-line `describeAbility` output (effect + scope + applies). */
  text: string;
  flags: PhrasingFlag[];
}

export interface PhrasingReport {
  rows: PhrasingRow[];
  total: number;
  /** Rows carrying ≥1 flag. */
  flagged: number;
  /** Per-flag counts, descending. */
  byFlag: { flag: PhrasingFlag; count: number }[];
  /** Per-faction totals + flagged counts, faction-sorted. */
  byFaction: { faction: string; total: number; flagged: number }[];
}

export type PhrasingFlag =
  | "placeholder"
  | "type_fallback"
  | "snake_case_leftover"
  | "doubled_preposition"
  | "zero_inch"
  | "paren_plural"
  | "empty";

const PREP = "(?:at|on|in|of|to|by|for|from|with)";
const DOUBLED_PREP = new RegExp(`\\b${PREP}\\s+${PREP}\\b`, "i");
const TYPE_FALLBACK = /\[[^\]]+\]/;
const SNAKE_CASE = /[a-z]+_[a-z]+/;
const ZERO_INCH = /\b0"/;

/**
 * Classify one piece of generated text. Pure and order-stable so it is directly
 * unit-testable. The order of the returned flags follows the {@link PhrasingFlag}
 * union for deterministic output.
 */
export function classifyPhrasing(text: string): PhrasingFlag[] {
  const flags: PhrasingFlag[] = [];
  if (text.trim() === "") {
    flags.push("empty");
    return flags;
  }
  if (text.includes("?")) flags.push("placeholder");
  if (TYPE_FALLBACK.test(text)) flags.push("type_fallback");
  if (SNAKE_CASE.test(text)) flags.push("snake_case_leftover");
  if (DOUBLED_PREP.test(text)) flags.push("doubled_preposition");
  if (ZERO_INCH.test(text)) flags.push("zero_inch");
  if (text.includes("(s)")) flags.push("paren_plural");
  return flags;
}

/** Compute the phrasing report for a set of factions. Pure — IO lives in the command. */
export function auditPhrasing(
  input: { faction: string; abilities: AbilityEntry[] }[],
): PhrasingReport {
  const rows: PhrasingRow[] = [];
  const byFaction: { faction: string; total: number; flagged: number }[] = [];
  const flagCounts = new Map<PhrasingFlag, number>();

  for (const { faction, abilities } of input) {
    let factionFlagged = 0;
    for (const a of abilities) {
      const text = describeAbility({
        ...(a.effect ? { effect: a.effect } : {}),
        ...(a.scope ? { scope: a.scope } : {}),
        ...(a.applies_to ? { applies_to: a.applies_to } : {}),
      });
      const flags = classifyPhrasing(text);
      if (flags.length > 0) {
        factionFlagged++;
        for (const f of flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
      }
      rows.push({
        faction,
        ability_id: a.ability_id,
        name: a.name ?? a.ability_id,
        text,
        flags,
      });
    }
    byFaction.push({ faction, total: abilities.length, flagged: factionFlagged });
  }

  byFaction.sort((a, b) => a.faction.localeCompare(b.faction));
  rows.sort(
    (a, b) => a.faction.localeCompare(b.faction) || a.ability_id.localeCompare(b.ability_id),
  );

  const byFlag = [...flagCounts.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));

  return {
    rows,
    total: rows.length,
    flagged: rows.filter((r) => r.flags.length > 0).length,
    byFlag,
    byFaction,
  };
}

/** Read every `data/enrichment/<faction>/abilities.json` (skips `_`-prefixed dirs). */
export function loadFactions(): { faction: string; abilities: AbilityEntry[] }[] {
  const out: { faction: string; abilities: AbilityEntry[] }[] = [];
  for (const entry of readdirSync(ENRICHMENT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const file = resolve(ENRICHMENT_ROOT, entry.name, "abilities.json");
    let abilities: AbilityEntry[];
    try {
      abilities = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      continue; // no abilities.json in this folder
    }
    if (!Array.isArray(abilities)) continue;
    out.push({ faction: entry.name, abilities });
  }
  return out;
}

const pct = (n: number, d: number): string => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);

/** CSV-escape one field (RFC-4180: wrap in quotes, double internal quotes). */
function csvField(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

/**
 * One row per ability. The multi-line describer output is flattened to ` / ` so
 * each catalogued ability stays on a single CSV line (greppable); the JSON
 * artifact keeps the original newlines.
 */
function csvReport(r: PhrasingReport): string {
  const lines = ["faction,ability_id,name,flags,text"];
  for (const row of r.rows) {
    lines.push(
      [
        csvField(row.faction),
        csvField(row.ability_id),
        csvField(row.name),
        csvField(row.flags.join(";")),
        csvField(row.text.replace(/\n/g, " / ")),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function prettyReport(r: PhrasingReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold("40kdc Ability Phrasing Audit"));
  lines.push(chalk.gray("─".repeat(60)));
  lines.push(`Abilities catalogued: ${chalk.cyan(String(r.total))}`);
  lines.push(`Flagged for review:   ${chalk.yellow(String(r.flagged))} (${pct(r.flagged, r.total)})`);
  lines.push("");
  lines.push(chalk.bold("Defect flags:"));
  if (r.byFlag.length === 0) {
    lines.push(chalk.green("  none — every ability's generated text is clean"));
  } else {
    for (const { flag, count } of r.byFlag) {
      lines.push(`  ${String(count).padStart(5)}  ${chalk.gray(flag)}`);
    }
  }
  lines.push("");
  lines.push(chalk.bold("Most-flagged factions:"));
  const worst = [...r.byFaction].filter((f) => f.flagged > 0).sort((a, b) => b.flagged - a.flagged);
  for (const f of worst.slice(0, 15)) {
    lines.push(`  ${String(f.flagged).padStart(4)}/${String(f.total).padEnd(4)}  ${chalk.gray(f.faction)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export interface AuditPhrasingOptions {
  reporter?: "pretty" | "json";
  write?: boolean;
}

/** Commander action: run the phrasing audit over the repo's enrichment data. */
export function auditPhrasingCommand(opts: AuditPhrasingOptions = {}): void {
  const report = auditPhrasing(loadFactions());

  if (opts.write) {
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(resolve(AUDIT_DIR, "phrasing.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(resolve(AUDIT_DIR, "phrasing.csv"), csvReport(report));
  }

  if (opts.reporter === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(prettyReport(report));
    if (opts.write) console.log(chalk.gray(`Wrote ${basename(AUDIT_DIR)}/phrasing.csv + phrasing.json`));
  }
}

// Direct-invocation entry point (`npx tsx tools/src/audit-phrasing.ts [--json] [--write]`).
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) {
  const argv = process.argv.slice(2);
  auditPhrasingCommand({
    reporter: argv.includes("--json") ? "json" : "pretty",
    write: argv.includes("--write"),
  });
}
