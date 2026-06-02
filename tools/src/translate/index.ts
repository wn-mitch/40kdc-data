/**
 * Plain-English translation of structured game data — currently the
 * `secondary-card` scoring `awards` (mission "how to play" readouts) and the
 * shared Ability-DSL condition humanizer. Output is ASCII-only and pinned
 * across language ports by the `conformance/scoring-translation` corpus.
 */
export { describeCondition, dekebab, type Condition } from "./condition.js";
export {
  describeTrigger,
  describeAward,
  describeScoringCard,
  type ScoringTrigger,
  type ScoringAward,
  type ScoringMode,
} from "./scoring.js";
