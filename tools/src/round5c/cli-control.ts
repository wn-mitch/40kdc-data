import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { authorityAudit } from "./authority-migration.js";
import { REVIEWED_FAMILY_REGISTRY } from "./contracts.js";
import { getCurrentCoverage } from "./coverage.js";
import { backupBeforeLiveRun, getDataEpoch, openWorkbench, openWorkbenchReadOnly, workbenchPath } from "./db.js";
import { applyChatReviewFile } from "./review-apply.js";
import { planPilotStep, reportPilotStep, runPilotStep, type PilotStepOptions } from "./pilot.js";
import { classificationHealth, familyStatus, frontier, FRONTIER_KINDS, gapsReport, leafCompleteTexts, readQuery, reviewSessions, segmentationHealth, type FrontierKind } from "./control-reads.js";
import { classifyBatch, segmentBatch, unsegmentedAbilities } from "./control-machine.js";
import { propagateDuplicateTexts } from "./propagate.js";
import { runGatesOnly } from "./pipeline-8b.js";

/**
 * The control-plane commands an agent drives: every one prints a single JSON envelope
 * `{ok, command, effect, db_path, data_epoch, data, errors}` and declares its effect before it
 * opens the database. `read` commands open it read-only; `--dry-run` never writes or spends.
 * Effects: read (nothing changes), propose (model proposals and signals only), machine (machine
 * results on a copy of the workbench), derive (mechanical copies of human decisions), human
 * (Will's decisions; not reachable from this CLI).
 */

export type Effect = "read" | "propose" | "machine" | "derive" | "human";

type ControlCommand = {
  effect: (args: Flags) => Effect;
  usage: string;
  summary: string;
  run: (args: Flags) => Promise<unknown> | unknown;
};

type Flags = { positional: string[]; values: Map<string, string>; switches: Set<string> };

function parseFlags(args: readonly string[]): Flags {
  const flags: Flags = { positional: [], values: new Map(), switches: new Set() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) { flags.positional.push(arg); continue; }
    const [name, inline] = arg.slice(2).split("=", 2) as [string, string | undefined];
    if (inline !== undefined) flags.values.set(name, inline);
    else if (args[index + 1] !== undefined && !args[index + 1]!.startsWith("--")) { flags.values.set(name, args[index + 1]!); index += 1; }
    else flags.switches.add(name);
  }
  return flags;
}

function numberFlag(flags: Flags, name: string): number | undefined {
  const value = flags.values.get(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw Object.assign(new Error(`--${name} must be a number.`), { code: "INVALID_ARGUMENT" });
  return parsed;
}

function idsFlag(flags: Flags, name: string): number[] | undefined {
  const value = flags.values.get(name);
  if (value === undefined) return undefined;
  const ids = value.split(",").map((item) => Number(item.trim()));
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw Object.assign(new Error(`--${name} takes comma-separated positive ids.`), { code: "INVALID_ARGUMENT" });
  return ids;
}

function pilotOptions(flags: Flags): PilotStepOptions {
  const step = flags.positional[0];
  if (!step) throw Object.assign(new Error("pilot-step needs a step name."), { code: "INVALID_ARGUMENT" });
  return {
    step,
    next: numberFlag(flags, "next"),
    abilities: idsFlag(flags, "abilities"),
    exclude: idsFlag(flags, "exclude"),
    samplePath: flags.values.get("sample"),
    seed: numberFlag(flags, "seed"),
    spendCapUsd: numberFlag(flags, "spend-cap"),
    jevCapUsd: numberFlag(flags, "jev-cap"),
    model: flags.values.get("model"),
    concurrency: numberFlag(flags, "concurrency"),
  };
}

/** Project state in one object: what an agent reads before choosing its next command. */
export function projectStatus(db: DatabaseSync): Record<string, unknown> {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const bytes = (view: Parameters<typeof getCurrentCoverage>[1]) => {
    let numerator = 0;
    let denominator = 0;
    for (const coverage of getCurrentCoverage(db, view).values()) { numerator += coverage.leaf_bytes.numerator; denominator += coverage.leaf_bytes.denominator; }
    return { numerator, denominator, fraction: denominator === 0 ? null : numerator / denominator };
  };
  const byAuthority = Object.fromEntries((db.prepare(`
    SELECT annotations.authority_kind AS authority, count(*) AS n FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE annotations.status = 'active' AND abilities.current = 1 GROUP BY 1
  `).all() as Array<{ authority: string; n: number }>).map((row) => [row.authority, row.n]));
  const familyEvidence = db.prepare(`
    SELECT fingerprints.family_id, count(*) AS occurrences, count(DISTINCT source_spans.normalized_surface) AS wordings, count(DISTINCT abilities.source_hash) AS texts,
      sum(annotations.authority_kind = 'human') AS human
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id AND abilities.current = 1
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND annotations.authority_kind IN ('human', 'derived')
    GROUP BY fingerprints.family_id
  `).all() as Array<{ family_id: string; occurrences: number; wordings: number; texts: number; human: number }>;
  const defined = new Set(REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated).map((family) => family.id));
  // Observed: any trusted occurrence (a confirmed surface's applications are derived, not human).
  const observed = familyEvidence.filter((row) => defined.has(row.family_id));
  const audit = authorityAudit(db);
  return {
    corpus: {
      records: count("SELECT count(*) AS n FROM abilities WHERE current = 1"),
      distinct_texts: count("SELECT count(DISTINCT source_hash) AS n FROM abilities WHERE current = 1"),
    },
    coverage: { trusted_leaf_bytes: bytes({}), with_machine_leaf_bytes: bytes({ includeMachine: true }) },
    annotations: byAuthority,
    surfaces: Object.fromEntries((db.prepare("SELECT authority_kind AS authority, count(*) AS n FROM leaf_surfaces WHERE status = 'active' GROUP BY 1").all() as Array<{ authority: string; n: number }>).map((row) => [row.authority, row.n])),
    proposals: Object.fromEntries((db.prepare("SELECT status, count(*) AS n FROM proposals GROUP BY 1").all() as Array<{ status: string; n: number }>).map((row) => [row.status, row.n])),
    families: {
      defined: defined.size,
      observed: observed.length,
      supported: observed.filter((row) => row.wordings >= 3 && row.texts >= 2).length,
      distinct_trusted_wordings: familyEvidence.reduce((sum, row) => sum + row.wordings, 0),
    },
    open_gaps: Object.fromEntries((db.prepare("SELECT type, count(*) AS n FROM gaps WHERE status = 'open' GROUP BY 1").all() as Array<{ type: string; n: number }>).map((row) => [row.type, row.n])),
    model_spend_usd: count("SELECT COALESCE(SUM(cost_usd), 0) AS n FROM model_runs"),
    // Horizontal-to-vertical trigger: composition work waits for 300 trusted leaf-complete texts.
    leaf_complete_texts: { count: leafCompleteTexts(db), trigger_at: 300 },
    recent_sessions: reviewSessions(db, 5),
    authority_migration: audit ? { flagged_rows: audit.flagged.length, reverted: audit.reverted, machine_surfaces: audit.surfaces.filter((surface) => surface.authority === "machine").length } : null,
  };
}

/** Run `read` against a read-only connection. */
function reading<T>(read: (db: DatabaseSync) => T): T {
  const db = openWorkbenchReadOnly();
  try { return read(db); } finally { db.close(); }
}

function artifactDirectory(): string {
  return resolve(process.env.ROUND5C_ARTIFACT_DIR ?? resolve(workbenchPath(), ".."));
}

function limitFlag(flags: Flags, fallback: number): number {
  const limit = numberFlag(flags, "limit") ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1) throw Object.assign(new Error("--limit must be a positive integer."), { code: "INVALID_ARGUMENT" });
  return limit;
}

function batchName(flags: Flags, command: string): string {
  const batch = flags.positional[0];
  if (!batch) throw Object.assign(new Error(`${command} needs a batch name.`), { code: "INVALID_ARGUMENT" });
  return batch;
}

const COMMANDS: Record<string, ControlCommand> = {
  frontier: {
    effect: () => "read", usage: `frontier [--kind ${FRONTIER_KINDS.join("|")}] [--limit N]`,
    summary: "Where the next human decision buys the most, weighted; each item names its action.",
    run: (flags) => {
      const kind = (flags.values.get("kind") ?? "wording") as FrontierKind;
      if (!FRONTIER_KINDS.includes(kind)) throw Object.assign(new Error(`--kind is one of ${FRONTIER_KINDS.join(", ")}.`), { code: "INVALID_ARGUMENT" });
      return reading((db) => frontier(db, kind, limitFlag(flags, 25)));
    },
  },
  "family-status": {
    effect: () => "read", usage: "family-status [--state DEFINED|OBSERVED|SUPPORTED|MATURE|DEPRECATED]",
    summary: "Every family's derived state and its trusted, machine and pending evidence.",
    run: (flags) => reading((db) => familyStatus(db).filter((family) => !flags.values.has("state") || family.state === flags.values.get("state"))),
  },
  "segmentation-health": {
    effect: () => "read", usage: "segmentation-health", summary: "Repair classes across every pilot step's frozen proposals, over reviewed texts.",
    run: () => reading((db) => segmentationHealth(db, artifactDirectory())),
  },
  "classification-health": {
    effect: () => "read", usage: "classification-health [--limit N]", summary: "Model and Jev family agreement with Will's decisions, and the top confusions.",
    run: (flags) => reading((db) => classificationHealth(db, limitFlag(flags, 15))),
  },
  gaps: {
    effect: () => "read", usage: "gaps [--limit N]", summary: "Recorded open gaps, plus derived leaf, composition and DSL gaps.",
    run: (flags) => reading((db) => gapsReport(db, limitFlag(flags, 15))),
  },
  query: {
    effect: () => "read", usage: "query <sql> [--limit N]", summary: "One SQL statement on a read-only connection.",
    run: (flags) => reading((db) => readQuery(db, flags.positional.join(" "), limitFlag(flags, 200))),
  },
  gates: {
    effect: () => "read", usage: "gates --abilities id,id [--machine] [--overlay-runs id,id]",
    summary: "Compile and gate the named abilities (trusted leaves; --machine adds machine rows, --overlay-runs pending proposals).",
    run: async (flags) => {
      const abilities = idsFlag(flags, "abilities");
      if (!abilities) throw Object.assign(new Error("gates needs --abilities."), { code: "INVALID_ARGUMENT" });
      const db = openWorkbenchReadOnly();
      try {
        const overlay = idsFlag(flags, "overlay-runs");
        const result = await runGatesOnly(db, { abilityVersionIds: new Set(abilities), view: { includeMachine: flags.switches.has("machine"), ...(overlay ? { overlayRunIds: overlay } : {}) } });
        return { fully_tiled: result.compile.fully_tiled, abilities: result.compile.abilities, failures: result.compile.failures };
      } finally { db.close(); }
    },
  },
  propagate: {
    effect: (flags) => flags.switches.has("dry-run") ? "read" : "derive",
    usage: "propagate --duplicate-texts [--abilities id,id] [--dry-run]",
    summary: "Copy trusted leaves and connectives onto byte-identical records as derived rows that follow their source. On the live workbench it keeps <db>.pre-run first.",
    run: (flags) => {
      if (!flags.switches.has("duplicate-texts")) throw Object.assign(new Error("propagate needs --duplicate-texts."), { code: "INVALID_ARGUMENT" });
      const abilities = idsFlag(flags, "abilities");
      const options = { dryRun: flags.switches.has("dry-run"), ...(abilities ? { abilityVersionIds: new Set(abilities) } : {}) };
      if (options.dryRun) return reading((db) => propagateDuplicateTexts(db, options));
      const backup = backupBeforeLiveRun(workbenchPath());
      const db = openWorkbench();
      try { return { backup, ...propagateDuplicateTexts(db, options) }; } finally { db.close(); }
    },
  },
  segment: {
    effect: (flags) => flags.switches.has("dry-run") ? "read" : "propose",
    usage: "segment <batch> (--abilities id,id | --unsegmented N) [--spend-cap USD] [--model id] [--concurrency N] [--dry-run]",
    summary: "DeepSeek segmentation as a resumable batch: named abilities, or the next N never-segmented distinct texts. On the live workbench it keeps <db>.pre-run first.",
    run: (flags) => {
      const unsegmented = numberFlag(flags, "unsegmented");
      const abilities = idsFlag(flags, "abilities") ?? (unsegmented ? reading((db) => unsegmentedAbilities(db, unsegmented)) : undefined);
      if (!abilities) throw Object.assign(new Error("segment needs --abilities or --unsegmented N."), { code: "INVALID_ARGUMENT" });
      return segmentBatch({ batch: batchName(flags, "segment"), abilities, spendCapUsd: numberFlag(flags, "spend-cap"), model: flags.values.get("model"), concurrency: numberFlag(flags, "concurrency"), dryRun: flags.switches.has("dry-run") });
    },
  },
  classify: {
    effect: (flags) => flags.switches.has("dry-run") ? "read" : "propose",
    usage: "classify <batch> [--spend-cap USD] [--dry-run]",
    summary: "Jev family ranking and parameters for every unclassified span a batch's runs proposed.",
    run: (flags) => classifyBatch({ batch: batchName(flags, "classify"), spendCapUsd: numberFlag(flags, "spend-cap"), dryRun: flags.switches.has("dry-run") }),
  },
  "review-apply": {
    effect: () => "human", usage: "review-apply <decisions.json>",
    summary: "Apply Will's decisions from a conversational review (confirm, correct, reject, novel, ambiguous, connective; pilot-reviewed marks) as his own.",
    run: (flags) => {
      const path = flags.positional[0];
      if (!path) throw Object.assign(new Error("review-apply needs a decisions file."), { code: "INVALID_ARGUMENT" });
      const db = openWorkbench();
      try { return applyChatReviewFile(db, path); } finally { db.close(); }
    },
  },
  commands: {
    effect: () => "read", usage: "commands", summary: "This catalog: every control command, its effect and usage.",
    run: () => Object.entries(COMMANDS).map(([name, command]) => ({ name, usage: command.usage, summary: command.summary })),
  },
  status: {
    effect: () => "read", usage: "status", summary: "Corpus, trusted and machine coverage, authority counts, family evidence, gaps and spend.",
    run: () => {
      const db = openWorkbenchReadOnly();
      try { return projectStatus(db); } finally { db.close(); }
    },
  },
  "pilot-step": {
    effect: (flags) => flags.switches.has("dry-run") || flags.switches.has("report-only") ? "read" : "machine",
    usage: "pilot-step <name> [--next N | --abilities id,id] [--spend-cap USD] [--jev-cap USD] [--model id] [--concurrency N] [--sample path] [--seed N] [--exclude id,id] [--dry-run | --report-only]",
    summary: "Run or resume one pilot step on a copy of the workbench (segment, classify, freeze, gate, report); --dry-run plans it, --report-only reports it after review.",
    run: async (flags) => {
      const options = pilotOptions(flags);
      if (flags.switches.has("dry-run")) return planPilotStep(options);
      if (flags.switches.has("report-only")) return reportPilotStep(options);
      return runPilotStep(options);
    },
  },
};

/** Run a control command if `command` names one; returns false for the legacy commands. */
export async function runControlCommand(command: string | undefined, args: readonly string[]): Promise<boolean> {
  if (!command || !Object.hasOwn(COMMANDS, command)) return false;
  const definition = COMMANDS[command]!;
  const flags = parseFlags(args);
  const effect = definition.effect(flags);
  const envelope: Record<string, unknown> = { ok: true, command, effect, db_path: workbenchPath() };
  try {
    envelope.data = await definition.run(flags);
    try {
      const db = openWorkbenchReadOnly();
      try { envelope.data_epoch = getDataEpoch(db); } finally { db.close(); }
    } catch {
      envelope.data_epoch = null;
    }
    envelope.errors = [];
  } catch (error) {
    envelope.ok = false;
    envelope.errors = [{ code: (error as { code?: string }).code ?? "FAILED", message: error instanceof Error ? error.message : String(error) }];
    process.exitCode = 1;
  }
  console.log(JSON.stringify(envelope, null, 2));
  return true;
}
