/**
 * Forced effect-translation inputs for two describer readings: a trigger's event subject that is a
 * model ("the triggering model"), and a characteristic change under an `attackers-of-target`
 * designation (each attack against the target, not every friendly unit's characteristic). Keywords
 * are fabricated.
 */

/** One forced case: an effect, its ability trigger, and an id prefix. */
export interface ForcedTranslationCase {
  id: string;
  effect: Record<string, unknown>;
  trigger?: unknown;
}

const enemyModelTargets = { event: "targets-selected", subject: { owner: "enemy", level: "model" }, filter: { kind: "attack" } };
const enemyUnitTargets = { event: "targets-selected", subject: { owner: "enemy" }, filter: { kind: "attack" } };
const engagedGate = (effect: Record<string, unknown>) => ({
  type: "conditional",
  condition: { type: "matches", parameters: { subject: "event-subject", filter: { engaged_with: "this-unit" } } },
  effect,
});
const minusHit = { type: "roll-modifier", target: "event-subject", modifier: { roll: "hit", operation: "subtract", value: 1 } };

/**
 * `event-subject` read as the triggering model: every trigger's subject a model (top-level and in an
 * ability part's own trigger), a unit or mixed subject keeping "the triggering unit", a part whose
 * trigger names a unit subject rebinding the ref, a part whose trigger names no subject keeping the
 * outer model, a nested trigger naming the outer subject, and a move ending near it.
 */
export const EVENT_SUBJECT_MODEL_CASES: ForcedTranslationCase[] = [
  { id: "event-subject-model-matches", effect: engagedGate(minusHit), trigger: enemyModelTargets },
  { id: "event-subject-unit-matches", effect: engagedGate(minusHit), trigger: enemyUnitTargets },
  { id: "event-subject-mixed-triggers", effect: engagedGate(minusHit), trigger: [enemyModelTargets, enemyUnitTargets] },
  {
    id: "event-subject-model-part-trigger",
    effect: { type: "ability-part", trigger: enemyModelTargets, effect: engagedGate(minusHit) },
    trigger: { event: "phase-started", condition: { type: "phase-is", parameters: { phase: "fight" } } },
  },
  {
    id: "event-subject-model-part-block",
    effect: {
      type: "ability-part",
      trigger: enemyModelTargets,
      effect: { type: "sequence", steps: [minusHit, { type: "roll-modifier", target: "event-subject", modifier: { roll: "wound", operation: "subtract", value: 1 } }] },
    },
    trigger: { event: "phase-started", condition: { type: "phase-is", parameters: { phase: "fight" } } },
  },
  {
    id: "event-subject-part-rebinds-unit",
    effect: { type: "ability-part", trigger: enemyUnitTargets, effect: minusHit },
    trigger: { event: "move-ended", subject: { owner: "enemy", level: "model" } },
  },
  {
    id: "event-subject-part-keeps-outer-model",
    effect: {
      type: "ability-part",
      trigger: { event: "phase-ended" },
      effect: { type: "mortal-wounds", target: "event-subject", modifier: { count: 1 } },
    },
    trigger: { event: "move-ended", subject: { owner: "enemy", level: "model" } },
  },
  {
    id: "event-subject-model-nested-actor",
    effect: { type: "ability-part", trigger: { event: "targets-selected", subject: "event-subject", filter: { kind: "attack" } }, effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "save", operation: "add", value: 1 } } },
    trigger: { event: "move-ended", subject: { owner: "enemy", level: "model" } },
  },
  {
    id: "event-subject-model-ends-nearest",
    effect: { type: "move", target: "this-unit", modifier: { move_type: "normal", distance: 6, ends_nearest: { of: "event-subject" } } },
    trigger: { event: "move-ended", subject: { owner: "enemy", level: "model" } },
  },
  {
    id: "event-subject-model-within",
    effect: {
      type: "select-units",
      selector: { filter: { owner: "friendly", all_of: ["FABRICATED"], within: { range: { inches: 8 }, of: "event-subject" } }, count: { min: 1, max: 1 } },
      effect: { type: "move", target: "selected-unit", modifier: { move_type: "normal", distance: "D6" } },
    },
    trigger: { event: "move-ended", subject: { owner: "enemy", level: "model" } },
  },
];

const designate = (applies: unknown): Record<string, unknown> => ({
  type: "designate-target",
  designation: "fabricated-mark",
  select: { kind: "unit", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 } } },
  applies,
  duration: "phase",
});
const statMod = (target: unknown, modifier: Record<string, unknown>) => ({ type: "stat-modifier", target, modifier });
const ap1 = { stat: "AP", operation: "improve", value: 1 };
const aot = (effect: unknown) => ({ to: "attackers-of-target", effect });

/**
 * A characteristic change under `attackers-of-target` read per attack: a keyword filter, any
 * friendly unit, the attacking unit, a weapon scope, the ability's own unit, an unowned keyword
 * filter (article "an"), a model filter, a non-attack characteristic (Attacks) keeping the unit
 * wording, a `target` entry keeping it too, an entry list (block), and an inline designation.
 */
export const ATTACKERS_OF_TARGET_CASES: ForcedTranslationCase[] = [
  { id: "attackers-of-target-keyword", effect: designate(aot(statMod({ owner: "friendly", all_of: ["FABRICATED"] }, ap1))) },
  { id: "attackers-of-target-any-friendly", effect: designate(aot(statMod({ owner: "friendly" }, { stat: "D", operation: "add", value: 1 }))) },
  { id: "attackers-of-target-attacker", effect: designate(aot(statMod("attacker", { stat: "S", operation: "improve", value: 2 }))) },
  { id: "attackers-of-target-weapons", effect: designate(aot(statMod({ owner: "friendly", all_of: ["FABRICATED"] }, { ...ap1, weapons: { type: "ranged" } }))) },
  { id: "attackers-of-target-this-unit", effect: designate(aot(statMod("this-unit", ap1))) },
  { id: "attackers-of-target-unowned-vowel", effect: designate(aot(statMod({ all_of: ["ALPHA"] }, ap1))) },
  { id: "attackers-of-target-model-filter", effect: designate(aot(statMod({ owner: "friendly", level: "model", any_of: ["ALPHA", "BETA"] }, ap1))) },
  { id: "attackers-of-target-attacks-stat", effect: designate(aot(statMod({ owner: "friendly", all_of: ["FABRICATED"] }, { stat: "A", operation: "add", value: 1 }))) },
  { id: "designation-target-stat-unchanged", effect: designate({ to: "target", effect: statMod("selected-unit", { stat: "T", operation: "worsen", value: 1 }) }) },
  {
    id: "attackers-of-target-entry-list",
    effect: designate([
      { to: "target", effect: { type: "ability-grant", target: "selected-unit", modifier: { ability: "stealth" } } },
      aot({ type: "sequence", steps: [statMod({ owner: "friendly", all_of: ["FABRICATED"] }, { stat: "S", operation: "improve", value: 1 }), statMod({ owner: "friendly", all_of: ["FABRICATED"] }, ap1)] }),
    ]),
  },
  {
    id: "attackers-of-target-inline",
    effect: {
      type: "choice",
      options: [
        designate(aot(statMod({ owner: "friendly", all_of: ["FABRICATED"] }, ap1))),
        { type: "ability-grant", target: "this-unit", modifier: { ability: "stealth" } },
      ],
    },
  },
];
