/**
 * `npm run mfm:mirror [-- --write] [--dump <path>] [--out <dir>] [--skip-dirs a,b]`
 *
 * Dry run by default: computes the mirror, validates the projected dataset, and writes the report
 * to `_private/phase4/mirror-dryrun/` (or `--out`). `--write` applies it, and only when the
 * projection validates. `--skip-dirs` leaves those repo dirs untouched and writes their pending
 * rewrites to `_private/phase4/mirror-port-rewrites.json`.
 *
 * Every write merges its context-free renames into `_private/phase4/mirror-id-history.json`, which
 * later runs read, so a literal a skipped dir still holds resolves after the data has moved on.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DUMP_PATH, loadDump } from "../loader.js";
import { REPO_ROOT } from "../repo-files.js";
import { runMirror, writeMirror } from "./mirror.js";
import type { IdHistory } from "./plan.js";
import { writeReport } from "./report.js";

const HISTORY = path.join(REPO_ROOT, "_private", "phase4", "mirror-id-history.json");
const PENDING = path.join(REPO_ROOT, "_private", "phase4", "mirror-port-rewrites.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Earlier renames first, this run's on top (a later run decides for the ids it still sees). */
export function mergeHistory(a: IdHistory, b: IdHistory): IdHistory {
  const out: IdHistory = {};
  for (const kind of ["ability", "stratagem", "enhancement"] as const) out[kind] = { ...(a[kind] ?? {}), ...(b[kind] ?? {}) };
  return out;
}

export interface MirrorCommandOptions {
  dumpPath: string;
  write: boolean;
  /** Report dir, relative to the repo root. */
  out?: string;
  skipDirs?: string[];
}

/** Compute the mirror, write its report, and apply it on `write` (only when the projection validates). */
export async function runMirrorCommand(opts: MirrorCommandOptions): Promise<void> {
  const { write, dumpPath } = opts;
  const out = path.resolve(REPO_ROOT, opts.out ?? "_private/phase4/mirror-dryrun");
  const skipDirs = opts.skipDirs ?? [];
  const history: IdHistory = existsSync(HISTORY) ? (JSON.parse(readFileSync(HISTORY, "utf8")) as IdHistory) : {};
  const result = await runMirror(loadDump(dumpPath), { attachmentRoles: true, validate: true, outside: true, skipDirs, history });
  const s = writeReport(result, out);
  console.log(
    `mfm:mirror ${write ? "write" : "dry run"}: ${s.records} records (${s.renamed} renamed, ${s.merged} folded, ` +
      `${Object.values(s.removed).reduce((a, b) => a + b, 0)} removed), ${Object.values(s.stubs).reduce((a, b) => a + b, 0)} stubs, ` +
      `${s.filesChanged} files, ${result.pending.length} pending in skipped dirs, ${Object.values(s.undecided).reduce((a, b) => a + b, 0)} undecided; ` +
      `validation ${s.validation}. Report: ${path.relative(REPO_ROOT, out)}`,
  );
  writeFileSync(path.join(out, "port-rewrites.json"), `${JSON.stringify(result.pending, null, 2)}\n`);
  if (!write) return;
  const nextHistory = mergeHistory(history, result.plan.history());
  await writeMirror(result);
  mkdirSync(path.dirname(HISTORY), { recursive: true });
  writeFileSync(HISTORY, `${JSON.stringify(nextHistory, null, 2)}\n`);
  if (skipDirs.length) writeFileSync(PENDING, `${JSON.stringify(result.pending, null, 2)}\n`);
  console.log(`mfm:mirror: wrote ${result.files.length} files; ${result.pending.length} rewrites pending in ${skipDirs.join(", ") || "(none)"}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMirrorCommand({
    dumpPath: arg("--dump") ?? DEFAULT_DUMP_PATH,
    write: process.argv.includes("--write"),
    out: arg("--out"),
    skipDirs: (arg("--skip-dirs") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  }).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
