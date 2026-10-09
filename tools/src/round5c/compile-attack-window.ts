/**
 * Per-attack durations inside a phase window ("Until the end of the phase, each time an attack
 * targets …, that unit has the benefit of cover against that attack"; core rule 01.02.02).
 *
 * The entry's scope is the phase. The effect is one ability-part that ends at the attack sequence,
 * and its trigger is the attack moment, so each attack gets its own application that the phase
 * bounds. compile.ts calls attackFold and applies the fold only when it returns a phase.
 */

type Node = Record<string, unknown>;
type Leaf = { family_id: string; parameters: Record<string, unknown> };

/** DSL trigger events that name one attack: its target chosen, or its damage allocated (the moment's `event`). */
export const ATTACK_MOMENT_EVENTS: ReadonlySet<string> = new Set(["targets-selected", "damage-allocated"]);

/**
 * The period a trigger window names: "phase" for a phase-window leaf that names phases, "turn" for
 * a phase-window leaf with no phase, null when there is none. A use or activation window is not a
 * source: its period is not folded, so those entries keep the attack sequence as their scope.
 */
export function triggerWindow(list: readonly Leaf[]): "phase" | "turn" | null {
  if (list.some((leaf) => leaf.family_id === "use-window" || leaf.family_id === "activation-window")) return null;
  const windows = list.filter((leaf) => leaf.family_id === "phase-window" && leaf.parameters.phase !== "any");
  if (windows.some((leaf) => leaf.parameters.phase !== undefined)) return "phase";
  return windows.length ? "turn" : null;
}

/**
 * How a per-attack duration combines with the other durations of one entry:
 * - `{ period: "phase" }`: the entry is bounded by the phase and the attack moment ends the effect.
 * - "refused": the combination has no reviewed meaning; the entry is refused.
 * - null: no fold applies (a lone per-attack duration keeps the attack sequence; other pairs fall
 *   through to the conflict check in compile.ts).
 */
export type AttackFold = { period: "phase" } | "refused" | null;

export function attackFold(durations: readonly string[], window: "phase" | "turn" | null, hasAttackMoment: boolean): AttackFold {
  const kinds = new Set(durations);
  if (!kinds.has("attack-sequence")) return null;
  if (kinds.size === 1) {
    if (window === null) return null;
    if (window === "turn") return "refused";
    return hasAttackMoment ? { period: "phase" } : "refused";
  }
  if (kinds.size === 2 && kinds.has("phase")) return hasAttackMoment ? { period: "phase" } : "refused";
  return null;
}

export function isAttackMoment(moment: Node): boolean {
  return ATTACK_MOMENT_EVENTS.has(String(moment.event));
}
