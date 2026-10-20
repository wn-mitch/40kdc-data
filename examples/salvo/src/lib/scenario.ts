/**
 * Board and game state the player declares for a projection. Each field is an engine-context
 * field; an unset field leaves the abilities that read it unresolved, and a declared list is
 * complete (a designation, state or objective it omits does not hold).
 */
import type { EngineContext } from "@alpaca-software/40kdc-data";

export type Scenario = Pick<EngineContext,
  | "battleRound" | "attackerTurn" | "attackerStrength" | "targetStrength" | "attackerDesignations"
  | "targetDesignations" | "attackerStates" | "targetStates" | "targetClosest" | "attackerObjectives"
  | "targetObjectives">;

export type Strength = NonNullable<EngineContext["attackerStrength"]>;
export type State = NonNullable<EngineContext["attackerStates"]>[number];
export type Controller = NonNullable<NonNullable<EngineContext["attackerObjectives"]>[number]["controller"]>;

export const STRENGTHS: { value: Strength; label: string }[] = [
  { value: "full", label: "Full strength" },
  { value: "below-starting", label: "Below Starting Strength" },
  { value: "below-half", label: "Below Half-strength" },
];

export const STATES: { value: State; label: string }[] = [
  { value: "engaged", label: "Engaged" },
  { value: "battle-shocked", label: "Battle-shocked" },
  { value: "hidden", label: "Hidden" },
];

export const CONTROLLERS: { value: Controller; label: string }[] = [
  { value: "attacker", label: "the attacker's player" },
  { value: "target", label: "the defender's player" },
  { value: "none", label: "nobody" },
];

/** Comma-separated designations as a declared list; blank declares none. */
export function parseDesignations(text: string): string[] {
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

/** The scenario's set fields only, for spreading into an engine context. */
export function scenarioContext(scenario: Scenario): Partial<EngineContext> {
  return Object.fromEntries(Object.entries(scenario).filter(([, value]) => value !== undefined)) as Partial<EngineContext>;
}
