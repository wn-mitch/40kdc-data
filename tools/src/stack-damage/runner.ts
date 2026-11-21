import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset } from "../data/dataset.js";
import { resolveTarget } from "../compare.js";
import { parseMatrixConfig, serializableConfig, type MatrixConfig } from "./config.js";
import { resolveFactionContext } from "./factions.js";
import {
  DAMAGE_MATRIX_FORMAT,
  expectedDamageCellKeys,
  matrixScope,
  readResumableCells,
  reportCompleteness,
  sourceFingerprint,
  writeMatrixReport,
  type DamageCellReport,
  type DamageMatrixReport,
} from "./report.js";
import { runDamageCell } from "./search.js";
import type { DamageScoringInvariants } from "./scoring.js";

/** The package source tree (`src/` under tsx, `dist/` when built): scoring code plus the embedded data bundle. */
const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));

function initialReport(config: MatrixConfig): DamageMatrixReport {
  const scope = matrixScope(config, sourceFingerprint(SOURCE_ROOT));
  const resumed = readResumableCells(config.outputPath, scope);
  if (resumed.discarded) console.log(`[fresh] not resuming ${config.outputPath}: ${resumed.discarded}`);
  return {
    format: DAMAGE_MATRIX_FORMAT,
    scope,
    generatedAt: new Date().toISOString(),
    method: {
      optimizer: "coordinate-ascent",
      localStackOnly: true,
      maxDetachments: config.maxDetachments,
      detachmentPointBudget: config.dpBudget,
      maxStratagems: 1,
      favorableState: ["distance=1in", "within-half-range", "stationary-in-shooting", "charged-in-fight"],
      caveats: [
        "This is a local attached-unit and support-ability stack, not a whole-army roster or proof of global optimality.",
        "The benchmark uses the shipped Salvo consumer primitives: Dataset.stackableBuffsFor, isLegalLeverSelection, Dataset.defensiveBuffsFor, loadout helpers and crunch.",
        "Fight scoring enforces all Extra Attacks plus at most one ordinary melee weapon per model; Salvo selects its weapon lines with the same unitLoadoutDamage scoring.",
        "Unsupported translated mechanics and unproven activation requirements are reported rather than treated as authored zeroes.",
        "Each cell's ledger lists every eligible provider as applied, rejected or unresolved. A cell is incomplete when an unresolved provider could change the current attack; encounter-layer effects (deaths, reactive attacks, restoration, designations for later attacks) are listed but never scored.",
        "Shooting applies the Pistol rule per model; cells are scored outside Engagement Range.",
        "Expansion to 27 factions requires an explicit ordered manifest; the repository has 34 faction views but no authoritative 27-faction campaign list.",
      ],
    },
    config: serializableConfig(config),
    cells: resumed.cells,
  };
}

/**
 * Runs each of `keys` in a child process of `entry` (this CLI), at most `workers` at once. A child
 * runs one cell into its own report, which `record` receives. After a failure no further cell
 * starts; the cells already running finish, then the first failure is thrown.
 */
async function runInWorkers(
  keys: readonly string[],
  workers: number,
  env: Readonly<Record<string, string | undefined>>,
  entry: string,
  record: (cell: DamageCellReport) => void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "damage-matrix-"));
  let next = 0;
  let failure: unknown;
  const runCell = (key: string, output: string) => new Promise<void>((resolve, reject) => {
    const [factionId, targetId, phase] = key.split("::");
    const child = fork(entry, [], {
      execArgv: process.execArgv,
      env: { ...env, HC_FACTIONS: factionId, HC_TARGETS: targetId, HC_PHASES: phase, HC_OUTPUT: output, HC_WORKERS: "1" },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`cell ${key} exited with ${signal ?? `code ${code}`}`)));
  });
  const worker = async (): Promise<void> => {
    while (failure === undefined && next < keys.length) {
      const index = next++;
      const key = keys[index];
      const output = join(dir, `${index}.json`);
      console.log(`[run] ${key}`);
      try {
        await runCell(key, output);
        const cell = (JSON.parse(readFileSync(output, "utf8")) as DamageMatrixReport).cells.find((candidate) => candidate.key === key);
        if (!cell) throw new Error(`cell ${key} is missing from its worker report`);
        record(cell);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(workers, keys.length) }, worker));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failure !== undefined) throw failure;
}

/**
 * Runs every configured cell not already in the resumable report, writing the report after each.
 * With `HC_WORKERS` above 1 the cells run in child processes of `entry`.
 */
export async function runDamageMatrix(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dataset = Dataset.embedded(),
  entry = process.argv[1],
): Promise<DamageMatrixReport> {
  const config = parseMatrixConfig(env, {
    factionIds: new Set(dataset.factions.all.map((faction) => faction.id)),
    targetIds: dataset.targetProfiles.all.map((target) => target.id),
  });
  const targets = new Map(config.targetIds.map((id) => {
    const profile = dataset.targetProfiles.get(id);
    const target = profile ? resolveTarget(dataset, profile) : null;
    if (!target) throw new Error(`Target profile ${id} does not resolve to its faction-scoped unit`);
    return [id, target];
  }));
  const factions = new Map(config.factionIds.map((id) => [id, resolveFactionContext(dataset, id)]));
  const report = initialReport(config);
  const expected = expectedDamageCellKeys(config);
  const completed = new Map(report.cells.map((cell) => [cell.key, cell]));
  writeMatrixReport(config.outputPath, report);
  const invariants: DamageScoringInvariants = { loadoutLegality: new Map() };

  const record = (cell: DamageCellReport) => {
    completed.set(cell.key, cell);
    report.cells = expected.flatMap((cellKey) => {
      const completedCell = completed.get(cellKey);
      return completedCell ? [completedCell] : [];
    });
    report.generatedAt = new Date().toISOString();
    writeMatrixReport(config.outputPath, report);
    console.log(
      `[done] ${cell.key} ${cell.winner?.expectedDamage.toFixed(3) ?? "no-result"} damage, ${cell.status}, ${cell.runtimeMs}ms`,
    );
  };
  const pending = expected.filter((key) => {
    if (completed.has(key)) console.log(`[resume] ${key}`);
    return !completed.has(key);
  });
  if (config.workers > 1) {
    await runInWorkers(pending, config.workers, env, entry, record);
  } else {
    for (const key of pending) {
      const [factionId, targetId, phase] = key.split("::");
      console.log(`[run] ${key}`);
      record(runDamageCell({
        dataset,
        config,
        faction: factions.get(factionId)!,
        target: targets.get(targetId)!,
        phase: phase as MatrixConfig["phases"][number],
        invariants,
      }));
    }
  }

  const completeness = reportCompleteness(config, report.cells);
  if (!completeness.complete) {
    throw new Error(`Damage matrix output incomplete: missing=${completeness.missing.join(",")} unexpected=${completeness.unexpected.join(",")} duplicates=${completeness.duplicates.join(",")}`);
  }
  console.log(`Wrote ${report.cells.length} cells to ${config.outputPath}`);
  return report;
}
