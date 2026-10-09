/**
 * The one expiry vocabulary (scope.duration, ability-part.duration, designate.clears_on, the
 * designation containers) as the trailing clause that says when an effect ends. `one-use` and
 * `permanent` add no trail; `one-use` leads the sentence instead (see `durationClauses`).
 */
const TRAILS: Record<string, string> = {
  "attack-sequence": "until that unit finishes resolving its attacks",
  resolution: "when resolving this use",
  phase: "until the end of the phase",
  turn: "until the end of the turn",
  battle: "for the rest of the battle",
  "battle-round": "until the end of the battle round",
  "until-next-command-phase": "until the start of your next Command phase",
  "until-next-movement-phase": "until the start of your next Movement phase",
  "until-next-shooting-phase": "until the start of your next Shooting phase",
  "until-next-battle-round": "until the start of the next battle round",
  "until-start-next-turn": "until the start of your next turn",
  "until-end-of-your-next-turn": "until the end of your next turn",
  "until-end-of-opponent-next-turn": "until the end of your opponent's next turn",
  "until-this-unit-has-shot": "until this unit has resolved its ranged attacks",
  "control-lost": "until you no longer control it",
  "until-end-of-your-next-fight-phase": "until the end of your next Fight phase",
  "until-end-of-your-next-shooting-phase": "until the end of your next Shooting phase",
  "until-end-of-your-next-movement-phase": "until the end of your next Movement phase",
  "until-end-of-opponent-next-movement-phase": "until the end of your opponent's next Movement phase",
  "until-start-of-opponent-next-command-phase": "until the start of your opponent's next Command phase",
};

/** The trailing clause for an expiry ("until the start of your next Shooting phase"), or "" when it adds none. */
export function expiryTrail(duration: unknown): string {
  return typeof duration === "string" ? TRAILS[duration] ?? "" : "";
}
