/**
 * Rules that move one legacy condition node to the round-6 predicate vocabulary
 * (schemas/enrichment/ability-dsl/condition.schema.json). A shape the rules cannot place
 * returns a review reason instead of guessing; `overrides` in migrate-vocabulary.ts
 * resolves those by hand against the rule text.
 */

export type Node = Record<string, unknown>;
export type Outcome = { node: Node } | { review: string };

export interface KeywordSets {
  /** Unit and faction keywords in core, keyed by uppercase form. */
  unit: ReadonlyMap<string, string>;
  /** Every keyword the dangling-reference audit resolves, as `normalizeKeyword` forms. */
  known: ReadonlySet<string>;
  /** Every ability id in enrichment, for "the unit has the X ability". */
  abilities: ReadonlySet<string>;
  /** Designations tested today as keywords (RILED UP, SPOTTED…). */
  tags: ReadonlySet<string>;
  /** Weapon ability names in data/core/weapon-keywords.json, uppercase. */
  weapon: ReadonlySet<string>;
}

/** The condition types before round 6. A type in neither list is left for validation to reject. */
export const LEGACY_TYPES = new Set(["phase-is", "timing-is", "player-turn-is", "army-faction-is", "unit-below-starting-strength", "unit-below-half-strength", "unit-has-keyword", "unit-within-range-of", "model-is-leader", "target-has-keyword", "charged-this-turn", "advanced-this-turn", "remained-stationary", "is-battle-shocked", "has-lost-wounds", "wounds-remaining-at-or-below", "was-hit-by-attack", "wounds-lost-from-attack", "opponent-unit-within-range", "within-range-of-objective", "attack-is-type", "has-fought-this-phase", "destroyed-by-attack-type", "controls-objective", "is-attached", "terrain-area-control", "region-membership", "engagement-state", "territory-control", "fights-first", "disposition-matches", "units-destroyed", "units-destroyed-comparison", "objective-majority", "action-completed", "objective-has-tag", "unit-has-tag", "terrain-has-tag", "new-objective-controlled", "engagement-fronts", "destroyed-while-on-objective", "destroyed-in-tagged-terrain", "operation-markers", "attack-stat-compare", "made-ingress-move-this-turn", "disembarked-from-transport", "faction-rule-active", "battle-round", "token-count-at-or-above", "unit-was-in-engagement-range-of", "unit-model-count", "uniform-ranged-loadout", "all-attacks-target-same-unit", "target-is-visible", "ability-window-capacity", "candidate-eligible-in-ability-window", "unit-is-led-by", "on-battlefield", "target-within-half-weapon-range", "has-destroyed", "roll-succeeded", "unit-selected-to-shoot-this-phase", "unit-selected-to-move-this-phase", "eligible-to-shoot", "selection-has-keyword", "target-of-triggering-charge", "every-model-within-range-of-bearer", "event-source-is-bearer-unit", "event-source-is-attached-unit", "miracle-die-generation-reason", "miracle-die-generation-timing", "destroyed-event-within-range", "destroyed-by-friendly-unit"]);

const PHASES = new Set(["command", "movement", "shooting", "charge", "fight"]);

const not = (node: Node): Node => ({ operator: "not", operands: [node] });
const pred = (type: string, parameters: Node): Node =>
  Object.keys(parameters).length ? { type, parameters } : { type };

/**
 * Where a condition sits changes what the legacy "target" meant: the attack's target in an
 * effect, the candidate in a selection's eligibility (the default subject there), and the
 * selected unit inside a selection's effect.
 */
export type Place = "effect" | "eligibility" | "selection";
let place: Place = "effect";
const legacyTarget = (): string | undefined => (place === "eligibility" ? undefined : place === "selection" ? "selected-unit" : "defender");

/** A legacy `subject` string as a unit-ref; undefined keeps the default (this-unit). */
function subjectRef(v: unknown, self: "this-unit" | "this-model" = "this-unit"): string | undefined | null {
  switch (v) {
    case undefined:
    case "unit":
      return undefined;
    case "self":
    case "bearer":
      return self === "this-unit" ? undefined : "this-model";
    case "target":
      return legacyTarget();
    case "defender":
      return "defender";
    case "attacker":
      return "attacker";
    case "triggering-unit":
      return "event-subject";
    case "recipient":
      return "recipient";
    case "selected-friendly-unit":
    case "candidate":
      return "selected-unit";
    case "destroyed-model":
      return "event-object";
    default:
      return null;
  }
}

const withSubject = (params: Node, subject: string | undefined): Node =>
  subject === undefined ? params : { subject, ...params };

/** How a legacy `keyword` value reads: unit keywords, a designation, or another predicate. */
export function keywordPredicate(raw: unknown, subject: string | undefined, sets: KeywordSets): Outcome {
  if (typeof raw !== "string" || !raw.trim()) return { review: "keyword missing" };
  const kw = raw.trim();
  const upper = kw.toUpperCase().replace(/’/g, "'");
  const pseudo: Record<string, Node> = {
    "BATTLE-SHOCKED": pred("unit-state", withSubject({ state: "battle-shocked" }, subject)),
    "BENEFIT-OF-COVER": pred("unit-state", withSubject({ state: "benefit-of-cover" }, subject)),
    "BELOW-STARTING-STRENGTH": pred("strength", withSubject({ below: "starting" }, subject)),
    "BELOW-HALF-STRENGTH": pred("strength", withSubject({ below: "half" }, subject)),
    "BATTLE-SHOCKED-OR-BELOW-HALF": {
      operator: "or",
      operands: [
        pred("unit-state", withSubject({ state: "battle-shocked" }, subject)),
        pred("strength", withSubject({ below: "half" }, subject)),
      ],
    },
    "CHARACTER-MONSTER-OR-VEHICLE": pred("has-keyword", withSubject({ any_of: ["CHARACTER", "MONSTER", "VEHICLE"] }, subject)),
  };
  if (pseudo[upper]) return { node: pseudo[upper]! };
  if (sets.tags.has(upper) || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(kw)) {
    // Designations: the tag list, or a kebab-case state name an effect applied.
    return { node: pred("designated", withSubject({ tag: sets.tags.has(upper) ? upper : kw }, subject)) };
  }
  if (sets.weapon.has(upper.replace(/\s+\d+\+?$/, ""))) return { review: `weapon ability "${kw}" tested as a unit keyword` };
  const slug = kw.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (/ discipline$/i.test(kw)) return { node: pred("rule-active", { rule: slug }) };
  if (kw !== upper && sets.abilities.has(slug)) return { node: pred("has-ability", withSubject({ ability: slug }, subject)) };
  // Keywords as GW prints them: capitals, words joined by spaces (a hyphen joining words is a space).
  const printed = /^[A-Z][A-Z0-9’' ]*(-[A-Z][A-Z0-9’' ]*)*$/.test(kw) ? kw.replace(/-/g, " ") : sets.unit.has(upper) ? upper : undefined;
  if (printed && printed !== "A") return { node: pred("has-keyword", withSubject({ all_of: [printed] }, subject)) };
  const unitKw = sets.unit.get(upper.replace(/'/g, "’")) ?? sets.unit.get(upper) ?? sets.known.has(kw.replace(/\s+/g, "").toLowerCase());
  if (unitKw && kw === kw.toUpperCase()) return { node: pred("has-keyword", withSubject({ all_of: [kw === kw.toUpperCase() ? kw : upper] }, subject)) };
  return { review: `"${kw}" is not a unit keyword, tag or known state` };
}

const WINDOW: Record<string, string> = {
  "this-turn": "turn", turn: "turn", "this-phase": "phase", phase: "phase", "this-attack": "event",
  "current-event": "event", current: "event", battle: "battle", any: "battle", "previous-turn": "previous-turn",
  "just-finished-shooting-sequence": "event", "just-finished-attack-sequence": "event", "battle-round": "round",
};

const moveHappened = (moveTypes: string[], window = "turn", subject?: string): Node =>
  pred("happened", withSubject({ event: "move-ended", filter: { move_types: moveTypes }, window }, subject));

function inches(v: unknown): Node | string | null {
  if (v === "engagement") return "engagement";
  if (typeof v === "number") return { inches: v };
  return null;
}

/** A legacy unit-within-range-of target_type as a unit filter or role. */
function rangeTarget(p: Node, sets: KeywordSets): Node | string | null {
  const tt = p.target_type as string | undefined;
  const kws: string[] = Array.isArray(p.keywords) ? (p.keywords as string[]) : p.keyword != null ? [String(p.keyword)] : [];
  const none = p.exclude_keyword != null ? [String(p.exclude_keyword)] : [];
  const fixed: Record<string, string[]> = {
    "friendly-infantry": ["INFANTRY"], "friendly-monster": ["MONSTER"], "friendly-cryptek": ["CRYPTEK"],
    "friendly-kroot-character": ["KROOT", "CHARACTER"], "friendly-chaplain": ["CHAPLAIN"],
  };
  const filter = (owner: string, all: string[]): Node | null => {
    for (const k of [...all, ...none]) if (!sets.unit.has(k.toUpperCase()) && !sets.unit.has(k.toUpperCase().replace(/'/g, "’"))) return null;
    const f: Node = { owner };
    if (all.length) f.all_of = all.map((k) => k.toUpperCase());
    if (none.length) f.none_of = none.map((k) => k.toUpperCase());
    if (p.visible === true) f.visible = true;
    return f;
  };
  const of = typeof p.of === "string" ? p.of : undefined;
  const key = tt ?? of;
  if (key === "friendly" || key === "friendly-keyword") return filter("friendly", kws);
  if (key && fixed[key]) return filter("friendly", [...kws, ...fixed[key]!]);
  if (key === "enemy") return filter("enemy", kws);
  if (key === "visible-enemy") return { owner: "enemy", visible: true };
  if (key === "triggering-enemy-unit") return "event-subject";
  if (key === "current-ranged-attack-target") return "defender";
  return null;
}

export function migrateSimple(c: Node, sets: KeywordSets, at: Place = "effect"): Outcome {
  place = at;
  const t = c.type as string;
  const p = (c.parameters ?? {}) as Node;
  const extra = Object.keys(c).filter((k) => !["type", "parameters", "negated"].includes(k));
  if (extra.length) return { review: `unexpected top-level ${extra.join(", ")}` };
  const out = migrateTyped(t, p, sets);
  if ("review" in out) return out;
  return { node: c.negated ? not(out.node) : out.node };
}

function migrateTyped(t: string, p: Node, sets: KeywordSets): Outcome {
  const keys = Object.keys(p);
  const only = (...allowed: string[]): boolean => keys.every((k) => allowed.includes(k));
  const sub = (self: "this-unit" | "this-model" = "this-unit") => subjectRef(p.subject, self);
  switch (t) {
    case "phase-is": {
      const ph = p.phase === "command-phase" ? "command" : p.phase;
      return PHASES.has(String(ph)) && only("phase") ? { node: pred(t, { phase: ph }) } : { review: `phase "${String(p.phase)}"` };
    }
    case "player-turn-is": {
      const turn = { your: "your-turn", "your-turn": "your-turn", opponent: "opponent-turn", "opponent-turn": "opponent-turn" }[String(p.turn)];
      return turn && only("turn") ? { node: pred(t, { turn }) } : { review: `turn "${String(p.turn)}"` };
    }
    case "battle-round":
      if (p.round != null && only("round")) return { node: pred(t, { min: p.round, max: p.round }) };
      return only("min", "max") ? { node: pred(t, p) } : { review: "battle-round params" };
    case "faction-rule-active":
      return only("rule") ? { node: pred("rule-active", { rule: p.rule }) } : { review: "rule params" };
    case "unit-has-keyword":
    case "target-has-keyword": {
      if (!only("keyword", "subject")) return { review: "keyword params" };
      const s = t === "target-has-keyword" ? (p.subject === "recipient" ? "recipient" : legacyTarget()) : sub();
      if (s === null) return { review: `subject "${String(p.subject)}"` };
      return keywordPredicate(p.keyword, s, sets);
    }
    case "model-is-leader":
      return keys.length === 0 ? { node: pred("attachment", { subject: "this-model", role: "leading" }) } : { review: "leader params" };
    case "is-attached":
      if (keys.length === 0) return { node: pred("attachment", { subject: "this-model", role: "leading" }) };
      if (only("keyword") && sets.unit.has(String(p.keyword).toUpperCase().replace(/'/g, "’")))
        return { node: pred("attachment", { subject: "this-model", role: "leading", with: { all_of: [String(p.keyword).toUpperCase().replace(/'/g, "’")] } }) };
      return { review: "is-attached params" };
    case "unit-is-led-by":
      return only("keyword") ? { node: pred("attachment", { role: "led", with: { all_of: [String(p.keyword).toUpperCase()] } }) } : { review: "led-by params" };
    case "unit-below-starting-strength":
    case "unit-below-half-strength": {
      const s = sub();
      if (s === null || !only("subject")) return { review: "strength params" };
      return { node: pred("strength", withSubject({ below: t === "unit-below-half-strength" ? "half" : "starting" }, s)) };
    }
    case "unit-model-count":
      return only("keyword", "count_min") ? { node: pred("model-count", { ...(p.keyword ? { keyword: p.keyword } : {}), min: p.count_min }) } : { review: "model-count params" };
    case "has-lost-wounds":
      if (!only("wounds_remaining_max")) return { review: "lost-wounds params" };
      return { node: pred("wounds", { subject: "this-model", lost: true, ...(p.wounds_remaining_max != null ? { remaining_max: p.wounds_remaining_max } : {}) }) };
    case "wounds-remaining-at-or-below":
      return only("threshold") ? { node: pred("wounds", { subject: "this-model", remaining_max: p.threshold }) } : { review: "wounds params" };
    case "uniform-ranged-loadout":
      return only("model_keyword") ? { node: pred("loadout", { ...(p.model_keyword ? { model_keyword: p.model_keyword } : {}), uniform: "ranged" }) } : { review: "loadout params" };
    case "engagement-state": {
      if (!only("state", "timing")) return { review: "engagement params" };
      const at = p.timing === "start-of-phase" ? { at: "phase-start" } : {};
      const st = p.state == null ? "engaged" : String(p.state);
      const engaged = pred("unit-state", { state: "engaged", ...at });
      if (["engaged", "within-engagement-range", "in-engagement-range"].includes(st)) return { node: engaged };
      if (["unengaged", "not-in-engagement-range", "not-within-enemy-engagement-range"].includes(st)) return { node: not(engaged) };
      if (["on-battlefield", "embarked", "in-strategic-reserves"].includes(st)) return { node: pred("unit-state", { state: st, ...at }) };
      return { review: `engagement state "${st}"` };
    }
    case "is-battle-shocked":
    case "on-battlefield":
    case "fights-first": {
      const s = t === "on-battlefield" ? sub("this-model") : sub();
      if (s === null || !only("subject")) return { review: `${t} params` };
      const state = { "is-battle-shocked": "battle-shocked", "on-battlefield": "on-battlefield", "fights-first": "fights-first" }[t];
      return { node: pred("unit-state", withSubject({ state }, s)) };
    }
    case "eligible-to-shoot":
      return keys.length === 0 ? { node: pred("eligible", { to: "shoot" }) } : { review: "eligible params" };
    case "candidate-eligible-in-ability-window":
      return { node: pred("eligible", { subject: "selected-unit", to: "be-selected", source_ability: p.source_ability, at: "opponents-previous-turn-end" }) };
    case "charged-this-turn":
    case "remained-stationary":
    case "made-ingress-move-this-turn": {
      const s = sub();
      if (s === null || !only("subject")) return { review: `${t} params` };
      const mt = { "charged-this-turn": "charge", "remained-stationary": "remain-stationary", "made-ingress-move-this-turn": "ingress" }[t]!;
      return { node: moveHappened([mt], "turn", s) };
    }
    case "advanced-this-turn": {
      if (!only("move")) return { review: "advanced params" };
      const mt = { undefined: ["advance"], advance: ["advance"], "fall-back": ["fall-back"], "advance-or-fall-back": ["advance", "fall-back"], ingress: ["ingress"] }[String(p.move)];
      return mt ? { node: moveHappened(mt) } : { review: `move "${String(p.move)}"` };
    }
    case "disembarked-from-transport":
      return keys.length === 0 ? { node: pred("happened", { event: "disembarked", window: "turn" }) } : { review: "disembark params" };
    case "has-fought-this-phase":
    case "unit-selected-to-shoot-this-phase":
    case "unit-selected-to-move-this-phase": {
      const s = sub("this-model");
      if (s === null || !only("subject")) return { review: `${t} params` };
      const to = { "has-fought-this-phase": "fight", "unit-selected-to-shoot-this-phase": "shoot", "unit-selected-to-move-this-phase": "move" }[t];
      return { node: pred("happened", withSubject({ event: "selected", filter: { to }, window: "phase" }, s)) };
    }
    case "was-hit-by-attack": {
      if (!only("subject", "attack_type", "weapon_name", "weapon_keyword", "source", "window", "count_min")) return { review: "hit params" };
      if (p.attack_type === "mortal") return { review: "hit by a mortal attack" };
      const object = subjectRef(p.subject);
      if (object === null) return { review: `subject "${String(p.subject)}"` };
      const filter: Node = { roll: "hit", result: "success" };
      for (const k of ["attack_type", "weapon_name", "weapon_keyword"]) if (p[k] != null) filter[k] = p[k];
      if (p.source != null) {
        if (typeof p.source !== "object") return { review: "hit source" };
        filter.by = p.source;
      }
      const window = p.window != null ? WINDOW[String(p.window)] : "phase";
      if (!window) return { review: `window "${String(p.window)}"` };
      const n: Node = { event: "after-roll", object: object ?? "this-unit", filter, window };
      if (typeof p.count_min === "number" && p.count_min > 1) n.count_min = p.count_min;
      return { node: pred("happened", n) };
    }
    case "wounds-lost-from-attack": {
      const object = subjectRef(p.subject);
      if (object === null || !only("subject", "attack_type", "source")) return { review: "wounds-lost params" };
      const filter: Node = p.attack_type ? { attack_type: p.attack_type } : {};
      return { node: pred("happened", { event: "damage-allocated", object: object ?? "this-unit", ...(Object.keys(filter).length ? { filter } : {}), window: p.source === "triggering-attacks" ? "event" : "phase" }) };
    }
    case "destroyed-by-attack-type": {
      if (!only("attack_type", "weapon_name")) return { review: "destroyed-by params" };
      const at = p.attack_type;
      if (at != null && !["ranged", "melee", "any"].includes(String(at))) return { review: `attack type "${String(at)}"` };
      const filter: Node = {};
      if (at && at !== "any") filter.attack_type = at;
      if (p.weapon_name) filter.weapon_name = p.weapon_name;
      return { node: pred("happened", { event: "destroyed", object: "event-object", ...(Object.keys(filter).length ? { filter } : {}), window: "event" }) };
    }
    case "has-destroyed": {
      const s = sub();
      if (s === null) return { review: "has-destroyed subject" };
      const object: Node = { owner: p.victim_owner };
      if (Array.isArray(p.victim_keywords)) object.all_of = p.victim_keywords;
      if (p.victim_kind === "model") object.level = "model";
      const window = WINDOW[String(p.window)];
      if (!window) return { review: "has-destroyed window" };
      return { node: pred("happened", { event: p.victim_kind === "model" ? "model-destroyed" : "destroyed", object, filter: { by: s ?? "this-unit" }, window, ...(typeof p.count_min === "number" && p.count_min > 1 ? { count_min: p.count_min } : {}) }) };
    }
    case "units-destroyed": {
      if (!only("side", "window", "count_min", "keyword") || p.window == null) return { review: "units-destroyed params" };
      const owner = { enemy: "enemy", friendly: "friendly" }[String(p.side)];
      const window = WINDOW[String(p.window)];
      if (!owner || !window) return { review: `units-destroyed side/window "${String(p.side)}"/"${String(p.window)}"` };
      const object: Node = { owner };
      if (p.keyword) object.all_of = [String(p.keyword).toUpperCase()];
      return { node: pred("happened", { event: "destroyed", object, window, ...(typeof p.count_min === "number" && p.count_min > 1 ? { count_min: p.count_min } : {}) }) };
    }
    case "units-destroyed-comparison": {
      if (!only("comparator", "subject", "reference")) return { review: "comparison shape" };
      const side = (s: Node): Node | null => {
        const owner = { enemy: "enemy", friendly: "friendly" }[String(s.side)];
        const window = WINDOW[String(s.window)];
        return owner && window ? { event: "destroyed", object: { owner }, window } : null;
      };
      const left = side(p.subject as Node);
      const ref = p.reference as Node;
      const right = ref.value != null ? { value: ref.value } : side(ref);
      if (!left || !right) return { review: "comparison sides" };
      return { node: pred("happened-compare", { left, comparison: p.comparator, right }) };
    }
    case "action-completed": {
      if (!only("action_id", "count_min", "target_kind", "target_filter", "window")) return { review: "action params" };
      const window = WINDOW[String(p.window)];
      if (!window) return { review: "action window" };
      const n: Node = { event: "used", filter: { kind: "action", id: p.action_id, result: "success" }, window };
      const tf = (p.target_filter ?? {}) as Node;
      if (p.target_kind === "objective") {
        const obj: Node = {};
        if (tf.objective_role) obj.role = tf.objective_role;
        if (tf.exclude === "home") obj.role = "non-home";
        n.object = { objective: obj };
      } else if (p.target_kind === "terrain") n.object = { terrain_area: tf.in_enemy_territory ? { territory: "enemy-territory" } : {} };
      else if (p.target_kind === "enemy-unit") n.object = { owner: "enemy" };
      else if (p.target_kind != null) return { review: "action target" };
      if (typeof p.count_min === "number" && p.count_min > 1) n.count_min = p.count_min;
      return { node: pred("happened", n) };
    }
    case "new-objective-controlled":
      return { node: pred("happened", { event: "objective-gained", window: "turn", ...(typeof p.count_min === "number" && p.count_min > 1 ? { count_min: p.count_min } : {}) }) };
    case "objective-majority":
      return p.relative_to == null || p.relative_to === "opponent" ? { node: pred("controls", { compare: "more-than-opponent" }) } : { review: "majority params" };
    case "controls-objective": {
      if (!only("count_min", "exclude", "objective_role", "objective", "scope")) return { review: "controls params" };
      const obj: Node = {};
      if (p.objective_role) obj.role = p.objective_role;
      if (p.exclude === "home") obj.role = "non-home";
      if (p.objective === "opponent-home") obj.home_of = "enemy";
      else if (p.objective === "your-home") obj.home_of = "friendly";
      else if (p.objective != null) obj.name = p.objective;
      if (p.scope != null) obj.territory = p.scope;
      const n: Node = Object.keys(obj).length ? { objective: obj } : {};
      if (typeof p.count_min === "number" && p.count_min > 1) n.count_min = p.count_min;
      return { node: pred("controls", n) };
    }
    case "objective-has-tag": {
      const obj: Node = {};
      if (p.objective === "opponent-home") obj.home_of = "enemy";
      const n: Node = { subject: { objective: obj }, tag: p.tag };
      if (p.count_min != null) n.count_min = p.count_min;
      if (p.count_max != null) n.count_max = p.count_max;
      return only("tag", "count_min", "count_max", "objective") ? { node: pred("designated", n) } : { review: "objective tag params" };
    }
    case "unit-has-tag": {
      if (p.side != null || p.count_min != null || p.window != null) return { review: "scoring unit tag" };
      const s = sub();
      if (s === null || !only("tag", "subject")) return { review: "unit tag params" };
      if (p.tag === "hidden") return { node: pred("unit-state", withSubject({ state: "hidden" }, s)) };
      return { node: pred("designated", withSubject({ tag: p.tag }, s)) };
    }
    case "attack-is-type": {
      if (p.comparison === "strength-greater-than-toughness")
        return { node: pred("attack-compare", { left: { of: "attacker", stat: "S" }, comparison: "greater-than", right: { of: "defender", stat: "T" } }) };
      if (!only("attack_type")) return { review: "attack-is params" };
      const at = String(p.attack_type);
      if (at === "ranged" || at === "melee") return { node: pred("attack-is", { attack_type: at }) };
      if (at === "close-quarters") return { node: pred("attack-is", { shooting_type: "close-quarters" }) };
      return { review: `attack type "${at}"` };
    }
    case "attack-stat-compare": {
      const cmp = p.comparison;
      if (p.attacker_stat === "target-unit-max-T" && typeof p.target_stat === "number")
        return { node: pred("attack-compare", { left: { of: "defender", stat: "T", reduce: "max" }, comparison: cmp, right: { value: p.target_stat } }) };
      if (typeof p.value === "number") return { node: pred("attack-compare", { left: { of: "attacker", stat: p.attacker_stat }, comparison: cmp, right: { value: p.value } }) };
      if (typeof p.target_stat === "string") return { node: pred("attack-compare", { left: { of: "attacker", stat: p.attacker_stat }, comparison: cmp, right: { of: "defender", stat: p.target_stat } }) };
      return { review: "stat compare" };
    }
    case "all-attacks-target-same-unit":
      return { node: pred("attack-is", { ...(p.attack_type ? { attack_type: p.attack_type } : {}), all_target_same_unit: true }) };
    case "target-is-visible":
      return keys.length === 0 ? { node: pred("visible", { subject: "defender", to: "attacker" }) } : { review: "visible params" };
    case "target-within-half-weapon-range":
      return keys.length === 0 ? { node: pred("within", { subject: "defender", of: "attacker", range: "half-weapon" }) } : { review: "half range params" };
    case "token-count-at-or-above":
      return only("pool_id", "threshold") ? { node: pred("resource", { pool: p.pool_id, at_least: p.threshold }) } : { review: "token params" };
    case "ability-window-capacity":
      return { node: pred("resource", { pool: "ability-selections", below_max: true, source_ability: p.source_ability, at: "opponents-previous-turn-end" }) };
    case "terrain-area-control":
      if (p.area === "flow-of-magic" && only("area", "relation"))
        return { node: pred("in-region", { region: { rule_region: { region_id: "flow-of-magic", owner_faction: "thousand-sons" } }, ...(p.relation === "wholly-within" ? { wholly: true } : {}) }) };
      // The terrain-area-control predicate is retired: no rule controls a terrain area.
      return { review: "terrain-area control has no current predicate" };
    case "within-range-of-objective": {
      const s = sub();
      if (s === null || !only("subject", "objective_role", "controlled", "controlled_by", "objective")) return { review: "objective range params" };
      const obj: Node = {};
      if (p.objective_role) obj.role = p.objective_role;
      if (p.objective === "home") obj.role = "home";
      if (p.controlled === "friendly" || p.controlled_by === "your-army") obj.controlled_by = "friendly";
      if (p.controlled_by === "opponent") obj.controlled_by = "enemy";
      return { node: pred("within", withSubject({ of: { objective: obj }, range: "objective-control" }, s)) };
    }
    case "opponent-unit-within-range": {
      if (!only("range", "range_inches", "within_inches", "visible", "range_multiplier", "reference")) return { review: "enemy range params" };
      let range: Node | string | null = inches(p.range ?? p.range_inches ?? p.within_inches);
      if (p.range_multiplier === 0.5 && p.reference === "weapon-max-range") range = "half-weapon";
      if (!range) return { review: "enemy range missing" };
      return { node: pred("within", { of: { owner: "enemy", ...(p.visible === true ? { visible: true } : {}) }, range }) };
    }
    case "unit-within-range-of": {
      const tt = p.target_type;
      if (tt === "closest-eligible" && only("target_type", "range")) {
        const range = p.range != null ? inches(p.range) : undefined;
        return { node: pred("closest", { subject: "defender", among: "eligible-targets", ...(range ? { range } : {}) }) };
      }
      if (tt === "battlefield-edge" && only("target_type", "within_inches")) return { node: pred("within", { of: "battlefield-edge", range: { inches: p.within_inches } }) };
      if (tt === "cult-ambush-marker" && only("target_type", "range")) return { node: pred("within", { of: { marker: "cult-ambush" }, range: { inches: p.range } }) };
      if (tt === "area-terrain" && only("target_type")) return { node: pred("in-region", { region: { terrain_area: {} } }) };
      if (!only("target_type", "keyword", "keywords", "exclude_keyword", "range", "within_inches", "visible", "subject", "of")) return { review: "range params" };
      if (tt == null && typeof p.of !== "string") return { review: "range target owner unstated" };
      const of = rangeTarget(p, sets);
      const s = subjectRef(p.subject, "this-model");
      const range = inches(p.range ?? p.within_inches);
      if (!of || s === null || !range) return { review: `range target "${String(tt ?? p.of)}"` };
      return { node: pred("within", withSubject({ of, range }, s)) };
    }
    case "disposition-matches": {
      const d = String(p.disposition);
      const s = sub();
      if (s === null) return { review: "disposition subject" };
      if ((d === "friendly" || d === "enemy") && only("disposition", "subject") && p.subject === "recipient") return { node: pred("owned-by", { subject: "recipient", owner: d }) };
      if ((d === "friendly" || d === "enemy") && only("disposition", "subject")) return { node: pred("owned-by", withSubject({ owner: d }, s)) };
      if (d === "friendly" && only("disposition", "subject", "model_count_min"))
        return { node: { operator: "and", operands: [pred("owned-by", withSubject({ owner: "friendly" }, s)), pred("model-count", withSubject({ min: p.model_count_min }, s))] } };
      if (d === "riled-up" && only("disposition")) return { node: pred("designated", { tag: "RILED UP" }) };
      if (d === "fell-back" && only("disposition")) return { node: moveHappened(["fall-back"]) };
      if (d === "closest-eligible-target" && only("disposition")) return { node: pred("closest", { subject: "defender", among: "eligible-targets" }) };
      return { review: `disposition "${d}"` };
    }
    case "unit-was-in-engagement-range-of": {
      const s = subjectRef(p.subject);
      if (s === null || p.snapshot !== "phase-start" || typeof p.object !== "object") return { review: "engagement history params" };
      return { node: pred("unit-state", withSubject({ state: "engaged", with: p.object, at: "phase-start" }, s)) };
    }
    case "region-membership":
    case "operation-markers":
    case "engagement-fronts":
    case "destroyed-while-on-objective":
    case "destroyed-in-tagged-terrain":
      return t === "region-membership" ? { review: "region membership" } : { node: pred(t, p) };
    default:
      return { review: `no rule for ${t}` };
  }
}
