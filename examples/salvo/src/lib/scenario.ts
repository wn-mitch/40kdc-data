/**
 * Board and game state the player declares for a projection. Each field is an engine-context
 * field; an unset field leaves the abilities that read it unresolved, and a declared list is
 * complete (a designation, state or objective it omits does not hold).
 */
import { describeCondition, type AbilityNeed, type Condition, type EngineContext } from "@alpaca-software/40kdc-data";

export type Scenario = Pick<EngineContext,
  | "battleRound" | "attackerTurn" | "attackerStrength" | "targetStrength" | "attackerDesignations"
  | "targetDesignations" | "attackerStates" | "targetStates" | "targetClosest" | "attackerObjectives"
  | "targetObjectives" | "conditionFacts">;

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

/** One declared-answer toggle: a leaf condition, how it reads, and the abilities that ask it. */
export type NeedToggle = { key: string; label: string; side: "attacker" | "target"; abilities: string[] };

/**
 * One toggle per distinct undecided condition, in first-seen order, naming every ability that
 * asked it. The label is the describer's reading of the condition.
 */
export function needToggles(needs: readonly AbilityNeed[]): NeedToggle[] {
  const byKey = new Map<string, NeedToggle>();
  for (const need of needs) {
    const toggle = byKey.get(need.key);
    if (toggle) {
      if (!toggle.abilities.includes(need.label)) toggle.abilities.push(need.label);
      continue;
    }
    const text = describeCondition(need.condition as Condition);
    byKey.set(need.key, {
      key: need.key,
      label: text.charAt(0).toUpperCase() + text.slice(1),
      side: need.perspective === "target" ? "target" : "attacker",
      abilities: [need.label],
    });
  }
  return [...byKey.values()];
}

/** The scenario with one condition answered, or returned to unset when `value` is undefined. */
export function withConditionFact(scenario: Scenario, key: string, value: boolean | undefined): Scenario {
  const facts = { ...scenario.conditionFacts };
  if (value === undefined) delete facts[key];
  else facts[key] = value;
  const next = { ...scenario };
  if (Object.keys(facts).length === 0) delete next.conditionFacts;
  else next.conditionFacts = facts;
  return next;
}
