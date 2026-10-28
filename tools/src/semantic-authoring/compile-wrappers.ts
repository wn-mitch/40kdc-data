import { slug } from "../pack-blocks.js";
import { DESIGNATION_IDS } from "../translate/designations.js";
import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { condition } from "./compile-conditions.js";
import { currentFamilyVersion } from "./contracts.js";
import type { FilterAlternative } from "./unit-filter-alternatives.js";
import { dslUnitFilter } from "./compile-unit-filter-dsl.js";

/**
 * Wrapping leaves (`aura-range`, `leader-target`, `for-each-unit-select`, `rules-bundle-marker`)
 * and `select-unit`'s own two wraps: `compile.ts` finds these during its leaf walk and folds the
 * body it already assembled into one more layer.
 */

type Node = Record<string, unknown>;

/** Families `compile.ts` treats as body-wrapping markers rather than ordinary conditions/events. */
export const WRAP_CONDITION_FAMILIES = new Set(["aura-range", "leader-target"]);

// ---------------------------------------------------------------------------------------------
// Wrapping leaves: fold the already-assembled body of an otherwise ordinary ability into one
// more layer. Order (aura, then leader-target, then for-each-unit, then rules-bundle) matches
// how `compile.ts` calls them; a real ability is expected to use at most one of these at once.
// ---------------------------------------------------------------------------------------------

/** A folded unit-filter's fields (compile-unit-filters.ts), as selectUnit and wrapAura read them. */
type UnitFilter = { keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; excluded_all_keywords?: string[]; abilities?: string[]; excluded_abilities?: string[]; states?: string[]; designated?: string; not_designated?: string; designated_by?: string; other?: boolean; alternatives?: FilterAlternative[]; membership?: "this-unit" | "stratagem-target" };

/**
 * "(excluding units with the Lone Operative ability)": one negated has-ability check per excluded
 * ability; "units with this ability": one has-ability check per required one.
 */
export function abilityChecks(excluded: readonly string[] | undefined, required: readonly string[] = []): Node[] {
  return [
    ...required.map((ability) => ({ type: "matches", parameters: { filter: { has_ability: [ability] } } })),
    ...(excluded ?? []).map((ability) => ({ type: "matches", parameters: { filter: { lacks_ability: [ability] } } })),
  ];
}

/**
 * One folded filter state as an eligibility check: unengaged and not-battle-shocked negate a
 * state. `subject` names whose state it is when that is not the candidate (an attack's defender).
 */
export function stateCheck(state: string, subject?: string): Node {
  const who = subject === undefined ? {} : { subject };
  if (state === "unengaged") return { type: "matches", parameters: { filter: { not_states: ["engaged"] }, ...who } };
  if (state === "not-battle-shocked") return { type: "matches", parameters: { filter: { not_states: ["battle-shocked"] }, ...who } };
  return { type: "matches", parameters: { filter: { state }, ...who } };
}

/**
 * Unit-filter alternatives ("**A** or **B C** unit", "**PSYKER** or Battle-shocked unit") as one
 * eligibility check: any one alternative, each its own keywords, exclusions and states together.
 */
export function alternativesCheck(list: readonly FilterAlternative[] | undefined, subject?: string): Node | null {
  if (list === undefined || list.length === 0) return null;
  const who = subject === undefined ? {} : { subject };
  return {
    operator: "or",
    operands: list.map((item) => {
      const checks: Node[] = [
        ...(item.keywords?.length ? [{ type: "matches", parameters: { filter: { all_of: item.keywords }, ...who } }] : []),
        ...(item.excluded_keywords?.length ? [{ type: "matches", parameters: { filter: { none_of: item.excluded_keywords }, ...who } }] : []),
        ...(item.states ?? []).map((state) => stateCheck(state, subject)),
      ];
      return checks.length === 1 ? checks[0]! : { operator: "and", operands: checks };
    }),
  };
}

/**
 * An aura over units of either side has no DSL aura target. The one body it can have is a region
 * grant (`counts-as` in a rule region): the same node with its target the units of either side
 * within the range of the ability's model, so the rule is said once.
 */
function anySideRegionGrant(leaf: CompileLeaf, body: Node, modifier: Node, eligible: Node): Node {
  const grant = (body.modifier ?? {}) as Node;
  if (body.type !== "counts-as" || grant.in_region === undefined) throw new CompileError("A unit-filter for an aura must say friendly or enemy.");
  if (modifier.range_cap !== undefined) throw new CompileError("An aura over units of either side cannot apply a capped range to a region grant.");
  const of = leaf.parameters.of;
  return { ...body, target: { owner: "any", ...eligible, within: { range: modifier.range, of: of ?? "this-model", ...(modifier.wholly === true ? { wholly: true } : {}) } } };
}

export function wrapAura(leaf: CompileLeaf, body: Node): Node {
  // A named range (aura-range@5 range_ref) arrives as the range-ref compile-named-range.ts built.
  const range = leaf.parameters.range_table ?? { inches: closed(leaf, "inches") };
  const modifier: Node = { range, effect: bindPicks(body) };
  // Version 3: a folded unit-filter (compile-unit-filters.ts) carries the keywords as `filter`.
  const filter = (leaf.parameters.filter ?? {}) as UnitFilter;
  const eligible = dslUnitFilter({ ...leaf, parameters: { ...filter, keywords: leaf.parameters.keywords ?? filter.keywords, side: closed(leaf, "side") } });
  if (leaf.parameters.wholly === true) modifier.wholly = true;
  modifier.eligible = eligible;
  if (leaf.parameters.emitter_filter !== undefined) modifier.emitter_filter = leaf.parameters.emitter_filter;
  // "within 6\" of this unit" measures from any model of the unit; this model is the default origin.
  if (leaf.parameters.of === "this-unit") modifier.of = "this-unit";
  if (leaf.parameters.conditional_range !== undefined) modifier.conditional_range = leaf.parameters.conditional_range;
  // Version 2 (batch 7a): the aura's range, extensions included, never exceeds this many inches (the DSL's range_cap distance).
  if (leaf.parameters.range_cap_inches !== undefined) modifier.range_cap = { inches: closed(leaf, "range_cap_inches") };
  if (closed(leaf, "side") === "any") return anySideRegionGrant(leaf, body, modifier, eligible);
  return { type: "aura", target: closed(leaf, "side") === "friendly" ? "friendly-within-aura" : "enemy-within-aura", modifier };
}

/**
 * An aura applies its body to each unit in range, but an option the ability picks ("select one
 * Plague. Enemy units within range … have that Plague") is picked once: each activation's pick
 * inside the body is bound, so every unit shares it.
 */
function bindPicks(node: unknown): Node {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== "object") return value;
    const record = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)])) as Node;
    const modifier = record.modifier as Node | undefined;
    const select = modifier?.select as Node | undefined;
    if (record.type === "ability-activate" && select && select.option_var === undefined) {
      return { ...record, modifier: { ...modifier, select: { ...select, option_var: PICKED_OPTION } } };
    }
    return record;
  };
  return walk(node) as Node;
}

/** The name an aura's shared pick is bound under. */
const PICKED_OPTION = "picked-option";

/** The inline definition is evaluated for each actual Leader holder, never its whole attached unit. */
export function wrapLeaderTarget(leaf: CompileLeaf, body: Node): Node {
  const keywords = leaf.parameters.leader_keywords as string[] | undefined;
  return {
    type: "ability-grant",
    target: { level: "model", member_of: "this-unit", attachment_role: "leader", ...(keywords?.length ? { all_of: keywords } : {}) },
    modifier: { definition: { type: "ability-part", duration: "while-leading", effect: leaderEffect(body) } },
  };
}

function leaderEffect(node: Node): Node {
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [
    key,
    key === "target" && (value === "this-unit" || value === "this-model") ? "this-model"
      : Array.isArray(value) ? value.map((item: unknown) => item !== null && typeof item === "object" ? leaderEffect(item as Node) : item)
        : value !== null && typeof value === "object" ? leaderEffect(value as Node) : value,
  ]));
}

/** Shared lowering for the source-level folded filter carried by selecting leaves. */
export function selectionFilter(leaf: CompileLeaf, folded: UnitFilter = (leaf.parameters.filter ?? {}) as UnitFilter): Node {
  const origin = typeof leaf.parameters.within_of === "string" ? { selection_var: leaf.parameters.within_of }
    : leaf.parameters.within_origin ?? "this-model";
  const near = leaf.parameters.near as { of: string; inches: number } | undefined;
  if (near && leaf.parameters.distance === "within") throw new CompileError("A selection names two range origins.");
  return {
    ...dslUnitFilter({ ...leaf, parameters: { ...folded, side: leaf.parameters.scope ?? "any",
      ...(leaf.parameters.target_kind === "model" || folded.membership !== undefined ? { level: "model" } : {}),
      ...(folded.membership !== undefined ? { member_of: folded.membership } : {}),
    } }),
    ...(leaf.parameters.distance === "within" ? { within: { range: { inches: leaf.parameters.inches }, of: origin, ...(leaf.parameters.wholly === true ? { wholly: true } : {}) } } : {}),
    ...(near ? { within: { range: { inches: near.inches }, of: near.of } } : {}),
    ...(leaf.parameters.visible === true || leaf.parameters.visible_to !== undefined
      ? { visible: { to: typeof leaf.parameters.visible_to === "string" ? { selection_var: leaf.parameters.visible_to } : "this-model" } } : {}),
    ...(leaf.parameters.engaged_with !== undefined ? { engaged_with: leaf.parameters.engaged_with } : {}),
  };
}

export function wrapForEachUnit(leaf: CompileLeaf, body: Node): Node {
  if (leaf.parameters.scope === undefined) throw new CompileError("A bare for-each-unit-select needs a unit-filter in its fragment.");
  const hit = forEachHitGate(leaf);
  if (leaf.parameters.including === "target") {
    if (hit !== null) throw new CompileError("A for-each including the target cannot gate the target on a hit.");
    const { other: _other, ...folded } = (leaf.parameters.filter ?? {}) as UnitFilter;
    const filter = selectionFilter(leaf, folded);
    return {
      type: "for-each-unit",
      selector: { filter: { owner: leaf.parameters.scope }, eligibility: { operator: "or", operands: [
        { type: "same-unit", parameters: { as: "defender" } },
        { type: "matches", parameters: { filter } },
      ] } },
      effect: body,
    };
  }
  return { type: "for-each-unit", selector: { filter: selectionFilter(leaf), ...(hit ? { eligibility: hit } : {}) }, effect: body };
}

/**
 * The hit gate of a before-form for-each: "scored a hit against" each candidate, by the attacks the
 * `hit` names (its hit_filter). Only the hit_filter key is accepted; any other key is refused.
 */
function forEachHitGate(leaf: CompileLeaf): Node | null {
  if (leaf.parameters.hit === undefined) return null;
  const hit = leaf.parameters.hit as { hit_filter?: Record<string, unknown> } & Record<string, unknown>;
  const unknown = Object.keys(hit).find((key) => key !== "hit_filter");
  if (unknown !== undefined) throw new CompileError(`A before-form hit names ${unknown}; only its attack-filter can narrow it.`);
  return condition({ role: "CONDITION", family_id: "hit-by-attacks", family_version: currentFamilyVersion("hit-by-attacks"), parameters: { subject: "this-unit", ...(hit.hit_filter !== undefined ? { hit_filter: hit.hit_filter } : {}) }, start_byte: leaf.start_byte, end_byte: leaf.end_byte, fragment: leaf.fragment });
}



export function wrapRulesBundle(body: Node): Node {
  const steps = body.type === "sequence" && Array.isArray(body.steps) ? (body.steps as Node[]) : [body];
  return { type: "rules-bundle", steps };
}

/**
 * `select-unit`'s own two wraps (pre-batch-5, moved here so `compile.ts` stays under the line
 * ceiling): a selection with no attack on it is only who "that unit" names, so it becomes a
 * `select-units` around the effects; one with an attack becomes a `designate-target`.
 */
export function selectUnit(selection: CompileLeaf, body: Node, extra: { maxCount?: Node; eligibility?: Node | null; selectionLimit?: Node | null } = {}): Node {
  if (selection.parameters.within_origin !== undefined && selection.parameters.distance !== "within") throw new CompileError("A selection measured from its bearer's Transport needs a within distance.");
  const own = selection.parameters.count as number | undefined;
  if (own !== undefined && extra.maxCount) throw new CompileError("A selection that names its own count cannot also take one by battle size or battle round.");
  if (selection.parameters.at_least === true && extra.maxCount) throw new CompileError("A selection of one or more cannot also take an upper count by battle size or battle round.");
  const count = extra.maxCount ? { min: 0, max: extra.maxCount }
    : selection.parameters.up_to === true ? { min: 0, max: own ?? 1 }
      // "select one or more": a lower bound only.
      : selection.parameters.at_least === true ? { min: own ?? 1 } : { min: own ?? 1, max: own ?? 1 };
  return {
    type: "select-units",
    selector: {
      filter: selectionFilter(selection),
      count,
      ...(extra.eligibility ? { eligibility: extra.eligibility } : {}),
      ...(extra.selectionLimit ? { limit: extra.selectionLimit } : {}),
      ...(typeof selection.parameters.bind_as === "string" ? { bind_as: selection.parameters.bind_as } : {}),
    },
    effect: body,
  };
}

/**
 * Whether a selection carries a folded unit-filter. A select with no attack against it narrows
 * only its own units, so a folded filter there is a restriction that no effect repeats.
 */
export function selectionHasFilter(selection: CompileLeaf): boolean {
  return Object.values((selection.parameters.filter ?? {}) as Record<string, unknown>).some((value) => value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0));
}


/**
 * A grant or attack scope whose recipient is the friendly unit of an independent pair ("weapons
 * equipped by models in that friendly unit have …"): it says whose attacks the designation affects.
 */
export function friendlyRecipientFrame(leaf: CompileLeaf): boolean {
  return (leaf.family_id === "weapon-ability-grant" || leaf.family_id === "weapon-property-scope")
    && (leaf.parameters.subject === "antecedent" || leaf.parameters.subject === "selected-unit") && leaf.parameters.weapon_type !== undefined;
}

/**
 * The registered designation a record's selection applies: the rule's own name ("A Trap Well
 * Laid" = a-trap-well-laid) or its "<name> target" ("your Blight Bombardment target"). Each rule
 * keeps its own tag, so one rule's selection never satisfies another's test.
 */
/** A use limit printed in a record's name: "(Once per battle, per unit)", "(one per army)". */
const NAME_USE_LIMIT = /\s*\((?:once|twice|one|two)\b[^)]*\bper\b[^)]*\)/giu;

export function designationIdFor(name: string | undefined): string {
  if (!name?.trim()) throw new CompileError("A designated target needs the record's name to name its designation.");
  // The designation is named after the rule, not after how often the rule can be used.
  const base = slug(name.replace(NAME_USE_LIMIT, ""));
  for (const id of [base, `${base}-target`]) if (DESIGNATION_IDS.has(id)) return id;
  throw new CompileError(`Designation "${base}-target" is not registered; add it to tools/src/translate/designations.ts.`);
}

/**
 * The selected unit and the effects on attacks against it, as the DSL's designate-target.
 * `friendlyRecipient` is set only by boundAttackDesignation (below): the selection is then the enemy
 * unit of an independent pair, the frame is the friendly unit's grant, and the select carries its name.
 */
export function designation(recordName: string | undefined, selection: CompileLeaf, leaves: readonly CompileLeaf[], body: Node, lasting: string | undefined, eligibility: Node | null = null, selectionLimit: Node | null = null, friendlyRecipient = false): Node {
  if (selection.parameters.target_kind === "model") throw new CompileError("A designated target is a unit; designate-target selects units, not models.");
  const attack = leaves.find((leaf) => leaf.family_id === "attack" && leaf.start_byte > selection.start_byte) ?? leaves.find((leaf) => leaf.family_id === "attack");
  // "Friendly X units' attacks that target that unit have …": an attack-property scope's frame
  // (compile-weapon-scopes.ts) says whose attacks as well as an attack leaf does.
  const frame = attack ? undefined : friendlyRecipient ? leaves.find(friendlyRecipientFrame)
    : leaves.find((leaf) => leaf.start_byte > selection.start_byte && leaf.parameters.weapon_type !== undefined
      && (leaf.family_id === "weapon-ability-grant" || leaf.family_id === "characteristic-modifier") && leaf.parameters.subject !== "attack");
  if (!attack && !frame) throw new CompileError("A selected unit needs an attack leaf saying whose attacks against it are affected.");
  const own = attack ? attack.parameters.unit === "this-model" : frame!.parameters.subject === "this-model";
  return {
    type: "designate-target",
    designation: designationIdFor(recordName),
    select: { kind: "unit", selector: selectUnit(selection, body, { eligibility, selectionLimit }).selector as Node },
    applies: { to: own ? "bearer-attacks-target" : "attackers-of-target", effect: body },
    ...(lasting ? { duration: lasting } : {}),
  };
}

/** Every `target: "selected-unit"` in a node, rewritten to the named selection; the rest of the node is copied. */
function retarget(node: unknown, to: Node): unknown {
  if (Array.isArray(node)) return node.map((item) => retarget(item, to));
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node as Node).map(([key, value]) => [key, key === "target" && value === "selected-unit" ? to : retarget(value, to)]));
}

/**
 * An independent pair of selections (compile-bound-selection.ts): the friendly unit takes the
 * ability's grant against the enemy unit. The friendly selection wraps a designate-target whose
 * select is the enemy selection and whose `applies` binds the friendly unit as the beneficiary
 * and the enemy unit as the reference. The body's positional "selected unit" is the friendly unit.
 */
export function boundAttackDesignation(recordName: string | undefined, pair: { friendly: CompileLeaf; enemy: CompileLeaf }, leaves: readonly CompileLeaf[], body: Node, lasting: string | undefined, eligibility: { friendly: Node | null; enemy: Node | null }): Node {
  const friendly: Node = { selection_var: String(pair.friendly.parameters.bind_as) };
  const enemy: Node = { selection_var: String(pair.enemy.parameters.bind_as) };
  const effect = retarget(body, friendly) as Node;
  if (JSON.stringify(effect).includes('"selected-unit"')) throw new CompileError("An independent pair binds only attack grants to the friendly unit and attacks that target the enemy unit.");
  const designated = designation(recordName, pair.enemy, leaves, effect, lasting, eligibility.enemy, null, true);
  return selectUnit(pair.friendly, { ...designated, applies: { to: "bound-unit-attacks-reference", beneficiary: friendly, reference: enemy, effect } }, { eligibility: eligibility.friendly });
}
