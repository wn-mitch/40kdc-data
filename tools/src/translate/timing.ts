/**
 * Phrases for the free-text timing strings some effect fields still carry (`select.timing`,
 * a menu's `select`, a mortal-wound `timing`). Triggers and conditions use the event families
 * in `trigger.ts` instead; these strings are not part of that vocabulary.
 */
import { dekebab } from "./condition.js";

function str(v: unknown): string {
  if (v == null) return "?";
  return typeof v === "string" ? v : String(v);
}

/**
 * A `timing-is` event token → natural GW-voice clause ("each time a model in
 * this unit is destroyed", "at the start of the phase"). Structural phase/turn
 * markers and the common trigger families are mapped explicitly; the fallback
 * routes `after-*`/`on-*` prefixes to "after …"/"when …" (so the old "at on …"
 * double-preposition can't occur) and everything else to "at <event>".
 */
/**
 * Legacy `timing-is` strings → canonical `game-event` (Batch C unification). Data
 * is being canonicalized onto these targets; the alias map keeps un-migrated
 * strings rendering identically via the one vocabulary (`eventClause`).
 */
const TIMING_ALIASES: Record<string, string> = {
  advance: "advances",
  "after-attacks": "after-unit-resolves-attacks",
  "after-attacking-unit-finishes-attacks": "after-unit-resolves-attacks",
  "after-shooting": "after-unit-resolves-attacks",
  "after-unit-shot": "after-unit-resolves-attacks",
  "after-unit-has-shot": "after-unit-resolves-attacks",
  "after-this-model-has-shot": "after-unit-resolves-attacks",
  "after-shot-hits-scored": "after-scoring-hit",
  "deep-strike": "deep-strike-setup",
  end: "end-of-turn",
  start: "start-of-turn",
  "fall-back": "falls-back",
  "model-destroyed": "on-model-destroyed",
  "on-destroyed": "on-unit-destroyed",
  "before-this-model-removed": "before-bearer-removed",
  "reinforcements-step": "reinforcements",
  setup: "unit-set-up",
  "set-up-this-turn": "unit-set-up",
  "after-move-through-terrain-over-4-inches": "moved-through-tall-terrain",
  "after-moving-through-tall-terrain": "moved-through-tall-terrain",
  "when-this-unit-selected-to-shoot": "selected-to-shoot",
  "when-selected-to-shoot": "selected-to-shoot",
};

/**
 * Timing strings with no canonical `game-event` equivalent but an established
 * phrase: usage markers (which a future pass may move to the `usage` block) and
 * a couple of phase/state gates. Everything else degrades via the heuristics.
 */
const TIMING_ONLY_PHRASES: Record<string, string> = {
  "once-per-battle": "once per battle",
  "once-per-phase": "once per phase",
  "once-per-opponent-turn": "once per opponent's turn",
  "first-this-battle": "the first time this battle",
  "first-time-this-phase": "the first time this phase",
  "in-reserves": "while it is in Reserves",
  "command-phase": "during the Command phase",
  "shooting-phase": "in the Shooting phase",
  "start-of-shooting-phase": "at the start of your Shooting phase",
  "start-of-fight-phase": "at the start of the Fight phase",
  "first-movement-phase": "in your first Movement phase",
  "start-of-first-battle-round": "at the start of the first battle round",
  "start-of-movement-phase": "at the start of the Movement phase",
  "shooting-or-fight-phase": "in the Shooting or Fight phase",
  "this-model-starts-or-ends-a-move": "each time this model starts or ends a move",
  "friendly-unit-empowered-within-9":
    'each time you spend 1 Pain token to Empower a friendly unit within 9" of this unit',
  "enemy-unit-fails-battle-shock": "each time an enemy unit fails a Battle-shock test",
  "start-of-your-shooting-phase": "at the start of your Shooting phase",
  "your-shooting-phase": "in your Shooting phase",
  "after-friendly-war-dog-within-9-shoots": 'after a friendly WAR DOG unit within 9" shoots',
  "after-destroying-asuryani-psyker": "after an enemy unit destroys a friendly ASURYANI PSYKER model",
  "after-this-unit-resolves-shooting-attacks": "after this unit resolves its ranged attacks",
};

export function describeTiming(timing: unknown): string {
  const t = str(timing);
  if (TIMING_ONLY_PHRASES[t]) return TIMING_ONLY_PHRASES[t];
  const canon = TIMING_ALIASES[t] ?? t;
  if (EVENT_PHRASES[canon]) return EVENT_PHRASES[canon];
  if (t.startsWith("after-")) return `after ${dekebab(t.slice(6))}`;
  if (t.startsWith("on-")) return `when ${dekebab(t.slice(3))}`;
  if (t.endsWith("-destroyed")) return `each time ${dekebab(t)}`;
  return `at ${dekebab(t)}`;
}

/** `timing-is` negation, generic over every `describeTiming` phrase: a `when …` clause becomes `unless …`; anything else is bare-prepended with `unless `. */
export function negatedTiming(timing: unknown): string {
  const phrase = describeTiming(timing);
  return phrase.startsWith("when ") ? `unless ${phrase.slice(5)}` : `unless ${phrase}`;
}

/**
 * Canonical `game-event` token → natural clause, for the reactive `trigger.event`.
 * This is the unified event vocabulary; the `timing-is` condition will be
 * canonicalized onto the same keys. Unmapped events degrade to `when <dekebab>`.
 */
export const EVENT_PHRASES: Record<string, string> = {
  "start-of-phase": "at the start of the phase",
  "end-of-phase": "at the end of the phase",
  "start-of-turn": "at the start of the turn",
  "end-of-turn": "at the end of the turn",
  "start-of-player-turn": "at the start of your turn",
  "start-of-opponent-turn": "at the start of the opponent's turn",
  "end-of-opponent-turn": "at the end of the opponent's turn",
  "start-of-battle-round": "at the start of the battle round",
  "start-of-battle": "at the start of the battle",
  "end-of-battle-round": "at the end of the battle round",
  "end-of-normal-move": "when the unit ends a Normal move",
  "enemy-unit-destroyed": "each time an enemy unit is destroyed",
  "selected-to-move": "when the unit is selected to move",
  "selected-to-fall-back": "when the unit is selected to Fall Back",
  "end-of-advance-move": "when the unit ends an Advance move",
  "selected-to-disembark": "when the unit is selected to disembark",
  "unit-disembarked": "when the unit disembarks from a Transport",
  "becomes-battle-shocked": "when the unit becomes Battle-shocked",
  "start-of-battle-shock-step": "at the start of the Battle-shock step",
  "stratagem-used": "each time you use a Stratagem",
  "dark-pact-made": "each time the unit makes a Dark Pact",
  "agile-manoeuvre-performed": "each time the unit performs an Agile Manoeuvre",
  "unit-empowered": "each time the unit is Empowered",
  "ritual-manifested": "each time the unit manifests a Ritual",
  "oath-fulfilled": "when you fulfil an Oath",
  "shadow-in-the-warp-used": "when you use Shadow in the Warp",
  "order-issued": "each time the unit issues an Order",
  "order-received": "each time an Order is issued to the unit",
  "reanimation-protocols-activated": "each time the unit's Reanimation Protocols activate",
  "ritual-attempted": "each time the unit attempts a Ritual",
  "warp-channelled": "each time the unit Channels the Warp",
  "after-psychic-test": "after a Psychic test is taken",
  "blessings-of-khorne-rolled": "each time you make a Blessings of Khorne roll",
  "observer-selected": "each time the unit is selected as an Observer unit",
  "malefic-surge-made": "each time the unit makes a Malefic Surge",
  "contract-invoked": "each time the unit invokes its contract",
  "dark-pact-test-passed": "each time the unit makes a Dark Pact and passes its Leadership test",
  "contract-completed": "each time you complete a Contract",
  "favoured-champions-changed": "each time a unit becomes your Favoured Champions",
  "cult-ambush-marker-removed": "each time one of your Cult Ambush markers is removed",
  "set-up-from-cult-ambush": "when the unit is set up using Cult Ambush",
  "quarry-destroyed": "each time your quarry is destroyed",
  "combat-doctrine-selected": "when you select a Combat Doctrine",
  "waaagh-called": "when you call a Waaagh!",
  "opponent-cp-gained": "each time your opponent gains a CP",
  "flux-token-spent": "each time a Flux token is spent",
  "yield-points-spent": "each time you spend Yield points",
  "gate-of-infinity-used": "when you use Gate of Infinity",
  "surge-move": "when the unit makes a Surge move",
  "army-selection": "when you select this model to include in your army",
  "start-of-command-phase": "at the start of the Command phase",
  "start-of-opponent-command-phase": "at the start of your opponent's Command phase",
  "start-of-first-battle-round": "at the start of the first battle round",
  "command-phase": "in the Command phase",
  "declare-battle-formations": "when declaring Battle Formations",
  "post-deployment": "after deployment",
  "unit-set-up": "when the unit is set up",
  "set-up-from-reserves": "when the unit arrives from Reserves",
  "arrives-from-strategic-reserves": "when the unit arrives from Strategic Reserves",
  "starts-in-strategic-reserves": "if the unit starts in Strategic Reserves",
  "game-start-in-reserves": "if the unit begins the battle in Reserves",
  "deep-strike-setup": "when the unit is set up by Deep Strike",
  "reinforcements": "when the unit arrives as Reinforcements",
  "normal-move": "when the unit makes a Normal move",
  "advance-move": "when the unit makes an Advance move",
  advances: "when the unit Advances",
  "fall-back-move": "when the unit makes a Fall Back move",
  "falls-back": "when the unit Falls Back",
  "charge-move": "when the unit makes a Charge move",
  "end-of-charge-move": "after the unit ends a Charge move",
  "charge-declaration": "when a Charge is declared",
  "moved-through-terrain": "when the unit moves through terrain",
  "moved-through-tall-terrain": "when the unit moves through terrain over 4\" tall",
  "enemy-unit-ended-move": "an enemy unit ends a move",
  "enemy-unit-fell-back": "an enemy unit Falls Back",
  "before-hit-roll": "before a Hit roll is made",
  "after-hit-roll": "after a Hit roll is made",
  "before-wound-roll": "before a Wound roll is made",
  "after-wound-roll": "after a Wound roll is made",
  "attack-scores-wound": "each time an attack scores a wound",
  "before-save-roll": "before a saving throw is made",
  "after-save-roll": "after a saving throw is made",
  "before-damage-roll": "before a Damage roll is made",
  "after-damage-roll": "after a Damage roll is made",
  "before-charge-roll": "before a Charge roll is made",
  "after-charge-roll": "after a Charge roll is made",
  "before-advance-roll": "before an Advance roll is made",
  "after-advance-roll": "after an Advance roll is made",
  "before-battle-shock": "before a Battle-shock test",
  "after-battle-shock": "after a Battle-shock test",
  "on-unit-selected": "when the unit is selected",
  "selected-to-shoot": "when the unit is selected to shoot",
  "selected-to-fight": "when the unit is selected to fight",
  "selected-to-advance": "when the unit is selected to Advance",
  "after-unit-resolves-attacks": "after the unit resolves its attacks",
  "after-scoring-hit": "after scoring a hit",
  "after-enemy-unit-fires": "after an enemy unit shoots",
  "on-unit-destroyed": "when the unit is destroyed",
  "on-model-destroyed": "when a model in the unit is destroyed",
  "first-model-destroyed": "the first time a model in the unit is destroyed",
  "before-bearer-removed": "before this model is removed from play",
  "enemy-unit-destroyed-in-melee": "when an enemy unit is destroyed in melee",
  "on-damage-allocated": "when damage is allocated",
  "battle-shock-test": "when the unit takes a Battle-shock test",
  "leadership-test": "when the unit takes a Leadership test",
  "desperate-escape-test": "when the unit takes a Desperate Escape test",
  "end-of-opponent-charge-phase": "at the end of the opponent's Charge phase",
  "enemy-unit-completed-shooting-targeting-bearer": "after an enemy unit has shot and targeted this unit",
  "enemy-unit-selects-bearer-as-charge-target": "when an enemy unit selects this unit as a charge target",
  "enemy-unit-targets-bearer": "when an enemy unit targets this unit",
  "enemy-unit-completed-fall-back-from-bearer": "after an enemy unit within Engagement Range of this unit completes a Fall Back move",
  "act-of-faith-completed": "after an Act of Faith is completed",
  "act-of-faith-performed": "when an Act of Faith is performed",
  "miracle-die-generated": "when a Miracle die is generated",
  "enemy-unit-selected-charge-targets-before-charge-move": "after an enemy unit selects targets for its charge but before it makes a Charge move",
};

export function eventClause(event: unknown): string {
  const e = str(event);
  return EVENT_PHRASES[e] ?? `when ${dekebab(e)}`;
}

