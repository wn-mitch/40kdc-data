import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyWrites, prepareWrites, type StagedWrite } from "../src/mfm/apply.js";
import { REPO_ROOT } from "../src/mfm/repo-files.js";

/**
 * Contract of {@link applyWrites} — the seam that makes an MFM-ingest dry run a
 * faithful rehearsal of `--write`:
 *
 *   1. It validates the PROJECTED dataset (real tree + staged overlays) with the
 *      exact AJV schema + referential-integrity checks `npm run validate` runs.
 *   2. It throws on any failure in BOTH modes — so a dry run fails on precisely
 *      what a write would have produced.
 *   3. It writes nothing unless the projection is valid AND `write` is requested;
 *      a failed projection leaves every target file byte-for-byte untouched.
 *
 * These tests read the live `data/` tree, so they assert against the real schemas
 * and the real integrity rules rather than a fixture that could drift from them.
 */
const DATA_ROOT = path.join(REPO_ROOT, "data");
const WE = path.join(DATA_ROOT, "core", "world-eaters");
const OPTS = path.join(WE, "wargear-options.json");
const UNITS = path.join(WE, "units.json");

function readArr(p: string): Record<string, unknown>[] {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
/** Bytes on disk now — the invariant we assert is preserved across a failed apply. */
function bytes(p: string): string {
  return fs.readFileSync(p, "utf8");
}

async function withCopiedData(run: (dataRoot: string) => Promise<void>): Promise<void> {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mfm-apply-test-"));
  const dataRoot = path.join(temporaryDirectory, "data");
  fs.cpSync(DATA_ROOT, dataRoot, { recursive: true });
  try {
    await run(dataRoot);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

describe("applyWrites — dry-run rehearsal fidelity", () => {
  it("rejects a schema-invalid projection in dry-run (the real faction_id bug)", async () => {
    // Drop the required faction_id from one option — exactly the latent defect the
    // rehearsal caught in runWargear's rebuilt options.
    const opts = readArr(OPTS);
    delete opts[0].faction_id;
    const staged: StagedWrite[] = [{ path: OPTS, value: opts }];

    const before = bytes(OPTS);
    await expect(applyWrites(staged, { write: false, label: "test" })).rejects.toThrow(
      /faction_id/,
    );
    // Dry run touches nothing, even on failure.
    expect(bytes(OPTS)).toBe(before);
  }, 30_000);

  it("rejects a referential-integrity violation in dry-run (faction_keyword membership)", async () => {
    // A World Eaters unit may only carry the World Eaters home keyword; injecting a
    // foreign keyword is a cross-entity violation AJV alone cannot see.
    const units = readArr(UNITS);
    units[0].faction_keywords = ["Aeldari"];
    const staged: StagedWrite[] = [{ path: UNITS, value: units }];

    await expect(applyWrites(staged, { write: false, label: "test" })).rejects.toThrow(
      /Referential Integrity|faction_keyword|Aeldari/i,
    );
  }, 30_000);

  it("accepts a valid projection and writes nothing in dry-run", async () => {
    // Reversing the array is a different serialization but every element stays valid.
    const opts = readArr(OPTS).reverse();
    const staged: StagedWrite[] = [{ path: OPTS, value: opts }];

    const before = bytes(OPTS);
    await expect(applyWrites(staged, { write: false, label: "test" })).resolves.toBeUndefined();
    expect(bytes(OPTS)).toBe(before); // dry run never persists
  }, 30_000);
});

describe("applyWrites — validation before persistence", () => {
  it("writes NO file when the projection fails, even with write=true", async () => {
    // First staged file is a valid change; second makes the projection invalid.
    // The old code wrote file-by-file and would have persisted the first before
    // throwing on the second; applyWrites validates up front, so neither lands.
    const validChange = readArr(OPTS).reverse(); // valid, but different bytes
    const invalid = readArr(UNITS);
    invalid[0].faction_keywords = ["Aeldari"]; // integrity failure
    const staged: StagedWrite[] = [
      { path: OPTS, value: validChange },
      { path: UNITS, value: invalid },
    ];

    const optsBefore = bytes(OPTS);
    const unitsBefore = bytes(UNITS);
    await expect(applyWrites(staged, { write: true, label: "test" })).rejects.toThrow();
    // The valid earlier file must not be written when projected validation fails.
    expect(bytes(OPTS)).toBe(optsBefore);
    expect(bytes(UNITS)).toBe(unitsBefore);
  }, 30_000);
});

describe("prepareWrites — validated snapshot", () => {
  it("refuses a commit after a validation input changes and leaves the target untouched", async () => {
    await withCopiedData(async (dataRoot) => {
      const target = path.join(dataRoot, path.relative(DATA_ROOT, OPTS));
      const changedInput = path.join(dataRoot, path.relative(DATA_ROOT, UNITS));
      const targetBefore = bytes(target);
      const prepared = await prepareWrites(
        [{ path: target, value: readArr(target).reverse() }],
        { label: "test", dataRoot },
      );

      fs.appendFileSync(changedInput, "\n");

      expect(() => prepared.commit()).toThrow(
        /validation inputs changed.*Changed: core\/world-eaters\/units\.json/is,
      );
      expect(bytes(target)).toBe(targetBefore);
    });
  }, 30_000);

  it("commits the immutable staged bytes even when the caller mutates its staged value", async () => {
    await withCopiedData(async (dataRoot) => {
      const target = path.join(dataRoot, path.relative(DATA_ROOT, OPTS));
      const value = readArr(target).reverse();
      const expected = JSON.stringify(value, null, 2) + "\n";
      const staged: StagedWrite[] = [{ path: target, value }];
      const prepared = await prepareWrites(staged, { label: "test", dataRoot });

      value.reverse();
      staged[0].text = "[]\n";

      prepared.commit();
      expect(bytes(target)).toBe(expected);
      expect(() => prepared.commit()).toThrow(/commit already used/i);
    });
  }, 30_000);

  it("detects added and deleted validation inputs before writing", async () => {
    await withCopiedData(async (dataRoot) => {
      const target = path.join(dataRoot, path.relative(DATA_ROOT, OPTS));
      const deletedInput = path.join(dataRoot, path.relative(DATA_ROOT, UNITS));
      const addedInput = path.join(dataRoot, "core", "snapshot-added.json");
      const targetBefore = bytes(target);
      const prepared = await prepareWrites(
        [{ path: target, value: readArr(target).reverse() }],
        { label: "test", dataRoot },
      );

      fs.writeFileSync(addedInput, "[]\n");
      fs.rmSync(deletedInput);

      expect(() => prepared.commit()).toThrow(
        /Added: core\/snapshot-added\.json.*Deleted: core\/world-eaters\/units\.json/is,
      );
      expect(bytes(target)).toBe(targetBefore);
    });
  }, 30_000);

  it("rejects a staged destination symlinked outside the canonical data root", async () => {
    await withCopiedData(async (dataRoot) => {
      const target = path.join(dataRoot, path.relative(DATA_ROOT, OPTS));
      const outsideTarget = path.join(path.dirname(dataRoot), "escaped-wargear-options.json");
      fs.renameSync(target, outsideTarget);
      fs.symlinkSync(outsideTarget, target);
      const outsideBefore = bytes(outsideTarget);

      await expect(prepareWrites(
        [{ path: target, value: readArr(outsideTarget).reverse() }],
        { label: "test", dataRoot },
      )).rejects.toThrow(/symlinked|escapes/i);
      expect(bytes(outsideTarget)).toBe(outsideBefore);
    });
  }, 30_000);

  it("rechecks the canonical staged destination immediately before commit", async () => {
    await withCopiedData(async (dataRoot) => {
      const target = path.join(dataRoot, path.relative(DATA_ROOT, OPTS));
      const factionDirectory = path.dirname(target);
      const outsideDirectory = path.join(path.dirname(dataRoot), "escaped-world-eaters");
      const prepared = await prepareWrites(
        [{ path: target, value: readArr(target).reverse() }],
        { label: "test", dataRoot },
      );
      fs.renameSync(factionDirectory, outsideDirectory);
      fs.symlinkSync(outsideDirectory, factionDirectory, "dir");
      const outsideBefore = bytes(path.join(outsideDirectory, path.basename(target)));

      expect(() => prepared.commit()).toThrow(/destination became symlinked|escaped/i);
      expect(bytes(path.join(outsideDirectory, path.basename(target)))).toBe(outsideBefore);
    });
  }, 30_000);
});
