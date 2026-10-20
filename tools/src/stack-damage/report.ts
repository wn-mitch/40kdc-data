import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ComparePhase } from "../compare.js";
import type { MatrixConfig } from "./config.js";
import type { LedgerEntry } from "./ledger.js";
import type { PistolChoice } from "./loadout-scoring.js";
import type { DamageAttribution } from "./unit-damage.js";

export const DAMAGE_MATRIX_FORMAT = "40kdc-stack-damage-matrix-v1";

export interface UnsupportedWarning {
  sourceAbilityId: string;
  sourceUnitId?: string;
  perspective: "attacker" | "target";
  reason: string;
}

export interface WeaponReport {
  id: string;
  name: string;
  profileIndex: number;
  profileName: string;
  count: number;
  stages: Record<string, number>;
  /** What each selected lever and defensive ability contributed to this profile's damage; null when it cannot be recomputed. */
  attribution: DamageAttribution | null;
}

export interface MemberReport {
  unitId: string;
  unitName: string;
  role: "bodyguard" | "leader" | "support";
  modelCount: number;
  expectedDamage: number;
  loadout: { weaponId: string; count: number }[];
  weapons: WeaponReport[];
  /** How the Pistol rule shaped `weapons`; see {@link PistolChoice}. */
  pistolChoice: PistolChoice;
  legalityErrors: string[];
}

export interface LeverReport {
  id: string;
  label: string;
  source: unknown;
  cost?: { cp?: number; points?: number };
  requires: unknown[];
  supportUnitId?: string;
}

export interface WinnerReport {
  expectedDamage: number;
  members: MemberReport[];
  detachments: { id: string; detachmentPoints: number }[];
  enhancements: { id: string; bearerUnitId: string; points: number }[];
  stratagem: { id: string; cp: number } | null;
  selectedLevers: LeverReport[];
  supportingUnits: { unitId: string; points: number | null; selectedAbilityIds: string[] }[];
  assumptions: string[];
}

export interface DamageCellReport {
  key: string;
  factionId: string;
  target: {
    profileId: string;
    profileName: string;
    factionId: string;
    unitId: string;
    modelCount: number;
  };
  phase: ComparePhase;
  /** `incomplete` when the ledger holds a relevant unresolved provider, or the winner has detachment or legality issues. */
  status: "complete" | "incomplete";
  winner: WinnerReport | null;
  /** Every provider eligible for the winning stack and the target, with what became of it. */
  ledger: LedgerEntry[];
  unsupported: UnsupportedWarning[];
  defensiveWarnings: UnsupportedWarning[];
  candidateCounts: {
    bodyguards: number;
    memberStacks: number;
    broadResults: number;
    deepFinalists: number;
    illegalLoadoutsRejected: number;
  };
  evaluations: { stack: number; crunch: number };
  runtimeMs: number;
}

export interface DamageMatrixReport {
  format: typeof DAMAGE_MATRIX_FORMAT;
  scope: string;
  generatedAt: string;
  method: {
    optimizer: "coordinate-ascent";
    localStackOnly: true;
    maxDetachments: number;
    detachmentPointBudget: number;
    maxStratagems: 1;
    favorableState: string[];
    caveats: string[];
  };
  config: Record<string, unknown>;
  cells: DamageCellReport[];
}

export function damageCellKey(factionId: string, targetId: string, phase: ComparePhase): string {
  return `${factionId}::${targetId}::${phase}`;
}

export interface DamageMatrixScope {
  factionIds: readonly string[];
  targetIds: readonly string[];
  phases: readonly ComparePhase[];
}

export function expectedDamageCellKeys(config: DamageMatrixScope): string[] {
  return config.factionIds.flatMap((factionId) =>
    config.targetIds.flatMap((targetId) => config.phases.map((phase) => damageCellKey(factionId, targetId, phase))),
  );
}

export function reportCompleteness(
  config: DamageMatrixScope,
  cells: readonly DamageCellReport[],
): { complete: boolean; missing: string[]; unexpected: string[]; duplicates: string[] } {
  const expected = new Set(expectedDamageCellKeys(config));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const cell of cells) {
    if (seen.has(cell.key)) duplicates.push(cell.key);
    seen.add(cell.key);
  }
  const missing = [...expected].filter((key) => !seen.has(key));
  const unexpected = [...seen].filter((key) => !expected.has(key));
  return { complete: missing.length === 0 && unexpected.length === 0 && duplicates.length === 0, missing, unexpected, duplicates };
}

export function matrixScope(config: Pick<MatrixConfig, "factionIds" | "targetIds" | "phases" | "bodyguardLimit" | "attachmentLimit" | "finalistLimit" | "perFiveSensitivity" | "droppedArmyRules">): string {
  return JSON.stringify({
    factions: config.factionIds,
    targets: config.targetIds,
    phases: config.phases,
    limits: [config.bodyguardLimit, config.attachmentLimit, config.finalistLimit].map((value) => Number.isFinite(value) ? value : "Infinity"),
    perFiveSensitivity: config.perFiveSensitivity,
    droppedArmyRules: config.droppedArmyRules,
  });
}

export function readResumableCells(path: string, scope: string): DamageCellReport[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DamageMatrixReport>;
  if (parsed.format !== DAMAGE_MATRIX_FORMAT || parsed.scope !== scope || !Array.isArray(parsed.cells)) return [];
  return parsed.cells;
}

export function writeMatrixReport(path: string, report: DamageMatrixReport): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, path);
}
