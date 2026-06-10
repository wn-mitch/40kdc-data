/**
 * Ability-coverage audit: measure how much of the community-authored ability
 * data actually translates into cruncher buffs, per faction.
 *
 * The buff layer only interprets a subset of the ability DSL (see
 * `cruncher/from-dsl.ts`). An ability that doesn't translate is inert in Salvo —
 * the projection silently falls back to raw-statline math. This tool runs the
 * *real* translator (`effectToBuffs`) over every authored ability, under both
 * the attacker and target perspectives and across every phase, and classifies
 * each entry as:
 *
 *   - **offensive** — yields ≥1 attacker-side buff (auto-applied or activatable)
 *   - **defensive** — yields ≥1 target-side buff
 *   - **inert** — neither; the effect is `unsupported` and/or a stub
 *
 * It also tallies the verbatim-GW-text leak (`community_notes` carrying an
 * `"Original:"` dump) and the explicit `"skipped for damage calc"` defensive
 * entries, and histograms the `unsupported.reason` strings so the output is a
 * directly-actionable authoring worklist.
 *
 * Usage:
 *   npx tsx tools/src/audit-coverage.ts            (pretty report to stdout)
 *   npx tsx tools/src/audit-coverage.ts --json     (machine-readable)
 *   npx tsx tools/src/audit-coverage.ts --write     (also emit data/_audit/*)
 *
 * Wired as `40kdc-validate audit-coverage` and `npm run audit:coverage`.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { effectToBuffs } from "./cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "./cruncher/buffs.js";
import type { Phase } from "./generated.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const AUDIT_DIR = resolve(DATA_ROOT, "_audit");
const CONTRIBUTING_PATH = resolve(__dirname, "../../CONTRIBUTING.md");
const COVERAGE_START = "<!-- coverage:start -->";
const COVERAGE_END = "<!-- coverage:end -->";

const PHASES: Phase[] = ["command", "movement", "shooting", "charge", "fight"];

/** Shape of an authored ability entry (only the fields this audit reads). */
interface AbilityEntry {
  ability_id: string;
  name?: string;
  ability_type?: string;
  community_notes?: string;
  effect?: unknown;
}

export interface FactionCoverage {
  faction: string;
  total: number;
  offensive: number;
  defensive: number;
  /** Produces neither an offensive nor a defensive buff. */
  inert: number;
  /** `community_notes` flags it an auto-generated stub / partial. */
  stub: number;
  /**
   * Structurally a placeholder: the effect tree contains a modifier-bearing
   * node with an empty `modifier: {}` (the original pass's untyped stub, e.g.
   * `stat-modifier {}`). This — not `inert` — is the authoring worklist: an
   * inert-but-correctly-typed ability (movement, objective control) is *done*;
   * an empty-modifier node is a gap regardless of who consumes it.
   */
  stubStructural: number;
  /** `community_notes` carries a verbatim GW `"Original:"` text dump (IP leak). */
  gwTextLeak: number;
  /** Explicitly tagged `"defensive ability (skipped for damage calc)"`. */
  defensiveSkipped: number;
}

/**
 * One named gap. Carries the ability's identity and current shape so the gap is
 * self-describing on the consumer end (the fan-out joins the source rule; the
 * editor / downstream tools can list "what's unauthored" without re-deriving).
 */
export interface WorklistEntry {
  faction: string;
  ability_id: string;
  name: string;
  /** Top-level effect type as authored today (the "shape"), or `null` if absent. */
  shape: string | null;
  /** Has an empty-modifier placeholder node somewhere in its effect tree. */
  stub: boolean;
  offensive: boolean;
  defensive: boolean;
  /** Most-informative unsupported reason from the attacker walk, if any. */
  gap: string | null;
}

export interface CoverageReport {
  factions: FactionCoverage[];
  totals: Omit<FactionCoverage, "faction">;
  /** `unsupported.reason` (normalized) → count, descending. */
  unsupportedReasons: { reason: string; count: number }[];
  /** Per-ability named gaps — the authoring worklist. */
  worklist: WorklistEntry[];
}

/**
 * Build a permissive context for `phase` — every situational flag set so that
 * conditionals gated on stationary/charged/half-range/attachment can fire. We
 * want "could this ability *ever* produce a buff", not "does it fire right now".
 * Keyword-specific conditions (`target-has-keyword`) still evaluate `"unknown"`
 * since no concrete target exists; those surface in the reason histogram.
 */
function permissiveContext(phase: Phase): EngineContext {
  return {
    phase,
    attackerStationary: true,
    attackerCharged: true,
    withinHalfRange: true,
    attackerInCover: true,
    targetInCover: true,
    attackerAttached: true,
    attackerKeywords: [],
    targetKeywords: [],
  };
}

/** Map an `ability_type` to the buff-source kind (only labels; not load-bearing here). */
function sourceKind(abilityType: string | undefined): BuffSource {
  const kind =
    abilityType === "faction"
      ? "army"
      : abilityType === "detachment"
        ? "detachment"
        : abilityType === "stratagem"
          ? "detachment-stratagem"
          : "unit";
  return { kind: "ability", abilityId: "audit", abilityKind: kind };
}

/**
 * Keep reasons verbatim — the quoted specifics (which effect type, which
 * operation) ARE the worklist signal. We only collapse the `subset "…"` half of
 * the re-roll reason, which is high-cardinality noise, while keeping the roll.
 */
function normalizeReason(reason: string): string {
  return reason.replace(/\(subset "[^"]*"\)/g, "(subset …)");
}

/**
 * Translate one ability under one perspective across all phases; return whether
 * it produced any buff, accumulating unsupported reasons into `reasonCounts`.
 */
function producesBuff(
  effect: unknown,
  source: BuffSource,
  perspective: "attacker" | "target",
  reasonCounts: Map<string, number>,
): boolean {
  let produced = false;
  for (const phase of PHASES) {
    const t = effectToBuffs(effect, source, permissiveContext(phase), perspective);
    if (t.applied.length > 0 || t.activatable.length > 0) produced = true;
    // Only attacker-perspective reasons feed the histogram — the target pass
    // re-walks the same tree and would double-count every offensive-only branch
    // as "unsupported on defense", which is noise for the worklist.
    if (perspective === "attacker") {
      for (const u of t.unsupported) {
        const key = normalizeReason(u.reason);
        reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
      }
    }
  }
  return produced;
}

/**
 * Effect types that are pure flags — they carry no parameters, so an empty
 * `modifier: {}` is *correct*, not a stub (per `translate.ts`, these read no
 * modifier fields). Excluding them keeps the worklist from crying wolf on
 * legitimately-authored abilities like Deep Strike.
 */
const PARAMETERLESS_EFFECTS = new Set([
  "deep-strike",
  "fallback-and-act",
  "fight-first",
  "fight-last",
  "fight-on-death",
  "shoot-on-death",
]);

/**
 * True if any node in the effect tree is a *parameter-requiring* leaf left with
 * an empty `modifier: {}` — the original pass's untyped placeholder. Pure-flag
 * effects (see {@link PARAMETERLESS_EFFECTS}) are exempt.
 */
export function hasEmptyModifier(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasEmptyModifier);
  if (typeof node !== "object" || node === null) return false;
  const rec = node as Record<string, unknown>;
  const mod = rec.modifier;
  if (
    typeof rec.type === "string" &&
    !PARAMETERLESS_EFFECTS.has(rec.type) &&
    mod !== undefined &&
    typeof mod === "object" &&
    mod !== null &&
    !Array.isArray(mod) &&
    Object.keys(mod).length === 0
  ) {
    return true;
  }
  return Object.values(rec).some(hasEmptyModifier);
}

/** Top-level effect type (the "shape") as authored today. */
function shapeOf(effect: unknown): string | null {
  if (typeof effect === "object" && effect !== null && !Array.isArray(effect)) {
    const t = (effect as Record<string, unknown>).type;
    if (typeof t === "string") return t;
  }
  return null;
}

/** Compute coverage for a set of factions. Pure — IO lives in the command. */
export function computeCoverage(
  input: { faction: string; abilities: AbilityEntry[] }[],
): CoverageReport {
  const reasonCounts = new Map<string, number>();
  const factions: FactionCoverage[] = [];
  const worklist: WorklistEntry[] = [];

  for (const { faction, abilities } of input) {
    const fc: FactionCoverage = {
      faction,
      total: abilities.length,
      offensive: 0,
      defensive: 0,
      inert: 0,
      stub: 0,
      stubStructural: 0,
      gwTextLeak: 0,
      defensiveSkipped: 0,
    };
    for (const a of abilities) {
      const notes = a.community_notes ?? "";
      if (/Original:/.test(notes)) fc.gwTextLeak++;
      if (/stub|partial/i.test(notes)) fc.stub++;
      if (/skipped for damage calc/i.test(notes)) fc.defensiveSkipped++;

      const source = sourceKind(a.ability_type);
      // De-dupe reasons within a single ability so a 5-phase walk doesn't count
      // the same unsupported branch five times.
      const perAbility = new Map<string, number>();
      const off = producesBuff(a.effect, source, "attacker", perAbility);
      const def = producesBuff(a.effect, source, "target", new Map());
      for (const [reason] of perAbility) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
      if (off) fc.offensive++;
      if (def) fc.defensive++;
      if (!off && !def) fc.inert++;

      const isStub = hasEmptyModifier(a.effect);
      if (isStub) fc.stubStructural++;

      worklist.push({
        faction,
        ability_id: a.ability_id,
        name: a.name ?? a.ability_id,
        shape: shapeOf(a.effect),
        stub: isStub,
        offensive: off,
        defensive: def,
        gap: perAbility.size > 0 ? [...perAbility.keys()][0] : null,
      });
    }
    factions.push(fc);
  }

  factions.sort((a, b) => a.faction.localeCompare(b.faction));

  const totals = factions.reduce(
    (acc, f) => {
      acc.total += f.total;
      acc.offensive += f.offensive;
      acc.defensive += f.defensive;
      acc.inert += f.inert;
      acc.stub += f.stub;
      acc.stubStructural += f.stubStructural;
      acc.gwTextLeak += f.gwTextLeak;
      acc.defensiveSkipped += f.defensiveSkipped;
      return acc;
    },
    { total: 0, offensive: 0, defensive: 0, inert: 0, stub: 0, stubStructural: 0, gwTextLeak: 0, defensiveSkipped: 0 },
  );

  const unsupportedReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return { factions, totals, unsupportedReasons, worklist };
}

/** Read every `data/enrichment/<faction>/abilities.json` (skips `_example`). */
function loadFactions(): { faction: string; abilities: AbilityEntry[] }[] {
  const out: { faction: string; abilities: AbilityEntry[] }[] = [];
  for (const entry of readdirSync(ENRICHMENT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_example") continue;
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

function prettyReport(r: CoverageReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold("40kdc Ability Coverage Audit"));
  lines.push(chalk.gray("─".repeat(78)));
  lines.push(
    chalk.gray(
      "faction".padEnd(24) +
        "total".padStart(7) +
        "off".padStart(7) +
        "def".padStart(7) +
        "inert".padStart(7) +
        "stub".padStart(7) +
        "leak".padStart(7),
    ),
  );
  for (const f of r.factions) {
    const stubWarn = f.stubStructural > 0;
    const row =
      f.faction.padEnd(24) +
      String(f.total).padStart(7) +
      `${f.offensive}`.padStart(7) +
      `${f.defensive}`.padStart(7) +
      `${f.inert}`.padStart(7) +
      `${f.stubStructural}`.padStart(7) +
      `${f.gwTextLeak}`.padStart(7);
    lines.push(stubWarn ? chalk.yellow(row) : row);
  }
  lines.push(chalk.gray("─".repeat(78)));
  const t = r.totals;
  lines.push(
    chalk.bold(
      "TOTAL".padEnd(24) +
        String(t.total).padStart(7) +
        `${t.offensive}`.padStart(7) +
        `${t.defensive}`.padStart(7) +
        `${t.inert}`.padStart(7) +
        `${t.stubStructural}`.padStart(7) +
        `${t.gwTextLeak}`.padStart(7),
    ),
  );
  lines.push("");
  lines.push(
    `Offensive coverage: ${chalk.cyan(pct(t.offensive, t.total))}   ` +
      `Defensive coverage: ${chalk.cyan(pct(t.defensive, t.total))}   ` +
      `Inert: ${chalk.yellow(pct(t.inert, t.total))}`,
  );
  if (t.gwTextLeak > 0) {
    lines.push(chalk.red(`⚠ ${t.gwTextLeak} entries leak verbatim GW text (community_notes "Original:") — IP scrub needed (#20).`));
  }
  lines.push(chalk.gray(`${t.defensiveSkipped} entries tagged "skipped for damage calc" (defensive worklist, #23).`));
  lines.push("");
  lines.push(chalk.bold("Top unsupported-effect reasons (offensive walk):"));
  for (const { reason, count } of r.unsupportedReasons.slice(0, 15)) {
    lines.push(`  ${String(count).padStart(5)}  ${chalk.gray(reason)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function markdownReport(r: CoverageReport): string {
  const lines: string[] = [
    "# Ability coverage audit",
    "",
    "Generated by `tools/src/audit-coverage.ts` (`npm run audit:coverage`). Counts",
    "abilities that translate into cruncher buffs via the real `effectToBuffs`",
    "(attacker + target perspective, all phases). `inert` = produces neither.",
    "",
    "| faction | total | offensive | defensive | inert | stub* | notes-stub | gw-leak | def-skipped |",
    "|---|--:|--:|--:|--:|--:|--:|--:|--:|",
  ];
  for (const f of r.factions) {
    lines.push(
      `| ${f.faction} | ${f.total} | ${f.offensive} | ${f.defensive} | ${f.inert} | ${f.stubStructural} | ${f.stub} | ${f.gwTextLeak} | ${f.defensiveSkipped} |`,
    );
  }
  const t = r.totals;
  lines.push(
    `| **TOTAL** | **${t.total}** | **${t.offensive}** | **${t.defensive}** | **${t.inert}** | **${t.stubStructural}** | **${t.stub}** | **${t.gwTextLeak}** | **${t.defensiveSkipped}** |`,
  );
  lines.push("", "`stub*` = structural (empty-modifier placeholder node) — the authoring worklist. `notes-stub` = flagged in community_notes.");
  lines.push("", "## Unsupported-effect reasons (offensive walk)", "");
  for (const { reason, count } of r.unsupportedReasons) {
    lines.push(`- \`${count}\` — ${reason}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * The marker-bounded coverage digest embedded in CONTRIBUTING.md: a compact
 * table sorted by authoring need (structural stubs, then inert), so a
 * contributor can see at a glance which factions need the most DSL work. The
 * full report + unsupported-effect histogram stay in `data/_audit/summary.md`.
 */
function coverageDigest(r: CoverageReport): string {
  const rows = [...r.factions].sort(
    (a, b) => b.stubStructural - a.stubStructural || b.inert - a.inert || a.faction.localeCompare(b.faction),
  );
  const lines: string[] = [
    COVERAGE_START,
    "<!-- Generated by `npm run audit:coverage` — do not edit by hand. -->",
    "",
    "| faction | total | offensive | defensive | inert | stub\\* |",
    "|---|--:|--:|--:|--:|--:|",
  ];
  for (const f of rows) {
    lines.push(
      `| ${f.faction} | ${f.total} | ${f.offensive} | ${f.defensive} | ${f.inert} | ${f.stubStructural} |`,
    );
  }
  const t = r.totals;
  lines.push(
    `| **TOTAL** | **${t.total}** | **${t.offensive}** | **${t.defensive}** | **${t.inert}** | **${t.stubStructural}** |`,
    "",
    "`stub*` = empty-modifier placeholders — the authoring worklist (highest need first). " +
      "Full report + unsupported-effect histogram: [`data/_audit/summary.md`](data/_audit/summary.md).",
    COVERAGE_END,
  );
  return lines.join("\n");
}

/**
 * Splice the live coverage digest into CONTRIBUTING.md between the sentinel
 * markers, leaving the rest untouched. No-op (not an error) when the markers
 * are absent, so the audit never depends on the doc.
 */
function injectCoverageIntoContributing(report: CoverageReport): void {
  let md: string;
  try {
    md = readFileSync(CONTRIBUTING_PATH, "utf-8");
  } catch {
    return;
  }
  const start = md.indexOf(COVERAGE_START);
  const end = md.indexOf(COVERAGE_END);
  if (start === -1 || end === -1 || end < start) return;
  const next = md.slice(0, start) + coverageDigest(report) + md.slice(end + COVERAGE_END.length);
  if (next !== md) writeFileSync(CONTRIBUTING_PATH, next);
}

export interface AuditCoverageOptions {
  reporter?: "pretty" | "json";
  write?: boolean;
}

/** Commander action: run the audit over the repo's enrichment data. */
export function auditCoverageCommand(opts: AuditCoverageOptions = {}): void {
  const report = computeCoverage(loadFactions());

  if (opts.write) {
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(resolve(AUDIT_DIR, "coverage.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(resolve(AUDIT_DIR, "summary.md"), markdownReport(report));
    // The named-gap worklist is the authoring artifact — split out so it's
    // diffable on its own and consumable without the histograms.
    writeFileSync(resolve(AUDIT_DIR, "worklist.json"), JSON.stringify(report.worklist, null, 2) + "\n");
    // Keep the CONTRIBUTING.md coverage snapshot current (markers permitting).
    injectCoverageIntoContributing(report);
  }

  if (opts.reporter === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(prettyReport(report));
    if (opts.write) console.log(chalk.gray(`Wrote ${basename(AUDIT_DIR)}/coverage.json + summary.md`));
  }
}

// Direct-invocation entry point (`npx tsx tools/src/audit-coverage.ts [--json] [--write]`).
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) {
  const argv = process.argv.slice(2);
  auditCoverageCommand({
    reporter: argv.includes("--json") ? "json" : "pretty",
    write: argv.includes("--write"),
  });
}
