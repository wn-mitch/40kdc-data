/**
 * The damage-projection engine: pure-function math over schema profiles and
 * a flat {@link Buff} stack.
 *
 * @packageDocumentation
 */
export {
  resolveBuffs,
  type Buff,
  type BuffApplicability,
  type BuffContribution,
  type BuffSource,
  type EngineContext,
  type RecipientSnapshot,
  type ResolveContext,
  type ResolvedModifiers,
  type WeaponKeywordRef,
} from "./buffs.js";
export { canonicalJson, conditionFactKey, conditionNeeds, type ConditionNeed } from "./condition-facts.js";
export { mortalWoundSources, withinChoiceLimits, type MortalChoice, type MortalWoundSource, type MortalWoundTranslation } from "./mortal-sources.js";
export { buffsFromKeyword } from "./from-keyword.js";
export { getBuffs, type HasBuffs } from "./get-buffs.js";
export {
  crunch,
  crunchModel,
  profileCanTarget,
  type AttackModel,
  type AttackProfileRef,
  type EngineInput,
  type EngineOutput,
  type Stage,
  type TargetProfileRef,
} from "./engine.js";
export {
  attributeStages,
  DAMAGE_DEALT,
  DAMAGE_DEALT_MEASURES,
  type AttributedStage,
  type StageLift,
} from "./attribution.js";
export { resolveGrantedRecords, type GrantedRecord, type GrantedRecordLookup } from "./granted-records.js";
export {
  allocate,
  allocateModel,
  allocateAttached,
  allocateSequence,
  MAX_ATTACHED_STATES,
  MAX_EVENT_WORK,
  type AttachedAllocationOutput,
  type TargetGroup,
  type AllocationDefences,
  type AllocationOutput,
  type AllocationSequenceOutput,
  type DamageZeroing,
} from "./allocation.js";
