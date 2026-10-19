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
  writeMatrixReport,
  type DamageMatrixReport,
} from "./report.js";
import { runDamageCell } from "./search.js";
import type { DamageScoringInvariants } from "./scoring.js";

function initialReport(config: MatrixConfig): DamageMatrixReport {
  const scope = matrixScope(config);
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
        "Fight scoring enforces all Extra Attacks plus at most one ordinary melee weapon per model; Salvo's current interactive aggregate permits users to include every visible melee line, so a browser smoke must compare that selection explicitly.",
        "Unsupported translated mechanics and unproven activation requirements are reported rather than treated as authored zeroes.",
        "Expansion to 27 factions requires an explicit ordered manifest; the repository has 34 faction views but no authoritative 27-faction campaign list.",
      ],
    },
    config: serializableConfig(config),
    cells: readResumableCells(config.outputPath, scope),
  };
}

export function runDamageMatrix(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dataset = Dataset.embedded(),
): DamageMatrixReport {
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

  for (const factionId of config.factionIds) {
    for (const targetId of config.targetIds) {
      for (const phase of config.phases) {
        const key = `${factionId}::${targetId}::${phase}`;
        if (completed.has(key)) {
          console.log(`[resume] ${key}`);
          continue;
        }
        console.log(`[run] ${key}`);
        const cell = runDamageCell({
          dataset,
          config,
          faction: factions.get(factionId)!,
          target: targets.get(targetId)!,
          phase,
          invariants,
        });
        completed.set(key, cell);
        report.cells = expected.flatMap((cellKey) => {
          const completedCell = completed.get(cellKey);
          return completedCell ? [completedCell] : [];
        });
        report.generatedAt = new Date().toISOString();
        writeMatrixReport(config.outputPath, report);
        console.log(
          `[done] ${key} ${cell.winner?.expectedDamage.toFixed(3) ?? "no-result"} damage, ${cell.status}, ${cell.runtimeMs}ms`,
        );
      }
    }
  }

  const completeness = reportCompleteness(config, report.cells);
  if (!completeness.complete) {
    throw new Error(`Damage matrix output incomplete: missing=${completeness.missing.join(",")} unexpected=${completeness.unexpected.join(",")} duplicates=${completeness.duplicates.join(",")}`);
  }
  console.log(`Wrote ${report.cells.length} cells to ${config.outputPath}`);
  return report;
}
