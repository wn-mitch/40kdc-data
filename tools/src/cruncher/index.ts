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
  type ResolveContext,
  type ResolvedModifiers,
  type WeaponKeywordRef,
} from "./buffs.js";
export { buffsFromKeyword } from "./from-keyword.js";
export { getBuffs, type HasBuffs } from "./get-buffs.js";
export {
  crunch,
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
