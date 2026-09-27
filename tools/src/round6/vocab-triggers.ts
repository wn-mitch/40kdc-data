/**
 * Rules that move one legacy trigger to the round-6 event families
 * (common.schema.json#/$defs/game-event + event-filter). The legacy event name often packed
 * the actor and the target ("enemy-unit-targets-bearer"); here they become `subject`
 * (who acted) and `object` (what it was aimed at).
 */
import type { Node, Outcome } from "./vocab-conditions.js";

type Spec = {
  event: string;
  filter?: Node;
  /** Fixed subject / object the legacy name implied. */
  subject?: unknown;
  object?: unknown;
  /** The legacy `subject` named the unit acted upon, so it becomes the object. */
  subjectIsObject?: boolean;
  /** A clock event: a legacy self/bearer subject carries no meaning and is dropped. */
  clock?: boolean;
  /** Extra condition the legacy name implied (a phase or a turn). */
  condition?: Node;
  /** A legacy absent subject meant any unit (the describer said "a Hit roll is made"). */
  absentIsAny?: boolean;
};

const turn = (t: string): Node => ({ type: "player-turn-is", parameters: { turn: t } });
const phase = (p: string): Node => ({ type: "phase-is", parameters: { phase: p } });
const ENEMY = { owner: "enemy" };
const roll = (r: string, result?: string): Spec => ({ event: r.startsWith("before:") ? "before-roll" : "after-roll", filter: { roll: r.replace(/^(before|after):/, ""), ...(result ? { result } : {}) }, absentIsAny: true });

const EVENTS: Record<string, Spec> = {
  "start-of-battle": { event: "battle-started", clock: true },
  "post-deployment": { event: "deployment-ended", clock: true },
  "declare-battle-formations": { event: "battle-formations-declared", clock: true },
  "starts-in-strategic-reserves": { event: "battle-started", clock: true, condition: { type: "unit-state", parameters: { state: "in-strategic-reserves" } } },
  "game-start-in-reserves": { event: "battle-started", clock: true, condition: { type: "unit-state", parameters: { state: "in-reserves" } } },
  "start-of-battle-round": { event: "round-started", clock: true },
  "end-of-battle-round": { event: "round-ended", clock: true },
  "start-of-turn": { event: "turn-started", clock: true },
  "start-of-player-turn": { event: "turn-started", clock: true, condition: turn("your-turn") },
  "start-of-opponent-turn": { event: "turn-started", clock: true, condition: turn("opponent-turn") },
  "end-of-turn": { event: "turn-ended", clock: true },
  "end-of-opponent-turn": { event: "turn-ended", clock: true, condition: turn("opponent-turn") },
  "start-of-phase": { event: "phase-started", clock: true },
  "end-of-phase": { event: "phase-ended", clock: true },
  "start-of-command-phase": { event: "phase-started", clock: true, condition: phase("command") },
  "end-of-opponent-charge-phase": { event: "phase-ended", clock: true, condition: { operator: "and", operands: [phase("charge"), turn("opponent-turn")] } },
  "start-of-battle-shock-step": { event: "step-started", clock: true, filter: { step: "battle-shock" } },

  "on-unit-selected": { event: "selected" },
  "selected-to-move": { event: "selected", filter: { to: "move" } },
  "selected-to-advance": { event: "selected", filter: { to: "move", move_types: ["advance"] } },
  "selected-to-fall-back": { event: "selected", filter: { to: "move", move_types: ["fall-back"] } },
  "selected-to-shoot": { event: "selected", filter: { to: "shoot" } },
  "selected-to-fight": { event: "selected", filter: { to: "fight" } },
  "selected-to-disembark": { event: "selected", filter: { to: "disembark" } },
  "observer-selected": { event: "selected", filter: { to: "observe" } },

  "enemy-unit-targets-bearer": { event: "targets-selected", filter: { kind: "attack" }, subject: ENEMY, object: "this-unit" },
  "enemy-unit-selects-bearer-as-charge-target": { event: "targets-selected", filter: { kind: "charge" }, subject: ENEMY, object: "this-unit" },
  "enemy-unit-selected-charge-targets-before-charge-move": { event: "targets-selected", filter: { kind: "charge" }, subject: ENEMY },
  "charge-declaration": { event: "targets-selected", filter: { kind: "charge" } },
  "ability-target-selected": { event: "targets-selected", filter: { kind: "ability" } },
  "stratagem-targeted": { event: "targets-selected", filter: { kind: "stratagem" }, subject: { owner: "friendly" }, subjectIsObject: true },

  "normal-move": { event: "move-ended", filter: { move_types: ["normal"] } },
  "end-of-normal-move": { event: "move-ended", filter: { move_types: ["normal"] } },
  "advance-move": { event: "move-ended", filter: { move_types: ["advance"] } },
  "end-of-advance-move": { event: "move-ended", filter: { move_types: ["advance"] } },
  advances: { event: "move-ended", filter: { move_types: ["advance"] } },
  "fall-back-move": { event: "move-ended", filter: { move_types: ["fall-back"] } },
  "falls-back": { event: "move-ended", filter: { move_types: ["fall-back"] } },
  "enemy-unit-fell-back": { event: "move-ended", filter: { move_types: ["fall-back"] }, subject: ENEMY },
  "enemy-unit-completed-fall-back-from-bearer": { event: "move-ended", filter: { move_types: ["fall-back"] }, subject: ENEMY, object: "this-unit" },
  "charge-move": { event: "move-ended", filter: { move_types: ["charge"] } },
  "end-of-charge-move": { event: "move-ended", filter: { move_types: ["charge"] } },
  "enemy-unit-ended-move": { event: "move-ended", subject: ENEMY },
  "surge-move": { event: "move-ended", filter: { move_types: ["surge"] } },
  "moved-through-tall-terrain": { event: "move-ended", filter: { through: "tall-terrain" } },
  "moved-through-terrain": { event: "move-ended", filter: { through: "terrain" } },

  "unit-set-up": { event: "set-up" },
  "deep-strike-setup": { event: "set-up", filter: { from: "deep-strike" } },
  reinforcements: { event: "set-up", filter: { from: "reserves" } },
  "set-up-from-reserves": { event: "set-up", filter: { from: "reserves" } },
  "arrives-from-strategic-reserves": { event: "set-up", filter: { from: "strategic-reserves" } },
  "set-up-from-cult-ambush": { event: "set-up", filter: { from: "cult-ambush" } },
  "unit-disembarked": { event: "disembarked" },

  "before-hit-roll": roll("before:hit"),
  "after-hit-roll": roll("after:hit"),
  "after-scoring-hit": roll("after:hit", "success"),
  "before-wound-roll": roll("before:wound"),
  "after-wound-roll": roll("after:wound"),
  "attack-scores-wound": roll("after:wound", "success"),
  "before-save-roll": roll("before:save"),
  "after-save-roll": roll("after:save"),
  "before-damage-roll": roll("before:damage"),
  "after-damage-roll": roll("after:damage"),
  "before-charge-roll": roll("before:charge"),
  "after-charge-roll": roll("after:charge"),
  "before-advance-roll": roll("before:advance"),
  "after-advance-roll": roll("after:advance"),
  "battle-shock-test": roll("before:battle-shock"),
  "before-battle-shock": roll("before:battle-shock"),
  "after-battle-shock": roll("after:battle-shock"),
  "leadership-test": roll("before:leadership"),
  "desperate-escape-test": roll("before:desperate-escape"),
  "after-psychic-test": roll("after:psychic"),
  "blessings-of-khorne-rolled": roll("after:blessings-of-khorne"),
  "dark-pact-test-passed": roll("after:dark-pact", "success"),
  "on-damage-allocated": { event: "damage-allocated", subjectIsObject: true },
  "after-unit-resolves-attacks": { event: "attacks-resolved" },
  "after-enemy-unit-fires": { event: "attacks-resolved", filter: { kind: "shoot" }, subject: ENEMY },
  "enemy-unit-completed-shooting-targeting-bearer": { event: "attacks-resolved", filter: { kind: "shoot" }, subject: ENEMY, object: "this-unit" },

  "before-bearer-removed": { event: "model-destroyed", filter: { timing: "before-removal" }, object: "this-model" },
  "on-unit-destroyed": { event: "destroyed", subjectIsObject: true },
  "on-model-destroyed": { event: "model-destroyed", subjectIsObject: true, object: "model-in-this-unit" },
  "first-model-destroyed": { event: "model-destroyed", filter: { first: true }, subjectIsObject: true, object: "model-in-this-unit" },
  "enemy-unit-destroyed": { event: "destroyed", object: ENEMY },
  "enemy-unit-destroyed-in-melee": { event: "destroyed", object: ENEMY, filter: { attack_type: "melee" } },
  "quarry-destroyed": { event: "destroyed", object: { designated: "QUARRY" } },

  "becomes-battle-shocked": { event: "state-changed", filter: { state: "battle-shocked" } },
  "unit-empowered": { event: "designation-changed", filter: { tag: "EMPOWERED" } },
  "oath-fulfilled": { event: "designation-resolved", filter: { tag: "OATH OF MOMENT TARGET" }, clock: true },
  "favoured-champions-changed": { event: "designation-changed", filter: { tag: "FAVOURED CHAMPIONS" } },
  "cult-ambush-marker-removed": { event: "marker-removed", filter: { marker: "cult-ambush" }, clock: true },

  "stratagem-used": { event: "used", filter: { kind: "stratagem" }, subject: { owner: "friendly" } },
  "dark-pact-made": { event: "used", filter: { kind: "dark-pact" } },
  "act-of-faith-performed": { event: "used", filter: { kind: "act-of-faith" } },
  "act-of-faith-completed": { event: "used", filter: { kind: "act-of-faith", result: "success" } },
  "agile-manoeuvre-performed": { event: "used", filter: { kind: "manoeuvre" } },
  "ritual-manifested": { event: "used", filter: { kind: "ritual", result: "success" } },
  "ritual-attempted": { event: "used", filter: { kind: "ritual" } },
  "shadow-in-the-warp-used": { event: "used", filter: { kind: "ability", id: "shadow-in-the-warp" }, subject: { owner: "friendly" } },
  "order-issued": { event: "used", filter: { kind: "order" } },
  "order-received": { event: "used", filter: { kind: "order" }, subjectIsObject: true },
  "waaagh-called": { event: "used", filter: { kind: "ability", id: "waaagh" }, subject: { owner: "friendly" } },
  "combat-doctrine-selected": { event: "used", filter: { kind: "doctrine" }, subject: { owner: "friendly" } },
  "contract-invoked": { event: "used", filter: { kind: "contract" } },
  "contract-completed": { event: "used", filter: { kind: "contract", result: "success" } },
  "gate-of-infinity-used": { event: "used", filter: { kind: "ability", id: "gate-of-infinity" } },
  "reanimation-protocols-activated": { event: "used", filter: { kind: "ability", id: "reanimation-protocols" } },
  "warp-channelled": { event: "used", filter: { kind: "ability", id: "channel-the-warp" } },
  "malefic-surge-made": { event: "used", filter: { kind: "ability", id: "malefic-surge" } },

  "miracle-die-generated": { event: "resource-gained", filter: { pool: "miracle-dice" }, clock: true },
  "opponent-cp-gained": { event: "resource-gained", filter: { pool: "cp" }, subject: ENEMY },
  "flux-token-spent": { event: "resource-spent", filter: { pool: "flux" }, clock: true },
  "yield-points-spent": { event: "resource-spent", filter: { pool: "yield-points" }, clock: true },
};

/** A legacy trigger subject as a unit-ref. */
const SUBJECTS: Record<string, unknown> = {
  self: "this-unit", bearer: "this-model", "friendly-unit": { owner: "friendly" }, "enemy-unit": { owner: "enemy" },
  "any-unit": { owner: "any" }, "model-in-bearer": "model-in-this-unit",
  "friendly-model": { owner: "friendly", level: "model" }, "enemy-model": { owner: "enemy", level: "model" },
};
/** The legacy describer read `self` and `bearer` as "this model", and the unit forms as "this unit". */
const PROXIMITY_OF: Record<string, string | undefined> = { self: "this-model", bearer: "this-model", "bearer-unit": undefined, "attached-unit": undefined };

const KNOWN = new Set(["event", "subject", "caused_by", "proximity", "move_types", "condition", "optional", "cost", "window",
  "binds_event_variable", "binds_die_variable", "binds_selected_die_variable", "source_ability", "subject_keywords", "subject_excluded_keywords"]);

/** Migrate one trigger; `migrateCondition` rewrites its condition tree. */
export function migrateTrigger(t: Node, migrateCondition: (c: Node) => Outcome): Outcome {
  const extra = Object.keys(t).filter((k) => !KNOWN.has(k));
  if (extra.length) return { review: `trigger fields ${extra.join(", ")}` };
  const spec = EVENTS[String(t.event)];
  if (!spec) return { review: `no event rule for ${String(t.event)}` };
  const out: Node = { event: spec.event };

  let legacy: unknown = t.subject === undefined ? undefined : SUBJECTS[String(t.subject)];
  if (t.subject !== undefined && legacy === undefined) return { review: `trigger subject ${String(t.subject)}` };
  const kws = t.subject_keywords as string[] | undefined;
  const excluded = t.subject_excluded_keywords as string[] | undefined;
  if (kws || excluded) {
    if (typeof legacy !== "object" || legacy === null) return { review: "keywords on a fixed subject" };
    legacy = { ...(legacy as Node), ...(kws ? { all_of: kws } : {}), ...(excluded ? { none_of: excluded } : {}) };
  }

  let subject: unknown;
  let object: unknown = spec.object;
  if (spec.clock) {
    if (legacy !== undefined && legacy !== "this-unit" && legacy !== "this-model") return { review: `clock event with subject ${String(t.subject)}` };
  } else if (spec.subjectIsObject) {
    if (legacy !== undefined) object = legacy;
    subject = spec.subject;
  } else if (spec.subject !== undefined) {
    // The legacy name fixed the actor; a legacy subject may only repeat or narrow it.
    subject = legacy !== undefined && typeof legacy === "object" ? legacy : spec.subject;
  } else {
    subject = legacy ?? (spec.absentIsAny ? { owner: "any" } : undefined);
  }
  if (subject !== undefined && subject !== "this-unit") out.subject = subject;
  if (object !== undefined) out.object = object;

  const filter: Node = { ...(spec.filter ?? {}) };
  if (Array.isArray(t.move_types)) {
    const have = (filter.move_types as string[] | undefined) ?? [];
    if (have.length && have.join() !== (t.move_types as string[]).join()) return { review: "move types disagree with the event" };
    filter.move_types = t.move_types;
  }
  const cb = t.caused_by as Node | undefined;
  if (cb) {
    filter.by = cb.source === "bearer-model" ? "this-model" : "this-unit";
    if (cb.attack_type) filter.attack_type = cb.attack_type;
    if (cb.weapon_keyword) filter.weapon_keyword = cb.weapon_keyword;
  }
  if (Object.keys(filter).length) out.filter = filter;

  const px = t.proximity as Node | undefined;
  if (px) {
    const of = PROXIMITY_OF[String(px.of ?? "self")];
    if (px.of !== undefined && !(String(px.of) in PROXIMITY_OF)) return { review: `proximity of ${String(px.of)}` };
    out.proximity = { ...(of ? { of } : {}), range: { inches: px.range } };
  }

  const conditions: Node[] = [];
  if (spec.condition) conditions.push(spec.condition);
  if (t.condition) {
    const c = migrateCondition(t.condition as Node);
    if ("review" in c) return c;
    conditions.push(c.node);
  }
  if (conditions.length === 1) out.condition = conditions[0];
  else if (conditions.length > 1) out.condition = { operator: "and", operands: conditions };

  for (const k of ["optional", "cost", "window", "binds_event_variable", "binds_die_variable", "binds_selected_die_variable", "source_ability"])
    if (t[k] !== undefined) out[k] = t[k];
  return { node: out };
}
