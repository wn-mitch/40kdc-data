import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import type { FilterAlternative } from "./unit-filter-alternatives.js";

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
type UnitFilter = { keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; excluded_all_keywords?: string[]; abilities?: string[]; excluded_abilities?: string[]; states?: string[]; other?: boolean; alternatives?: FilterAlternative[] };

/**
 * "(excluding units with the Lone Operative ability)": one negated has-ability check per excluded
 * ability; "units with this ability": one has-ability check per required one.
 */
export function abilityChecks(excluded: readonly string[] | undefined, required: readonly string[] = []): Node[] {
  return [
    ...required.map((ability) => ({ type: "has-ability", parameters: { ability } })),
    ...(excluded ?? []).map((ability) => ({ operator: "not", operands: [{ type: "has-ability", parameters: { ability } }] })),
  ];
}

/**
 * One folded filter state as an eligibility check: unengaged and not-battle-shocked negate a
 * state. `subject` names whose state it is when that is not the candidate (an attack's defender).
 */
export function stateCheck(state: string, subject?: string): Node {
  const who = subject === undefined ? {} : { subject };
  if (state === "unengaged") return { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged", ...who } }] };
  if (state === "not-battle-shocked") return { operator: "not", operands: [{ type: "unit-state", parameters: { state: "battle-shocked", ...who } }] };
  return { type: "unit-state", parameters: { state, ...who } };
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
        ...(item.keywords?.length ? [{ type: "has-keyword", parameters: { all_of: item.keywords, ...who } }] : []),
        ...(item.excluded_keywords ?? []).map((keyword) => ({ operator: "not", operands: [{ type: "has-keyword", parameters: { all_of: [keyword], ...who } }] })),
        ...(item.states ?? []).map((state) => stateCheck(state, subject)),
      ];
      return checks.length === 1 ? checks[0]! : { operator: "and", operands: checks };
    }),
  };
}

export function wrapAura(leaf: CompileLeaf, body: Node): Node {
  const modifier: Node = { range: closed(leaf, "inches"), effect: body };
  // Version 3: a folded unit-filter (compile-unit-filters.ts) carries the keywords as `filter`.
  const filter = (leaf.parameters.filter ?? {}) as UnitFilter;
  if (filter.other === true) throw new CompileError("An aura reaching only other units has no DSL shape yet.");
  if (leaf.parameters.wholly === true) modifier.wholly = true;
  const keywords = (leaf.parameters.keywords ?? filter.keywords) as string[] | undefined;
  const eligible: Node = {};
  // An aura's eligible list names states a unit is in; it has no negated state or all-of exclusion.
  if (filter.states?.includes("not-battle-shocked")) throw new CompileError("An aura reaching only units that are not Battle-shocked has no DSL eligible field yet.");
  if (filter.excluded_all_keywords?.length) throw new CompileError("An aura excluding only units with every listed keyword has no DSL eligible field yet.");
  if (filter.excluded_abilities?.length) throw new CompileError("An aura excluding units by ability has no DSL eligible field yet.");
  if (filter.abilities?.length) throw new CompileError("An aura reaching units by ability has no DSL eligible field yet.");
  if (filter.alternatives?.length) throw new CompileError("An aura reaching units of alternatives that differ by more than one keyword has no DSL eligible field yet.");
  if (filter.states?.some((state) => state.startsWith("in-"))) throw new CompileError("An aura cannot reach a unit held off the battlefield.");
  if (filter.states?.length) eligible.states = filter.states;
  if (keywords?.length) eligible.required_keywords = keywords;
  if (filter.any_keywords?.length) eligible.any_keywords = filter.any_keywords;
  if (filter.excluded_keywords?.length) eligible.excluded_keywords = filter.excluded_keywords;
  if (Object.keys(eligible).length) modifier.eligible = eligible;
  // Version 2 (batch 7a): the aura's range, extensions included, never exceeds this many inches.
  if (leaf.parameters.range_cap_inches !== undefined) modifier.range_cap = closed(leaf, "range_cap_inches");
  return { type: "aura", target: closed(leaf, "side") === "friendly" ? "friendly-within-aura" : "enemy-within-aura", modifier };
}

/**
 * The DSL's `grant.effect` here is targetless (dispatched to the resolved leader model, not to a
 * unit-ref): a single effect with `target` stripped. A sequence or another container has no
 * place there; the ability needs to grant exactly one effect to the leader.
 */
export function wrapLeaderTarget(leaf: CompileLeaf, body: Node): Node {
  if (typeof body.type !== "string" || "steps" in body || "effect" in body) {
    throw new CompileError("leader-target needs exactly one plain effect to grant to the leader model, not a sequence or another container.");
  }
  const { target: _target, ...granted } = body;
  const keywords = leaf.parameters.leader_keywords as string[] | undefined;
  return {
    type: "leader-model-ability-grant",
    source: "bearer-unit",
    beneficiary: "leading-leader-model",
    ...(keywords?.length ? { leader_filter: { keywords } } : {}),
    attached_unit_filter: null,
    duration: "while-leading",
    grant: { recipient: "beneficiary", effect: granted },
    recipient_binding: "beneficiary-only",
  };
}

export function wrapForEachUnit(leaf: CompileLeaf, body: Node): Node {
  if (leaf.parameters.scope === undefined) throw new CompileError("A bare for-each-unit-select (\"each\") needs a unit-filter right after it, in its fragment.");
  // A bare quantifier's folded unit-filter (compile-unit-filters.ts) narrows the units as select-unit's does.
  const filter = (leaf.parameters.filter ?? {}) as UnitFilter;
  const scope = closed(leaf, "scope");
  // "within 6\" of it", measured to a unit other than the bearer (compile-unit-filters.ts).
  const near = leaf.parameters.near as { of: string; inches: number } | undefined;
  if (near && leaf.parameters.distance === "within") throw new CompileError("A for-each's units are within one range; this one names two.");
  const within: Node | null = near ? { type: "within", parameters: { of: near.of, range: { inches: near.inches } } } : null;
  let eligibility: Node | null;
  if (leaf.parameters.including === "target") {
    // "For the target unit and one D6 for each other enemy unit within 6\" of it": the target, or
    // any unit the rest names. "Other" there is other than the target, which the target branch holds.
    const { other: _other, ...rest } = filter;
    if (leaf.parameters.distance === "within" || leaf.parameters.engaged_with !== undefined) throw new CompileError("A for-each that also takes the target cannot range from the bearer; the range would narrow the target too.");
    if (rest.keywords?.length || rest.excluded_keywords?.length) throw new CompileError("A for-each that also takes the target cannot narrow by keyword; the keywords would narrow the target too.");
    const others = filterEligibility(rest, within);
    if (!others) throw new CompileError("A for-each that also takes the target needs a range or a filter naming the other units.");
    eligibility = { operator: "or", operands: [{ type: "same-unit", parameters: { as: "defender" } }, others] };
  } else eligibility = filterEligibility(filter, within);
  return {
    type: "for-each-unit",
    selector: {
      // A quantifier over "each unit" of either side takes any unit.
      owner: scope === "friendly" ? "friendly" : scope === "any" ? "any" : "enemy",
      ...(filter.keywords?.length ? { keywords: filter.keywords } : {}),
      ...(filter.excluded_keywords?.length ? { excluded_keywords: filter.excluded_keywords } : {}),
      ...(eligibility ? { eligibility } : {}),
      ...(leaf.parameters.distance === "within" ? { within_inches: closed(leaf, "inches") } : {}),
      ...(leaf.parameters.engaged_with !== undefined ? { engagement_relation: "engaged-with-bearer", reference: leaf.parameters.engaged_with === "this-model" ? "bearer" : "bearer-unit" } : {}),
    },
    effect: body,
  };
}

/** The checks a folded unit-filter adds to a selector beyond its all-of and excluded keywords, as one condition. */
function filterEligibility(filter: UnitFilter, extra: Node | null = null): Node | null {
  // In an eligibility filter the default subject is the candidate; ability-unit is the ability's own unit.
  const checks: Node[] = [
    ...(filter.any_keywords?.length ? [{ type: "has-keyword", parameters: { any_of: filter.any_keywords } }] : []),
    ...(filter.alternatives?.length ? [alternativesCheck(filter.alternatives)!] : []),
    ...(filter.states ?? []).map((state) => stateCheck(state)),
    ...(filter.excluded_all_keywords?.length ? [{ operator: "not", operands: [{ type: "has-keyword", parameters: { all_of: filter.excluded_all_keywords } }] }] : []),
    ...abilityChecks(filter.excluded_abilities, filter.abilities),
    ...(filter.other === true ? [{ operator: "not", operands: [{ type: "same-unit", parameters: { as: "ability-unit" } }] }] : []),
    ...(extra ? [extra] : []),
  ];
  return checks.length === 0 ? null : checks.length === 1 ? checks[0]! : { operator: "and", operands: checks };
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
export function selectUnit(selection: CompileLeaf, body: Node, extra: { maxCount?: Node; eligibility?: Node | null } = {}): Node {
  // select-unit v2 with a folded unit-filter (compile-unit-filters.ts): keywords all of which the
  // unit has, or (match any) one of which it has, which only an eligibility condition can say.
  const filter = (selection.parameters.filter ?? {}) as UnitFilter;
  const eligibility = filterEligibility(filter, extra.eligibility ?? null);
  // select-unit v3 counts its own units: exactly that many, or (up to) at most that many.
  const own = selection.parameters.count as number | undefined;
  if (own !== undefined && extra.maxCount) throw new CompileError("A selection that names its own count cannot also take one by battle size.");
  const count = own === undefined ? (extra.maxCount ? { max_count: extra.maxCount } : { count: 1 }) : selection.parameters.up_to === true ? { max_count: own } : { count: own };
  return {
    type: "select-units",
    selector: {
      owner: selection.parameters.scope === "friendly" ? "friendly" : "enemy",
      // "Select one friendly X model": a model, which the effects name as the selected unit.
      ...(selection.parameters.target_kind === "model" ? { target_kind: "model" } : {}),
      // "Select up to 2/3/4 units by battle size" selects a number, not exactly one.
      ...count,
      ...(filter.keywords?.length ? { keywords: filter.keywords } : {}),
      ...(filter.excluded_keywords?.length ? { excluded_keywords: filter.excluded_keywords } : {}),
      ...(eligibility ? { eligibility } : {}),
      ...(selection.parameters.distance === "within" ? { within_inches: selection.parameters.inches } : {}),
      ...(selection.parameters.visible === true ? { visibility_required: true } : {}),
    },
    effect: body,
  };
}

/** The selected unit and the effects on attacks against it, as the DSL's designate-target. */
export function designation(selection: CompileLeaf, leaves: readonly CompileLeaf[], body: Node, lasting: string | undefined, eligibility: Node | null = null): Node {
  if (selection.parameters.target_kind === "model") throw new CompileError("A designated target is a unit; designate-target selects units, not models.");
  if (selection.parameters.filter !== undefined && Object.keys(selection.parameters.filter as object).length) {
    throw new CompileError("A selected unit whose attacks are designated cannot carry unit-filter keywords yet; designate-target's select has no keyword field.");
  }
  if (selection.parameters.count !== undefined) throw new CompileError("A designated target is one unit; a selection of several has no designate-target shape yet.");
  const attack = leaves.find((leaf) => leaf.family_id === "attack" && leaf.start_byte > selection.start_byte) ?? leaves.find((leaf) => leaf.family_id === "attack");
  // "Friendly X units' attacks that target that unit have …": an attack-property scope's frame
  // (compile-weapon-scopes.ts) says whose attacks as well as an attack leaf does.
  const frame = attack ? undefined : leaves.find((leaf) => leaf.start_byte > selection.start_byte && leaf.parameters.weapon_type !== undefined
    && (leaf.family_id === "weapon-ability-grant" || leaf.family_id === "characteristic-modifier") && leaf.parameters.subject !== "attack");
  if (!attack && !frame) throw new CompileError("A selected unit needs an attack leaf saying whose attacks against it are affected.");
  const own = attack ? attack.parameters.unit === "this-model" : frame!.parameters.subject === "this-model";
  return {
    type: "designate-target",
    designation: "selected-unit",
    select: {
      scope: selection.parameters.scope === "friendly" ? "friendly-unit" : "enemy-unit",
      count: 1,
      ...(selection.parameters.distance === "within" ? { within_inches: selection.parameters.inches } : {}),
      ...(selection.parameters.visible === true ? { visibility_required: true } : {}),
      // "Select one enemy unit hit by those attacks": which units can be designated.
      ...(eligibility ? { eligibility } : {}),
    },
    applies: { to: own ? "bearer-attacks-target" : "attackers-of-target", effect: body },
    ...(lasting ? { duration: lasting } : {}),
  };
}
