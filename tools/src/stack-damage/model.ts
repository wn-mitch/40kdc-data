import type { StackableBuff, StackableBuffGroup } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import type { Buff, EngineContext } from "../cruncher/index.js";
import type { ResolvedTarget, ComparePhase } from "../compare.js";
import type { LegalityIssue } from "./legality.js";
import type { UnsupportedWarning } from "./report.js";

export type MemberRole = "bodyguard" | "leader" | "support";

export interface StackMember {
  unit: UnitView;
  role: MemberRole;
}

export interface StackSpec {
  factionId: string;
  members: StackMember[];
  detachmentIds: string[];
  selectedLeverIds: string[];
  detachmentIssues: LegalityIssue[];
}

export interface PoolLever extends StackableBuff {
  perMember: Map<string, Buff[]>;
}

export interface StackBuffPool {
  levers: PoolLever[];
  groups: StackableBuffGroup[];
  warnings: Array<UnsupportedWarning & { sourceKind: string }>;
}

export interface SelectedWeaponResult {
  weaponId: string;
  profileIndex: number;
  profileName: string;
  count: number;
  damage: number;
  stages: readonly { name: string; expected: number }[];
}

export interface UnitLoadoutResult {
  counts: Map<string, number>;
  modelCount: number;
  total: number;
  selectedWeapons: SelectedWeaponResult[];
  legalityErrors: string[];
}

export interface StackMemberResult {
  member: StackMember;
  loadout: UnitLoadoutResult;
}

export interface StackResult {
  spec: StackSpec;
  total: number;
  members: StackMemberResult[];
}

export interface DamageCellState {
  factionId: string;
  target: ResolvedTarget;
  phase: ComparePhase;
  contextFor(spec: StackSpec, member?: StackMember): EngineContext;
}
