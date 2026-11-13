import type { StackableBuff, StackableBuffGroup } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import type { Buff, EngineContext } from "../cruncher/index.js";
import type { ResolvedTarget, ComparePhase } from "../compare.js";
import type { LegalityIssue } from "./legality.js";
import type { PistolChoice } from "./loadout-scoring.js";
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
  /** The Hit roll modifier the loadout rules imposed on this profile; absent when none. */
  hitModifier?: number;
  stages: readonly { name: string; expected: number }[];
  /** Wargear carried by the model group firing this profile, when the loadout was grouped. */
  modelWargear?: readonly string[];
  /**
   * This row took the unit's re-roll-one permissions (one Hit roll, one Wound roll): the loadout
   * spends them on the single row they add the most to, so the other rows score without them.
   */
  rerollOne?: true;
}

export interface UnitLoadoutResult {
  counts: Map<string, number>;
  modelCount: number;
  total: number;
  selectedWeapons: SelectedWeaponResult[];
  pistolChoice: PistolChoice;
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
