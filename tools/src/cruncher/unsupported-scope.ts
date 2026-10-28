/**
 * Whether an unsupported fragment of an ability could change the attack being crunched. The buff
 * layer reports every fragment it cannot turn into a buff; most of those (movement, deployment,
 * objectives, tests, resources) have no damage content at all, and some act through events outside
 * the attack (deaths, mortal wounds, healing). Only an `unresolved` fragment is a gap in what the
 * engine scores.
 */

/**
 * - `out-of-scope`: no damage content for this attack (a move, a charge re-roll, Scouts, an
 *   Objective Control change, or a defender-side stat seen from the attacker);
 * - `encounter-layer`: acts outside the attack, through deaths, mortal wounds, healing,
 *   designations, or a moment after the unit's own attacks;
 * - `unresolved`: could change the attack's damage, but the engine cannot evaluate it.
 */
export type UnsupportedScope = "out-of-scope" | "encounter-layer" | "unresolved";

const SCOPE_RANK: Record<UnsupportedScope, number> = { "out-of-scope": 0, "encounter-layer": 1, unresolved: 2 };

/** The more consequential of two scopes. */
export function widerScope(a: UnsupportedScope, b: UnsupportedScope): UnsupportedScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** Rolls and characteristics the hit/wound/save/damage math reads. */
export const DAMAGE_ROLLS: ReadonlySet<string> = new Set(["hit", "wound", "save", "damage"]);
export const DAMAGE_STATS: ReadonlySet<string> = new Set(["A", "S", "T", "Sv", "AP", "D", "WS", "BS"]);

/**
 * Leaf effect types that change no attack's damage: healing, moving, placement, eligibility
 * permissions, how many times a stance may be selected, list-building rules, unit keywords, tests,
 * tags, resources, unit composition, and mortal wounds or the extra fight of a dying model (attack
 * sequences of their own, which the attack-buff layer does not model by design). A type not
 * reviewed stays a gap.
 */
export const NON_DAMAGE_EFFECT_TYPES: ReadonlySet<string> = new Set([
  "heal", "move", "mortal-wounds", "set-up", "permission", "cost-modifier", "stance-selection-capacity",
  "move-modifier", "army-rule", "keyword-grant", "act-on-death", "cp-gain", "resource-gain", "add-unit", "split-unit",
  "transport-capacity", "destroy-models", "designate", "test", "targeting", "state-change", "no-effect",
  "oath-modifier", "objective-sticky", "counts-as", "marker", "test-exemption", "return-models",
]);

/** Of the non-damage leaf types, those that act through events outside the attack. */
const ENCOUNTER_EFFECT_TYPES: ReadonlySet<string> = new Set(["mortal-wounds", "act-on-death", "designate", "heal", "destroy-models", "return-models"]);

/**
 * Core abilities (and Reanimation Protocols) that decide deployment, movement, fight order,
 * attachment or resurrection; none changes a hit, wound, save or damage roll.
 */
export const NON_DAMAGE_ABILITIES: ReadonlySet<string> = new Set([
  "deadly-demise", "deep-strike", "fights-first", "hover", "infiltrators", "leader", "lone-operative", "scouts",
  "support", "super-heavy-walker", "mobile", "reanimation-protocols", // mfm:mirror keep — core and named ability slugs, not record ids
]);

/** Of those, the ones that act on a death or bring models back. */
const ENCOUNTER_ABILITIES: ReadonlySet<string> = new Set(["deadly-demise", "reanimation-protocols"]);

const STAT_MODIFIER_OUTSIDE_DAMAGE_PATH = /^stat-modifier on ".*" is outside the damage path$/u;
const ROLL_MODIFIER_OUTSIDE_DAMAGE_PATH = /^roll-modifier on ".*" is outside the damage path$/u;
const REROLL_OUTSIDE_DAMAGE_PATH = /^re-roll on ".*" \(subset ".*"\) is outside the damage path$/u;
/** Which objective an ability picks decides control, never an attack's damage. */
const OBJECTIVE_SELECTION = /^select-objective: /u;
/** A defender stat seen from the attacker; the target perspective models it. */
export const DEFENDER_SIDE_STAT = /: defender-side stat; applies when the buffed unit is the target$/u;
/** An attached model's own effect reaches that model, never the unit being crunched. */
const ATTACHED_MODEL_SCOPED = /^model-scoped effect from an attached model/u;
/** A condition the context cannot decide; its scope is the scope of what it gates. */
export const UNDECIDED_CONDITION = /^conditional: cannot evaluate condition /u;

/** Whether a structurally valid node may be trusted; data already validated against the schema always is. */
export type ValidEffect = (node: unknown) => boolean;
const TRUSTED: ValidEffect = () => true;

/**
 * The scope of an effect subtree: the widest scope among its leaves. A container the buff layer
 * stops at (a selection with a predicate, a dice gate, a dice table) hides a damage effect only
 * when one of its leaves has one. Any leaf or container not recognised here is `unresolved`, the
 * conservative default.
 */
export function effectScope(node: unknown, valid: ValidEffect = TRUSTED): UnsupportedScope {
  if (node === null) return "out-of-scope";
  if (typeof node !== "object" || Array.isArray(node)) return "unresolved";
  const effect = node as Record<string, unknown>;
  const modifier = (typeof effect.modifier === "object" && effect.modifier !== null ? effect.modifier : {}) as Record<string, unknown>;
  const widest = (children: readonly unknown[]): UnsupportedScope =>
    children.reduce<UnsupportedScope>((scope, child) => widerScope(scope, effectScope(child, valid)), "out-of-scope");
  const ability = (id: unknown): UnsupportedScope =>
    typeof id !== "string" || !NON_DAMAGE_ABILITIES.has(id) ? "unresolved" : ENCOUNTER_ABILITIES.has(id) ? "encounter-layer" : "out-of-scope";
  switch (effect.type) {
    case "sequence":
    case "rules-bundle":
      return Array.isArray(effect.steps) ? widest(effect.steps) : "unresolved";
    case "conditional":
      return widest(effect.else === undefined ? [effect.effect] : [effect.effect, effect.else]);
    case "select-units":
    case "for-each-unit":
    case "ability-part":
      return effectScope(effect.effect, valid);
    case "dice-gated":
      return widest([effect.on_success ?? null, effect.on_fail ?? null]);
    case "dice-table":
      return Array.isArray(effect.outcomes)
        ? widest(effect.outcomes.map((outcome) => (outcome as { effect?: unknown }).effect ?? null))
        : "unresolved";
    case "roll-result":
    case "roll-modifier":
    case "re-roll":
      return typeof modifier.roll === "string" && !DAMAGE_ROLLS.has(modifier.roll) ? "out-of-scope" : "unresolved";
    case "stat-modifier":
      return typeof modifier.stat === "string" && !DAMAGE_STATS.has(modifier.stat) ? "out-of-scope" : "unresolved";
    case "ability-grant":
      // A printed grant is judged by the body it carries.
      if (modifier.definition !== undefined) return effectScope(modifier.definition, valid);
      return ability(modifier.ability);
    case "ability-activate":
      return ability(modifier.ability);
    case "rule-state":
      if (modifier.rule_kind === "ability") return ability(modifier.rule);
      return modifier.rule_kind === "core-rule" && modifier.rule === "attacking-ends-hidden" && valid(effect) ? "out-of-scope" : "unresolved";
    // An aura's range only decides which units are in it, and the cruncher's range gates are
    // permissive; a use count never changes an attack.
    case "ability-modifier":
      return modifier.aspect === "uses" || modifier.aspect === "range" ? "out-of-scope" : "unresolved";
    default:
      if (typeof effect.type !== "string" || !NON_DAMAGE_EFFECT_TYPES.has(effect.type)) return "unresolved";
      return ENCOUNTER_EFFECT_TYPES.has(effect.type) ? "encounter-layer" : "out-of-scope";
  }
}

/**
 * Whether the translator's "outside the damage path" label holds. It is trusted only for a stat or
 * roll that is itself off the damage path: a damage stat the translator cannot place is a gap, not
 * an exemption. Undefined when the reason is not one of those labels.
 */
function labelledOutsideDamagePath(reason: string, fragment: unknown): boolean | undefined {
  const modifier = (fragment as { modifier?: { stat?: unknown; roll?: unknown } } | null | undefined)?.modifier;
  if (STAT_MODIFIER_OUTSIDE_DAMAGE_PATH.test(reason)) return typeof modifier?.stat !== "string" || !DAMAGE_STATS.has(modifier.stat);
  if (ROLL_MODIFIER_OUTSIDE_DAMAGE_PATH.test(reason) || REROLL_OUTSIDE_DAMAGE_PATH.test(reason)) {
    return typeof modifier?.roll !== "string" || !DAMAGE_ROLLS.has(modifier.roll);
  }
  return undefined;
}

/**
 * The scope of one unsupported fragment from its reason and effect fragment. `postAttackMoment` is
 * the translator's reason for a moment after the unit's own attacks. An undecided condition is
 * classified by the caller, which can translate its body; here it is `unresolved`.
 */
export function fragmentScope(reason: string, fragment: unknown, postAttackMoment: string, valid: ValidEffect = TRUSTED): UnsupportedScope {
  const labelled = labelledOutsideDamagePath(reason, fragment);
  if (labelled !== undefined) return labelled ? "out-of-scope" : "unresolved";
  if (reason === postAttackMoment) return "encounter-layer";
  if (OBJECTIVE_SELECTION.test(reason) || DEFENDER_SIDE_STAT.test(reason) || ATTACHED_MODEL_SCOPED.test(reason)) return "out-of-scope";
  if (UNDECIDED_CONDITION.test(reason)) return "unresolved";
  return effectScope(fragment, valid);
}

/**
 * Whether a fragment is off the damage path in the semantic-authoring gate's sense: out of scope
 * or an encounter-layer effect, judged without translating an undecided condition's body.
 */
export function isOutsideDamagePath(item: { reason: string; effectFragment: unknown }, postAttackMoment: string, valid: ValidEffect = TRUSTED): boolean {
  const labelled = labelledOutsideDamagePath(item.reason, item.effectFragment);
  if (labelled !== undefined) return labelled;
  if (OBJECTIVE_SELECTION.test(item.reason) || item.reason === postAttackMoment) return true;
  return effectScope(item.effectFragment, valid) !== "unresolved";
}
