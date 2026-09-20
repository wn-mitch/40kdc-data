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
import { globSync } from "glob";
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
  if (staged.length === 0) {
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

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "40kdc-ingest-"));
  const projRoot = path.join(tmpRoot, "data");
  try {
    for (const [relativePath, content] of inputSnapshot.bytes) {
      const destination = path.join(projRoot, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }
    for (const item of prepared) {
      const destination = path.join(projRoot, item.relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, item.text);
    }

    const ajv = createValidator();
    const core = await validateFiles(ajv, "core/**/*.json", projRoot);
    const enrich = await validateFiles(ajv, "enrichment/**/*.json", projRoot);
    const integrity = await checkReferentialIntegrity(projRoot);

    const failed = core.failed + enrich.failed + integrity.failed;
    if (failed > 0) {
      const detail =
        formatReport(mergeSchema(core, enrich), "pretty") +
        "\n" +
        formatReport(integrity, "pretty", "40kdc Referential Integrity Report");
      throw new Error(
        `[${opts.label}] projected dataset FAILS validation (${failed} error(s)). ` +
          `Nothing was written. This is exactly what --write would have produced.\n${detail}`,
      );
    }

    console.log(
      `[${opts.label}] projected dataset valid — ${prepared.length} file(s), ` +
        `${core.totalItems + enrich.totalItems} entities checked.`,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

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
