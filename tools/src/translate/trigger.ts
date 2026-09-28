/**
 * Humanize a reactive trigger: an event family, who acted (`subject`), what it was aimed at
 * (`object`), which one (`filter`), a spatial gate and a condition. ASCII-only, pinned across
 * the ports by the conformance corpus like the condition describer.
 */
import { dekebab, describeCondition, moveKinds, rangePhrase, titleCase, unitFilterPhrase, type Condition } from "./condition.js";

type P = Record<string, unknown>;

/** A reactive trigger (ability.schema.json#/$defs/trigger). */
export interface AbilityTrigger {
  event?: string;
  subject?: unknown;
  object?: unknown;
  filter?: object;
  proximity?: { of?: unknown; range?: unknown };
  condition?: Condition;
  optional?: boolean;
  cost?: { cp?: number };
  window?: string;
  /** Internal event-object binding; never rendered. */
  binds_event_variable?: string;
  binds_die_variable?: string;
  binds_selected_die_variable?: string;
  source_ability?: { ability_id: string; owner: string; keywords?: string[] };
}

/** A trigger is one object, or an array (the ability fires on ANY listed trigger). */
export type AbilityTriggerSpec = AbilityTrigger | AbilityTrigger[];

/** Normalize the polymorphic trigger field to a flat list (empty when absent). */
export function normalizeTriggers(t?: AbilityTriggerSpec | null): AbilityTrigger[] {
  if (t == null) return [];
  return Array.isArray(t) ? t : [t];
}

function str(v: unknown): string {
  if (v == null) return "?";
  return typeof v === "string" ? v : String(v);
}

function capWord(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1).toLowerCase();
}

function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function orList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Whose turn, as a trigger window names it. */
const TURN_OWNERS: Record<string, string> = { "your-turn": "your", "opponent-turn": "your opponent's" };

/** The actor of a trigger: "the unit", "an enemy unit", "this model". */
function actor(ref: unknown): string {
  if (ref == null || ref === "this-unit") return "the unit";
  if (ref === "this-model") return "this model";
  if (ref === "model-in-this-unit") return "a model in this unit";
  if (typeof ref === "object") {
    const f = ref as P;
    if (typeof f.event_var === "string") return "that unit";
    // Keywords on the actor read as a trailing requirement, as the event names them.
    const owner = f.owner === "friendly" ? "a friendly" : f.owner === "enemy" ? "an enemy" : "a";
    return `${owner} ${f.level === "model" ? "model" : "unit"}`;
  }
  return dekebab(str(ref));
}

/** Keyword requirements on a filter actor: " (the triggering unit must have A and B)". */
function actorKeywords(ref: unknown): string {
  if (typeof ref !== "object" || ref == null) return "";
  const f = ref as P;
  const noun = f.level === "model" ? "model" : "unit";
  let s = "";
  if (Array.isArray(f.all_of)) s += ` (the triggering ${noun} must have ${andList((f.all_of as unknown[]).map(str))})`;
  if (Array.isArray(f.none_of)) s += ` (the triggering ${noun} must not have ${orList((f.none_of as unknown[]).map(str))})`;
  return s;
}

/** An object phrase: "this unit", "an enemy unit". */
function objectPhrase(ref: unknown): string {
  if (ref == null || ref === "this-unit") return "this unit";
  if (ref === "this-model") return "this model";
  if (ref === "model-in-this-unit") return "a model in this unit";
  if (typeof ref === "object") return unitFilterPhrase(ref as P);
  return dekebab(str(ref));
}

const ROLL_NOUN: Record<string, string> = {
  hit: "Hit roll", wound: "Wound roll", save: "saving throw", damage: "Damage roll", charge: "Charge roll",
  advance: "Advance roll", "battle-shock": "Battle-shock test", leadership: "Leadership test", hazard: "Hazard roll",
  psychic: "Psychic test", "desperate-escape": "Desperate Escape test", "dark-pact": "Dark Pact Leadership test",
  "blessings-of-khorne": "Blessings of Khorne roll",
};
const TEST_ROLLS = new Set(["battle-shock", "leadership", "desperate-escape"]);

const ATTACK_MODELS: Record<string, string> = { "this-model": "this model", "this-unit": "a model in this unit", "model-in-this-unit": "a model in this unit" };

function rollClause(t: AbilityTrigger, f: P): string {
  const roll = str(f.roll);
  const noun = ROLL_NOUN[roll] ?? `${dekebab(roll)} roll`;
  const subject = t.subject;
  const anyone = typeof subject === "object" && subject !== null && (subject as P).owner === "any" && Object.keys(subject).length === 1;
  if (t.event === "before-roll") {
    if (TEST_ROLLS.has(roll) && !anyone) return `when ${actor(subject)} takes a ${noun}`;
    const by = !anyone && ["hit", "wound", "damage"].includes(roll) ? ATTACK_MODELS[str(subject ?? "this-unit")] ?? (typeof subject === "object" ? `a model in ${actor(subject)}` : undefined) : undefined;
    return `before ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun} is made${by ? ` for an attack made by ${by}` : ""}`;
  }
  if (f.result === "success" && roll === "hit") return "after scoring a hit";
  if (f.result === "success" && roll === "wound") {
    const by = anyone ? "" : ` made by ${ATTACK_MODELS[str(subject ?? "this-unit")] ?? `a model in ${actor(subject)}`}`;
    return `each time an attack${by} scores a wound`;
  }
  if (f.result === "success" && roll === "dark-pact") return "each time the unit makes a Dark Pact and passes its Leadership test";
  if (roll === "psychic") return "after a Psychic test is taken";
  if (roll === "blessings-of-khorne") return "each time you make a Blessings of Khorne roll";
  return `after ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun} is made`;
}

const USED: Record<string, string> = {
  "dark-pact": "makes a Dark Pact", "act-of-faith": "performs an Act of Faith", manoeuvre: "performs an Agile Manoeuvre",
  ritual: "attempts a Ritual", order: "issues an Order", doctrine: "selects a Combat Doctrine", contract: "invokes its contract",
};

/** The event family's own clause, before proximity, condition and options. */
function eventPhrase(t: AbilityTrigger): string {
  const f = (t.filter ?? {}) as P;
  const who = actor(t.subject);
  switch (t.event) {
    case "battle-started":
      return "at the start of the battle";
    case "battle-formations-declared":
      return "when declaring Battle Formations";
    case "deployment-ended":
      return "after deployment";
    case "round-started":
      return "at the start of the battle round";
    case "round-ended":
      return "at the end of the battle round";
    case "turn-started":
      return "at the start of the turn";
    case "turn-ended":
      return "at the end of the turn";
    case "step-started":
      return `at the start of the ${titleCase(str(f.step))} step`;
    case "selected": {
      if (f.to == null) return `when ${who} is selected`;
      if (f.to === "observe") return `each time ${who} is selected as an Observer unit`;
      if (f.to === "move" && Array.isArray(f.move_types)) return `when ${who} is selected to ${moveKinds(f.move_types)}`;
      return `when ${who} is selected to ${f.to === "attack" ? "shoot or fight" : dekebab(str(f.to))}`;
    }
    case "targets-selected": {
      if (f.kind === "stratagem") return `when ${t.object == null || t.object === "this-unit" || t.object === "this-model" ? "this model's unit" : objectPhrase(t.object)} is targeted with a Stratagem`;
      if (f.kind === "ability" && t.source_ability) {
        const s = t.source_ability;
        return `when ${actor(t.subject)} is selected by the ${titleCase(s.ability_id)} ability of a ${s.owner} ${(s.keywords ?? []).join(" ")} unit`.replace(/\s+unit$/, " unit");
      }
      if (f.kind === "charge") {
        if (t.object != null) return `when ${who} selects ${objectPhrase(t.object)} as a charge target`;
        return typeof t.subject === "object" ? `after ${who} selects targets for its charge but before it makes a Charge move` : "when a Charge is declared";
      }
      return t.object != null ? `when ${who} targets ${objectPhrase(t.object)}` : `when ${who} selects its targets`;
    }
    case "move-ended": {
      if (f.through === "tall-terrain") return `when ${who} moves through terrain over 4" tall`;
      if (f.through === "terrain") return `when ${who} moves through terrain`;
      const kinds = Array.isArray(f.move_types) ? moveKinds(f.move_types) : "";
      const enemy = typeof t.subject === "object";
      // Another unit's move is a reaction window: "each time an enemy unit ends a move".
      if (enemy && kinds === "Fall Back" && t.object == null) return `each time ${who} Falls Back`;
      const tail = t.object != null ? ` from ${objectPhrase(t.object)}` : "";
      const move = `${kinds ? `${/^[aeiou]/i.test(kinds) ? "an" : "a"} ${kinds}` : "a"} move${tail}`;
      return enemy ? `each time ${who} ends ${move}` : `when ${who} ends ${move}`;
    }
    case "set-up": {
      const from: Record<string, string> = {
        "deep-strike": "is set up by Deep Strike", "strategic-reserves": "arrives from Strategic Reserves",
        "cult-ambush": "is set up using Cult Ambush", transport: "is set up from a Transport",
      };
      return `when ${who} ${from[str(f.from)] ?? "is set up"}`;
    }
    case "disembarked":
      return `when ${who} disembarks from a Transport`;
    case "before-roll":
    case "after-roll":
      return rollClause(t, f);
    case "damage-allocated":
      return t.object != null && t.object !== "this-unit" ? `when damage is allocated to ${objectPhrase(t.object)}` : "when damage is allocated";
    case "attacks-resolved":
      if (typeof t.subject === "object") return t.object != null ? `after ${who} has shot and targeted ${objectPhrase(t.object)}` : `after ${who} ${f.kind === "fight" ? "fights" : "shoots"}`;
      return `after ${who} resolves its attacks`;
    case "destroyed": {
      const obj = t.object;
      const melee = f.attack_type === "melee" ? " in melee" : "";
      if (obj == null || obj === "this-unit") return `when the unit is destroyed${melee}`;
      if (typeof obj === "object" && (obj as P).designated != null && Object.keys(obj as P).length === 1) return "each time your quarry is destroyed";
      return `${melee ? "when" : "each time"} ${objectPhrase(obj)} is destroyed${melee}`;
    }
    case "model-destroyed": {
      if (f.timing === "before-removal") return "before this model is removed from play";
      if (f.first === true) return "the first time a model in the unit is destroyed";
      const obj = t.object;
      if (obj === "this-model") return "when this model is destroyed";
      // A model of this unit dying: the object names the model's unit, never the whole unit's destruction.
      if (obj === "model-in-this-unit" || obj === "this-unit" || obj == null) return "when a model in the unit is destroyed";
      return `when ${objectPhrase(obj)} is destroyed`;
    }
    case "used": {
      if (f.kind === "stratagem") return "each time you use a Stratagem";
      if (f.kind === "ability" && f.id != null) return `when you use ${titleCase(str(f.id))}`;
      if (f.kind === "ritual" && f.result === "success") return `each time ${who} manifests a Ritual`;
      if (f.kind === "act-of-faith") return f.result === "success" ? "after an Act of Faith is completed" : "when an Act of Faith is performed";
      if (f.kind === "order" && t.object != null) return "each time an Order is issued to the unit";
      if (f.kind === "contract" && f.result === "success") return "each time you complete a Contract";
      return `each time ${who} ${USED[str(f.kind)] ?? `uses ${dekebab(str(f.kind))}`}`;
    }
    case "state-changed":
      return `when ${who} becomes ${capWord(str(f.state))}`;
    case "designation-changed":
      return f.tag === "EMPOWERED" ? `each time ${who} is Empowered` : `each time ${who} becomes ${str(f.tag)}`;
    case "designation-resolved":
      return f.tag === "OATH OF MOMENT TARGET" ? "when you fulfil an Oath" : `when a ${str(f.tag)} designation is resolved`;
    case "marker-removed":
      return `each time one of your ${titleCase(str(f.marker))} markers is removed`;
    case "objective-gained":
      return "when you gain control of an objective";
    case "resource-gained":
      if (f.pool === "miracle-dice") return "when a Miracle die is generated";
      if (f.pool === "cp") return `each time ${typeof t.subject === "object" && (t.subject as P).owner === "enemy" ? "your opponent gains" : "you gain"} a CP`;
      return `each time ${dekebab(str(f.pool))} is gained`;
    case "resource-spent":
      if (f.pool === "flux") return "each time a Flux token is spent";
      if (f.pool === "yield-points") return "each time you spend Yield points";
      return `each time ${dekebab(str(f.pool))} is spent`;
    default:
      return `when ${dekebab(str(t.event))}`;
  }
}

/** "At the start of your turn": a turn boundary narrowed only by whose turn. */
function turnBoundary(t: AbilityTrigger): string | null {
  if (t.event !== "turn-started" && t.event !== "turn-ended") return null;
  const c = t.condition;
  if (!c || c.type !== "player-turn-is") return null;
  const owner = TURN_OWNERS[str(c.parameters?.turn)];
  return owner ? `at the ${t.event === "turn-started" ? "start" : "end"} of ${owner} turn` : null;
}

/** "At the start of your Command phase": a phase boundary narrowed only by phase and whose turn. */
function phaseBoundary(t: AbilityTrigger): string | null {
  if (t.event !== "phase-started" && t.event !== "phase-ended") return null;
  const operands = !t.condition ? [] : t.condition.operator === "and" ? t.condition.operands ?? [] : [t.condition];
  if (operands.some((c) => c.operator || (c.type !== "phase-is" && c.type !== "player-turn-is"))) return null;
  const phase = operands.find((c) => c.type === "phase-is")?.parameters?.phase;
  const turn = operands.find((c) => c.type === "player-turn-is")?.parameters?.turn;
  if (typeof phase !== "string" || operands.length !== (turn === undefined ? 1 : 2)) return null;
  if (turn !== undefined && !(String(turn) in TURN_OWNERS)) return null;
  const owner = turn === undefined ? "the" : TURN_OWNERS[String(turn)]!;
  return `at the ${t.event === "phase-started" ? "start" : "end"} of ${owner} ${capWord(phase)} phase`;
}

/**
 * A trigger condition's phase and whose turn, as a phrase on the moment ("during your Shooting
 * phase", "in your opponent's turn"), and whatever else the condition says. Only a plain phase-is
 * and player-turn-is (at most one each, joined by "and") make a window.
 */
export function phaseWindow(condition: Condition): { window: string; rest: Condition | null; phase?: string; owner?: string } {
  const operands = condition.operator === "and" ? condition.operands ?? [] : condition.operator ? [] : [condition];
  const phases = operands.filter((c) => c.type === "phase-is");
  const turns = operands.filter((c) => c.type === "player-turn-is");
  const owner = TURN_OWNERS[str(turns[0]?.parameters?.turn)];
  const phase = phases[0]?.parameters?.phase;
  if (phases.length > 1 || turns.length > 1 || (turns.length === 1 && !owner) || (phases.length === 1 && typeof phase !== "string") || phases.length + turns.length === 0) {
    return { window: "", rest: condition };
  }
  const window = phases.length ? `during ${owner ?? "the"} ${capWord(phase as string)} phase` : `in ${owner} turn`;
  const others = operands.filter((c) => !phases.includes(c) && !turns.includes(c));
  return {
    window, rest: others.length === 0 ? null : others.length === 1 ? others[0]! : { operator: "and", operands: others },
    ...(phases.length ? { phase: phase as string } : {}), ...(owner ? { owner } : {}),
  };
}

/** `phase-ended` with "disembarked this turn and battle-shocked": the one boundary that reads as an if. */
function disembarkBattleShock(c: Condition | undefined): boolean {
  if (c?.operator !== "and" || c.operands?.length !== 2) return false;
  const [first, second] = c.operands;
  return first?.type === "happened" && first.parameters?.event === "disembarked" && second?.type === "unit-state" && second.parameters?.state === "battle-shocked";
}

/** Reactive trigger → front-of-sentence lead clause ("an enemy unit ends a move within 9\" of this model"). */
export function describeTrigger(t: AbilityTrigger): string {
  const clock = t.event === "phase-started" || t.event === "phase-ended";
  const plain = !t.proximity && !t.binds_die_variable && !t.binds_selected_die_variable && (t.subject == null || t.subject === "this-unit");
  const boundary = plain ? phaseBoundary(t) ?? turnBoundary(t) : null;
  if (boundary) return t.optional ? `${boundary}, you may use this ability` : boundary;
  const edge = t.event === "phase-started" ? "start" : t.event === "phase-ended" ? "end" : null;
  const disembarkShock = t.event === "phase-ended" && disembarkBattleShock(t.condition);
  const split = t.condition && !disembarkShock ? phaseWindow(t.condition) : null;
  let s = !clock ? eventPhrase(t)
    : split?.phase ? `at the ${edge} of ${split.owner ?? "the"} ${capWord(split.phase)} phase`
      : `at the ${edge} of each phase`;
  s += actorKeywords(t.subject);
  const f = (t.filter ?? {}) as P;
  if (f.by != null) {
    const source = f.by === "this-model" ? "this model" : "this unit";
    const type = f.attack_type && t.event !== "destroyed" ? `${str(f.attack_type)} ` : "";
    const weapon = f.weapon_keyword ? ` with [${str(f.weapon_keyword).toUpperCase()}] weapons` : "";
    s += type || weapon ? ` by ${type}attacks made by ${source}${weapon}` : ` by ${source}`;
  }
  if (t.proximity?.range != null) {
    const of = t.proximity.of === "this-model" ? "this model" : "this unit";
    s += ` within ${rangePhrase(t.proximity.range)} of ${of}`;
  }
  if (disembarkShock) s += ", if the unit disembarked from a Transport this turn and is Battle-shocked";
  else if (split) {
    if (edge && !split.phase && split.owner) s += ` in ${split.owner} turn`;
    else if (!edge && split.window) s += ` ${split.window}`;
    if (split.rest) s += `, if ${describeCondition(split.rest)}`;
  }
  if (t.binds_die_variable) s += ` (binding the generated die as ${dekebab(t.binds_die_variable.replace(/_/g, "-"))})`;
  if (t.binds_selected_die_variable) s += ` (binding one chosen die used in that Act of Faith as ${dekebab(t.binds_selected_die_variable.replace(/_/g, "-"))})`;
  if (t.optional) s += ", you may use this ability";
  return s;
}
