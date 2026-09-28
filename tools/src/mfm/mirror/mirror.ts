/**
 * `npm run mfm:mirror` — derive ability identity from the dump, mirror records and references,
 * and rewrite every repo reference through the (faction, old id) → new id map it computes.
 * A pure function of (dump, repo): a second run on the same dump changes nothing.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { prepareWrites, type StagedWrite } from "../apply.js";
import { runAttachmentRoles } from "../attachment.js";
import { enumerateAbilityRows } from "../dump-prose-rows.js";
import type { MfmDump } from "../loader.js";
import { recKey } from "./match.js";
import { type PendingRewrite, projectOutside } from "./outside.js";
import { buildPlan, type IdHistory, type MirrorPlan, type Undecided } from "./plan.js";
import { type FileChange, projectData, type RewriteLog } from "./project.js";
import { loadRepo, type RepoSnapshot } from "./repo.js";
import { type Collision, findCollisions, oneToMany, type ValidationOutcome, validateProjection } from "./verify.js";

export interface MirrorResult {
  plan: MirrorPlan;
  snap: RepoSnapshot;
  files: FileChange[];
  /** Rewrites held back from skipped dirs. */
  pending: PendingRewrite[];
  log: RewriteLog[];
  undecided: Undecided[];
  collisions: Collision[];
  oneToMany: string[];
  validation?: ValidationOutcome;
}

export interface MirrorOptions {
  /** Repo root; defaults to this checkout. */
  root?: string;
  /** Run the attachment-role ingest for Leader/Support (reads the real repo; off for fixture repos). */
  attachmentRoles?: boolean;
  /** Validate the projected data (AJV + integrity). */
  validate?: boolean;
  /** Include rewrites outside `data/` (overrides, conformance, tests, code, registry). */
  outside?: boolean;
  /** Repo-relative dirs left untouched; their rewrites come back in `pending`. */
  skipDirs?: readonly string[];
  /** Earlier writes' renames, so literals a skipped dir kept still resolve. */
  history?: IdHistory;
}

/** Compute the mirror without writing anything. */
export async function runMirror(dump: MfmDump, opts: MirrorOptions = {}): Promise<MirrorResult> {
  const snap = loadRepo(opts.root);
  const set = enumerateAbilityRows(dump);
  const roles = new Map<string, "leader" | "support">();
  const notes: Undecided[] = [];
  if (opts.attachmentRoles) {
    const report = runAttachmentRoles(dump);
    for (const d of report.dirs) for (const c of d.changes) roles.set(recKey(d.dir, c.id), c.to as "leader" | "support");
    // Only the roles: its eligibility rewrites are that ingest's own change, reported not carried.
    for (const s of report.staged) {
      if (!s.path.endsWith("leader-attachments.json")) continue;
      notes.push({ kind: "attachment-ingest-drift", where: path.relative(snap.root, s.path).split(path.sep).join("/"), detail: "the attachment-role ingest would also rewrite this file; run it on its own" });
    }
  }
  const plan = buildPlan(dump, set, snap, { roles, ...(opts.history ? { history: opts.history } : {}) });
  const data = projectData(plan, snap);
  const outside = opts.outside === false ? { files: [], pending: [], log: [], undecided: [] } : projectOutside(plan, snap, { skipDirs: opts.skipDirs ?? [], projected: new Map(data.files.map((f) => [f.abs, f.after])) });
  const files = [...data.files, ...outside.files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const result: MirrorResult = {
    plan,
    snap,
    files,
    pending: outside.pending,
    log: [...data.log, ...outside.log],
    undecided: [...plan.undecided, ...data.undecided, ...outside.undecided, ...notes],
    collisions: findCollisions(snap, files),
    oneToMany: oneToMany(plan),
  };
  if (opts.validate !== false) result.validation = await validateProjection(snap, files);
  return result;
}

/**
 * Persist a computed mirror. Refuses unless the projection validated. Data files go through
 * `apply.ts` (re-validated on the real tree, written only after that passes); files the mirror
 * creates are created empty first so `apply.ts` can stage over them; files outside `data/` are
 * written last, each through a temporary file.
 */
export async function writeMirror(result: MirrorResult): Promise<void> {
  if (!result.validation?.ok) throw new Error(`mfm:mirror: the projection does not validate; nothing written.\n${result.validation?.message ?? "(not validated)"}`);
  if (result.oneToMany.length) throw new Error(`mfm:mirror: one-to-many renames; nothing written:\n${result.oneToMany.join("\n")}`);
  const data = result.files.filter((f) => f.rel.startsWith("data/core/") || f.rel.startsWith("data/enrichment/"));
  const rest = result.files.filter((f) => !data.includes(f));
  for (const f of data) {
    if (existsSync(f.abs)) continue;
    mkdirSync(path.dirname(f.abs), { recursive: true });
    writeFileSync(f.abs, "[]\n");
  }
  const staged: StagedWrite[] = data.map((f) => ({ path: f.abs, value: JSON.parse(f.after), text: f.after }));
  const prepared = await prepareWrites(staged, { label: "mfm:mirror" });
  prepared.commit();
  for (const f of rest) {
    const tmp = `${f.abs}.mirror-tmp`;
    writeFileSync(tmp, f.after);
    renameSync(tmp, f.abs);
  }
}
