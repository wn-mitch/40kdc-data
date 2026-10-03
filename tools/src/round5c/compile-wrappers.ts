import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";

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
type UnitFilter = { keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; other?: boolean };

export function wrapAura(leaf: CompileLeaf, body: Node): Node {
  const modifier: Node = { range: closed(leaf, "inches"), effect: body };
  // Version 3: a folded unit-filter (compile-unit-filters.ts) carries the keywords as `filter`.
  const filter = (leaf.parameters.filter ?? {}) as UnitFilter;
  if (filter.other === true) throw new CompileError("An aura reaching only other units has no DSL shape yet.");
  if (leaf.parameters.wholly === true) modifier.wholly = true;
  const keywords = (leaf.parameters.keywords ?? filter.keywords) as string[] | undefined;
  const eligible: Node = {};
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
  return {
    type: "for-each-unit",
    selector: {
      owner: closed(leaf, "scope") === "friendly" ? "friendly" : "enemy",
      ...(leaf.parameters.distance === "within" ? { within_inches: closed(leaf, "inches") } : {}),
    },
    effect: body,
  };
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
  // In an eligibility filter the default subject is the candidate; ability-unit is the ability's own unit.
  const checks: Node[] = [
    ...(filter.any_keywords?.length ? [{ type: "has-keyword", parameters: { any_of: filter.any_keywords } }] : []),
    ...(filter.states ?? []).map((state) => state === "unengaged"
      ? { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged" } }] }
      : { type: "unit-state", parameters: { state } }),
    ...(filter.other === true ? [{ operator: "not", operands: [{ type: "same-unit", parameters: { as: "ability-unit" } }] }] : []),
    ...(extra.eligibility ? [extra.eligibility] : []),
  ];
  const eligibility = checks.length === 0 ? null : checks.length === 1 ? checks[0]! : { operator: "and", operands: checks };
  // select-unit v3 counts its own units: exactly that many, or (up to) at most that many.
  const own = selection.parameters.count as number | undefined;
  if (own !== undefined && extra.maxCount) throw new CompileError("A selection that names its own count cannot also take one by battle size.");
  const count = own === undefined ? (extra.maxCount ? { max_count: extra.maxCount } : { count: 1 }) : selection.parameters.up_to === true ? { max_count: own } : { count: own };
  return {
    type: "select-units",
    selector: {
      owner: selection.parameters.scope === "friendly" ? "friendly" : "enemy",
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
export function designation(selection: CompileLeaf, leaves: readonly CompileLeaf[], body: Node, lasting: string | undefined): Node {
  if (selection.parameters.filter !== undefined && Object.keys(selection.parameters.filter as object).length) {
    throw new CompileError("A selected unit whose attacks are designated cannot carry unit-filter keywords yet; designate-target's select has no keyword field.");
  }
  if (selection.parameters.count !== undefined) throw new CompileError("A designated target is one unit; a selection of several has no designate-target shape yet.");
  const attack = leaves.find((leaf) => leaf.family_id === "attack" && leaf.start_byte > selection.start_byte) ?? leaves.find((leaf) => leaf.family_id === "attack");
  if (!attack) throw new CompileError("A selected unit needs an attack leaf saying whose attacks against it are affected.");
  const own = attack.parameters.unit === "this-model";
  return {
    type: "designate-target",
    designation: "selected-unit",
    select: {
      scope: selection.parameters.scope === "friendly" ? "friendly-unit" : "enemy-unit",
      count: 1,
      ...(selection.parameters.distance === "within" ? { within_inches: selection.parameters.inches } : {}),
      ...(selection.parameters.visible === true ? { visibility_required: true } : {}),
    },
    applies: { to: own ? "bearer-attacks-target" : "attackers-of-target", effect: body },
    ...(lasting ? { duration: lasting } : {}),
  };
}
