import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";

import type { AbilityGateResult, GateFailure, LeverDiff } from "./pipeline-8b-gates.js";
import { runGatesOnly } from "./pipeline-8b.js";
import { reviewMembers, type ReviewMember } from "./shapes.js";
import { UNSIGNED_REVIEWER, type ChatDecision } from "./review-apply.js";

/**
 * One faction's publication review: every fully described source compiled and gated, its
 * compiled render beside the published one, and the `approve-shape` decisions a reviewer would
 * sign for the members that pass every gate. Read-only; the decisions are a draft for Will.
 */

export type ReviewSheetRow = ReviewMember & {
  gates: AbilityGateResult["gates"];
  compile_errors: string[];
  failures: GateFailure[];
  lever_diff: LeverDiff | null;
};

export type ReviewSheet = {
  faction_id: string;
  totals: { tiled: number; all_gates: number; changed: number; unchanged: number; approved: number; failing: number };
  /** All gates pass, compiled differs from published, not yet approved: the rows to read. */
  changed: ReviewSheetRow[];
  /** Pass every gate but would publish nothing new. */
  unchanged: Array<Pick<ReviewSheetRow, "ability_version_id" | "ability_id" | "signature">>;
  approved: Array<Pick<ReviewSheetRow, "ability_version_id" | "ability_id" | "signature">>;
  failing: Array<Pick<ReviewSheetRow, "ability_version_id" | "ability_id" | "signature" | "compile_errors" | "failures" | "errors">>;
  /** A decisions file for `review-apply`, unsigned: the reviewer fills in their own name. */
  proposed_decisions: { reviewer: string; decisions: ChatDecision[] };
};

export async function factionReviewSheet(db: DatabaseSync, factionId: string): Promise<ReviewSheet> {
  const members = reviewMembers(db, { factionId });
  const ids = new Set(members.map((member) => member.ability_version_id));
  // The trusted view and default describer floor: exactly what `gates` reports.
  const report = (await runGatesOnly(db, { abilityVersionIds: ids })).compile;
  const gated = new Map(report.abilities.map((row) => [row.ability_version_id, row]));
  const levers = new Map(report.lever_diffs.map((diff) => [diff.ability_id, diff]));
  const failures = new Map<string, GateFailure[]>();
  for (const failure of report.failures) failures.set(failure.ability_id, [...(failures.get(failure.ability_id) ?? []), failure]);

  const rows: ReviewSheetRow[] = members.map((member) => {
    const gate = gated.get(member.ability_version_id);
    return {
      ...member, gates: gate?.gates ?? null, compile_errors: gate?.compile_errors ?? [],
      failures: failures.get(member.ability_id) ?? [], lever_diff: levers.get(member.ability_id) ?? null,
    };
  });
  const passes = (row: ReviewSheetRow) => row.gates?.all === true && row.errors.length === 0;
  const brief = (row: ReviewSheetRow) => ({ ability_version_id: row.ability_version_id, ability_id: row.ability_id, signature: row.signature });
  const changed = rows.filter((row) => passes(row) && row.differs && row.state !== "approved");
  const unchanged = rows.filter((row) => passes(row) && !row.differs && row.state !== "approved");
  const approved = rows.filter((row) => row.state === "approved");
  const failing = rows.filter((row) => !passes(row));

  // One decision per shape over its passing, not-yet-approved members. A rejected member stays
  // out: approving it again is a new judgement, not a default.
  const bySignature = new Map<string, number[]>();
  for (const row of [...changed, ...unchanged]) {
    if (row.state === "rejected") continue;
    bySignature.set(row.signature, [...(bySignature.get(row.signature) ?? []), row.ability_version_id]);
  }
  const decisions: ChatDecision[] = [...bySignature].sort(([left], [right]) => left.localeCompare(right))
    .map(([signature, abilityVersionIds]) => ({ action: "approve-shape", signature, ability_version_ids: abilityVersionIds }));

  return {
    faction_id: factionId,
    totals: { tiled: rows.length, all_gates: rows.length - failing.length, changed: changed.length, unchanged: unchanged.length, approved: approved.length, failing: failing.length },
    changed: changed.sort((left, right) => left.signature.localeCompare(right.signature) || left.ability_id.localeCompare(right.ability_id)),
    unchanged: unchanged.map(brief),
    approved: approved.map(brief),
    failing: failing.map((row) => ({ ...brief(row), compile_errors: row.compile_errors, failures: row.failures, errors: row.errors })),
    proposed_decisions: { reviewer: UNSIGNED_REVIEWER, decisions },
  };
}

/** The sheet as Markdown for reading in an editor: changed rows grouped by shape, renders side by side. */
export function reviewSheetMarkdown(sheet: ReviewSheet): string {
  const lines = [`# ${sheet.faction_id} publication review`, "", `| tiled | all gates | changed | unchanged | approved | failing |`, `|---:|---:|---:|---:|---:|---:|`,
    `| ${sheet.totals.tiled} | ${sheet.totals.all_gates} | ${sheet.totals.changed} | ${sheet.totals.unchanged} | ${sheet.totals.approved} | ${sheet.totals.failing} |`, ""];
  let signature: string | null = null;
  for (const row of sheet.changed) {
    if (row.signature !== signature) { signature = row.signature; lines.push(`## ${signature}`, ""); }
    const diff = row.lever_diff ? ` — levers applied ${row.lever_diff.old_applied}→${row.lever_diff.new_applied}, unsupported ${row.lever_diff.old_unsupported}→${row.lever_diff.new_unsupported}` : "";
    lines.push(`### ${row.ability_id} (v${row.ability_version_id}, ${row.state})${diff}`, "", `- published: ${row.authored_text ?? "(none)"}`, `- compiled: ${row.compiled_text ?? "(none)"}`, "");
  }
  if (sheet.failing.length > 0) {
    lines.push("## Failing gates", "");
    for (const row of sheet.failing) {
      const reasons = [...row.compile_errors, ...row.errors, ...row.failures.map((failure) => `${failure.reason}: ${failure.detail}`)];
      lines.push(`- ${row.ability_id} (v${row.ability_version_id}): ${reasons.join("; ") || "not gated"}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

/** Write the sheet's Markdown and decisions. Inside the repository only `_private/` is allowed. */
export function writeReviewSheet(sheet: ReviewSheet, outDir: string): { markdown: string; decisions: string } {
  const dir = resolve(outDir);
  const inRepo = relative(REPO_ROOT, dir);
  if (!inRepo.startsWith("..") && !(inRepo === "_private" || inRepo.startsWith(`_private${sep}`))) {
    throw Object.assign(new Error(`Review sheets hold rule-derived text; write them under _private/, not ${inRepo || "."}.`), { code: "INVALID_ARGUMENT" });
  }
  const markdown = resolve(dir, `${sheet.faction_id}.md`);
  const decisions = resolve(dir, `${sheet.faction_id}.decisions.json`);
  mkdirSync(dirname(markdown), { recursive: true });
  writeFileSync(markdown, reviewSheetMarkdown(sheet));
  writeFileSync(decisions, `${JSON.stringify(sheet.proposed_decisions, null, 2)}\n`);
  return { markdown, decisions };
}
