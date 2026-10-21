/**
 * apply.ts — the single seam through which every MFM-ingest subcommand persists
 * its result.
 *
 * The bug this exists to kill: the ingest used to gate both its in-memory
 * mutations AND its `fs.writeFileSync` calls behind `if (write)`, so a dry run
 * computed change *counts* but never built the post-ingest dataset — it could not
 * see an orphan, a duplicate id, or a schema violation, because none of those
 * exist until `--write` flips the mutations on. "Clean dry run → exception (or
 * silent corruption) on write" was therefore guaranteed, not bad luck.
 *
 * The fix is a strict split: subcommands now apply their mutations in BOTH modes
 * and hand the fully-projected file contents here as {@link StagedWrite}s. This
 * function validates that projected dataset with the exact AJV + referential
 * integrity checks `npm run validate` runs (against a throwaway overlay tree, so
 * the real data is never touched until it is known-good), and:
 *   - throws on any failure in BOTH modes, so a dry run fails on precisely what a
 *     write would have produced; and
 *   - only when valid AND `write` is requested, persists each file via a temporary
 *     file + rename. Validation happens before any rename, but multiple renames do
 *     not constitute a filesystem transaction.
 *
 * Net contract: a clean dry run guarantees a clean write.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type Ajv from "ajv";
import { escape as globEscape, globSync } from "glob";
import { createValidator } from "../schema-loader.js";
import { validateFiles, type ValidationResult } from "../validate.js";
import { checkReferentialIntegrity } from "../integrity.js";
import { formatReport } from "../report.js";
import { REPO_ROOT } from "./repo-files.js";

const DATA_ROOT = path.join(REPO_ROOT, "data");

export interface StagedWrite {
  /** Absolute path, under the selected data root, of the file to (re)write. */
  path: string;
  /** Full new contents — a JSON-serializable array of entities. */
  value: unknown;
  /**
   * Optional pre-serialized file text to persist verbatim instead of the default
   * `JSON.stringify(value, 2)`. Lets a subcommand preserve a file's hand-authored
   * formatting (so the diff is only the changed values). When present it MUST
   * `JSON.parse` to a value deep-equal to {@link value}; the validation overlay
   * uses this text, so a mismatch would validate something other than `value`.
   */
  text?: string;
}

export interface ApplyOptions {
  write: boolean;
  /** Short label for log lines, e.g. "wargear". */
  label: string;
}

export interface PrepareWriteOptions {
  /** Short label for log lines, e.g. "wargear". */
  label: string;
  /** Validation tree to snapshot. Defaults to the repository data directory. */
  dataRoot?: string;
  /** Bound diagnostic rendering, without skipping validation or hiding failed records. */
  maxDiagnosticsPerRecord?: number;
  /** Audit the complete input tree even when there are no changed files. */
  validateUnchanged?: boolean;
}

export interface PreparedWrites {
  /**
   * Persist the exact bytes that were validated, after verifying that every
   * validation input still has the snapshotted content. May be called once.
   */
  commit(): void;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
interface InputSnapshot {
  readonly hashes: ReadonlyMap<string, string>;
  readonly bytes: ReadonlyMap<string, Buffer>;
}

interface PreparedWrite {
  readonly path: string;
  readonly relativePath: string;
  readonly text: string;
}

function validationInputPaths(dataRoot: string): string[] {
  return globSync("{core,enrichment}/**/*.json", {
    cwd: dataRoot,
    nodir: true,
  }).sort();
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read every validation input exactly once. The retained buffers are both the
 * snapshot being hashed and the bytes copied into the projected validation tree.
 */
function snapshotInputs(dataRoot: string): InputSnapshot {
  const hashes = new Map<string, string>();
  const bytes = new Map<string, Buffer>();
  for (const relativePath of validationInputPaths(dataRoot)) {
    const content = fs.readFileSync(path.join(dataRoot, relativePath));
    bytes.set(relativePath, content);
    hashes.set(relativePath, digest(content));
  }
  return { hashes, bytes };
}

function prepareStagedWrites(
  staged: StagedWrite[],
  configuredRoot: string,
  dataRoot: string,
  label: string,
): PreparedWrite[] {
  return staged.map((item) => {
    const target = path.resolve(item.path);
    const relativePath = path.relative(configuredRoot, target);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(`[${label}] staged path escapes the data root: ${item.path}`);
    }
    let canonicalTarget: string;
    try {
      canonicalTarget = fs.realpathSync(target);
    } catch (error) {
      throw new Error(`[${label}] staged destination must already exist under the data root: ${item.path}. ${(error as Error).message}`);
    }
    if (
      canonicalTarget !== path.join(dataRoot, relativePath)
      || fs.lstatSync(target).isSymbolicLink()
      || !canonicalTarget.startsWith(`${dataRoot}${path.sep}`)
    ) throw new Error(`[${label}] staged destination is symlinked or escapes the data root: ${item.path}`);
    return {
      path: canonicalTarget,
      relativePath,
      text: item.text ?? serialize(item.value),
    };
  });
}

function assertPreparedDestinations(
  prepared: readonly PreparedWrite[],
  dataRoot: string,
  label: string,
): void {
  for (const item of prepared) {
    let current: string;
    try {
      current = fs.realpathSync(item.path);
    } catch (error) {
      throw new Error(`[${label}] staged destination changed after preparation: ${item.path}. ${(error as Error).message}`);
    }
    if (
      current !== item.path
      || fs.lstatSync(item.path).isSymbolicLink()
      || !current.startsWith(`${dataRoot}${path.sep}`)
    ) throw new Error(`[${label}] staged destination became symlinked or escaped the data root after preparation: ${item.path}`);
  }
}

function assertInputsUnchanged(
  expected: ReadonlyMap<string, string>,
  dataRoot: string,
  label: string,
): void {
  let current: ReadonlyMap<string, string>;
  try {
    const hashes = new Map<string, string>();
    for (const relativePath of validationInputPaths(dataRoot)) {
      hashes.set(relativePath, digest(fs.readFileSync(path.join(dataRoot, relativePath))));
    }
    current = hashes;
  } catch (error) {
    throw new Error(
      `[${label}] validation inputs changed after preparation; refusing to write. ` +
        `Could not re-read the current input set: ${(error as Error).message}. Nothing was written.`,
    );
  }

  const added = [...current.keys()].filter((file) => !expected.has(file));
  const deleted = [...expected.keys()].filter((file) => !current.has(file));
  const changed = [...expected.keys()].filter(
    (file) => current.get(file) !== undefined && current.get(file) !== expected.get(file),
  );
  if (added.length === 0 && deleted.length === 0 && changed.length === 0) return;

  const details = [
    added.length > 0 ? `Added: ${added.join(", ")}` : "",
    deleted.length > 0 ? `Deleted: ${deleted.join(", ")}` : "",
    changed.length > 0 ? `Changed: ${changed.join(", ")}` : "",
  ].filter(Boolean);
  throw new Error(
    `[${label}] validation inputs changed after preparation; refusing to write. ` +
      `${details.join(". ")}. Nothing was written.`,
  );
}

/** Combine the two `validateFiles` halves into one report for formatting. */
function mergeSchema(a: ValidationResult, b: ValidationResult): ValidationResult {
  return {
    totalFiles: a.totalFiles + b.totalFiles,
    totalItems: a.totalItems + b.totalItems,
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    errors: [...a.errors, ...b.errors],
  };
}

/** What validating a projected dataset found; error `file`s are relative to the data root. */
export interface ProjectionValidation {
  /** Failed records across schema and referential integrity; zero means the projection is valid. */
  failed: number;
  entities: number;
  schema: ValidationResult;
  integrity: ValidationResult;
}

/** Copy the input bytes into a fresh throwaway `data/` tree. */
function writeTree(inputs: ReadonlyMap<string, Buffer>): { tmpRoot: string; projRoot: string } {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "40kdc-ingest-"));
  const projRoot = path.join(tmpRoot, "data");
  try {
    for (const [relativePath, content] of inputs) {
      const destination = path.join(projRoot, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }
  } catch (error) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    throw error;
  }
  return { tmpRoot, projRoot };
}

function writeOverlays(projRoot: string, overlays: ReadonlyArray<{ readonly relativePath: string; readonly text: string }>): void {
  for (const item of overlays) {
    const destination = path.join(projRoot, item.relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.text);
  }
}

/** The throwaway tree is gone once validation returns; name files as the data root does. */
function relativeFiles(result: ValidationResult, projRoot: string): ValidationResult {
  return {
    ...result,
    errors: result.errors.map((error) => ({
      ...error,
      file: path.isAbsolute(error.file) ? path.relative(projRoot, error.file).split(path.sep).join("/") : error.file,
    })),
  };
}

type Validators = { ajv: Ajv; fast: Ajv };

function freshValidators(): Validators {
  return { ajv: createValidator(), fast: createValidator({ allErrors: false }) };
}

/** AJV-validate every data file under `projRoot` matching `patterns`, as `npm run validate` does. */
async function schemaResult(projRoot: string, patterns: readonly string[], { ajv, fast }: Validators = freshValidators()): Promise<ValidationResult> {
  let merged: ValidationResult = { totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] };
  for (const pattern of patterns) merged = mergeSchema(merged, await validateFiles(ajv, pattern, projRoot, fast));
  return relativeFiles(merged, projRoot);
}

const ALL_DATA_FILES = ["core/**/*.json", "enrichment/**/*.json"] as const;

/**
 * Validate the input bytes with the overlays written over them, in a throwaway tree, with the
 * exact AJV + referential integrity checks `npm run validate` runs.
 */
async function validateOverlay(
  inputs: ReadonlyMap<string, Buffer>,
  overlays: ReadonlyArray<{ readonly relativePath: string; readonly text: string }>,
): Promise<ProjectionValidation> {
  const { tmpRoot, projRoot } = writeTree(inputs);
  try {
    writeOverlays(projRoot, overlays);
    const schema = await schemaResult(projRoot, ALL_DATA_FILES);
    const integrity = relativeFiles(await checkReferentialIntegrity(projRoot), projRoot);
    return { failed: schema.failed + integrity.failed, entities: schema.totalItems, schema, integrity };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

/** Validates many alternative projections of one data-root snapshot; see {@link openProjectionChecker}. */
export interface ProjectionChecker {
  /**
   * What {@link prepareWrites} would find for these staged writes over the snapshot, returned
   * instead of thrown. Each call sees only its own writes; overlapping calls run one at a time.
   */
  validate(staged: StagedWrite[]): Promise<ProjectionValidation>;
  /** Remove the throwaway tree. */
  close(): void;
}

/**
 * Snapshot the data root once into a throwaway tree for validating many alternative overlays,
 * each exactly as {@link prepareWrites} would. Files an overlay leaves untouched keep the schema
 * result of the snapshot, so a call schema-validates only its own files; referential integrity
 * spans files and runs in full on every call. Each overlay is reverted after its call.
 */
export function openProjectionChecker(opts: PrepareWriteOptions): ProjectionChecker {
  const configuredRoot = path.resolve(opts.dataRoot ?? DATA_ROOT);
  const dataRoot = fs.realpathSync(configuredRoot);
  const inputs = snapshotInputs(dataRoot).bytes;
  const { tmpRoot, projRoot } = writeTree(inputs);
  // AJV compiles each schema on first use; one pair serves every call.
  const validators = freshValidators();
  let baseline: Promise<ValidationResult> | undefined;
  // Calls share one tree, so each waits for the previous one's overlay to be reverted.
  let previous: Promise<unknown> = Promise.resolve();
  const validateOne = async (staged: StagedWrite[]): Promise<ProjectionValidation> => {
    const prepared = prepareStagedWrites(staged, configuredRoot, dataRoot, opts.label);
    baseline ??= schemaResult(projRoot, ALL_DATA_FILES, validators);
    const unchanged = await baseline;
    const touched = new Set(prepared.map((item) => item.relativePath.split(path.sep).join("/")));
    const patterns = [...touched].map((file) => globEscape(file));
    const before = await schemaResult(projRoot, patterns, validators);
    try {
      writeOverlays(projRoot, prepared);
      const after = await schemaResult(projRoot, patterns, validators);
      const kept = unchanged.errors.filter((error) => !touched.has(error.file));
      const schema: ValidationResult = {
        totalFiles: unchanged.totalFiles - before.totalFiles + after.totalFiles,
        totalItems: unchanged.totalItems - before.totalItems + after.totalItems,
        passed: unchanged.passed - before.passed + after.passed,
        failed: kept.length + after.failed,
        errors: [...kept, ...after.errors],
      };
      const integrity = relativeFiles(await checkReferentialIntegrity(projRoot), projRoot);
      return { failed: schema.failed + integrity.failed, entities: schema.totalItems, schema, integrity };
    } finally {
      for (const item of prepared) {
        const original = inputs.get(item.relativePath);
        const destination = path.join(projRoot, item.relativePath);
        if (original) fs.writeFileSync(destination, original);
        else fs.rmSync(destination, { force: true });
      }
    }
  };
  return {
    validate(staged) {
      const run = previous.then(() => validateOne(staged));
      previous = run.catch(() => undefined);
      return run;
    },
    close() {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Snapshot and validate the projected dataset (current validation inputs plus
 * staged overlays), retaining the exact staged bytes for a later synchronous
 * commit. The commit refuses to write if any validation input was added, removed,
 * or changed after the snapshot.
 */
export async function prepareWrites(
  staged: StagedWrite[],
  opts: PrepareWriteOptions,
): Promise<PreparedWrites> {
  if (staged.length === 0 && !opts.validateUnchanged) {
    console.log(`[${opts.label}] no file changes to apply.`);
    let used = false;
    return {
      commit(): void {
        if (used) throw new Error(`[${opts.label}] prepared write commit already used.`);
        used = true;
      },
    };
  }

  const configuredRoot = path.resolve(opts.dataRoot ?? DATA_ROOT);
  const dataRoot = fs.realpathSync(configuredRoot);
  const prepared = prepareStagedWrites(staged, configuredRoot, dataRoot, opts.label);
  const inputSnapshot = snapshotInputs(dataRoot);
  const inputHashes = inputSnapshot.hashes;

  const projected = await validateOverlay(inputSnapshot.bytes, prepared);
  if (projected.failed > 0) {
    const detail =
      formatReport(projected.schema, "pretty", "40kdc Data Validation Report", opts.maxDiagnosticsPerRecord) +
      "\n" +
      formatReport(projected.integrity, "pretty", "40kdc Referential Integrity Report", opts.maxDiagnosticsPerRecord);
    throw new Error(
      `[${opts.label}] projected dataset FAILS validation (${projected.failed} error(s)). ` +
        `Nothing was written. This is exactly what --write would have produced.\n${detail}`,
    );
  }

  console.log(
    `[${opts.label}] projected dataset valid — ${prepared.length} file(s), ` +
      `${projected.entities} entities checked.`,
  );

  let used = false;
  return {
    commit(): void {
      if (used) throw new Error(`[${opts.label}] prepared write commit already used.`);
      used = true;
      assertPreparedDestinations(prepared, dataRoot, opts.label);
      assertInputsUnchanged(inputHashes, dataRoot, opts.label);

      const written: string[] = [];
      try {
        for (const item of prepared) {
          const tmp = `${item.path}.ingest-tmp`;
          fs.writeFileSync(tmp, item.text);
          fs.renameSync(tmp, item.path);
          written.push(item.path);
        }
      } catch (error) {
        throw new Error(
          `[${opts.label}] I/O FAULT after ${written.length}/${prepared.length} files written ` +
            `(validation had passed). Written: ${written
              .map((file) => path.relative(dataRoot, file))
              .join(", ")}. Cause: ${(error as Error).message}`,
        );
      }
      console.log(`[${opts.label}] wrote ${written.length} file(s).`);
    },
  };
}

/**
 * Validate the projected dataset and, when requested, immediately commit it.
 * Existing callers retain their dry-run/write behavior.
 */
export async function applyWrites(staged: StagedWrite[], opts: ApplyOptions): Promise<void> {
  const prepared = await prepareWrites(staged, { label: opts.label });
  if (opts.write) prepared.commit();
}
