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
export { mortalWoundSources, type MortalWoundSource, type MortalWoundTranslation } from "./mortal-sources.js";
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
  type AttributedStage,
  type StageLift,
} from "./attribution.js";
export { resolveGrantedRecords, type GrantedRecord, type GrantedRecordLookup } from "./granted-records.js";
export {
  allocate,
  allocateModel,
  MAX_EVENT_WORK,
  type AllocationDefences,
  type AllocationOutput,
  type DamageZeroing,
} from "./allocation.js";
