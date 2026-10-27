import { CompileError, type CompileLeaf, unitOf } from "./compile-fragments.js";
import type { Compiled } from "./compile.js";
import { duration } from "./compile-conditions.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { ordered, placements, shapeSignature } from "./compile-placement.js";
import { exactSpan } from "./contracts.js";
import { NAMED_ABILITY_DEFINITION, NAMED_ABILITY_DEFINITION_END, RESOURCE_BEFORE_ABILITIES } from "./named-ability-state-families.js";

type Node = Record<string, unknown>;
type Compile = (leaves: readonly CompileLeaf[], sourceText?: string) => Compiled;
/** Compiles the host; `oneRule` keeps its sentences one rule rather than independent parts. */
type CompileHost = (leaves: readonly CompileLeaf[], sourceText: string | undefined, oneRule: boolean) => Compiled;
type Definition = { id: string; label: string; leaves: CompileLeaf[] };
type CompiledMechanics = Extract<Compiled, { ok: true }>["mechanics"];
const object = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);

const NAMED_OPERATIONS: Record<string, true> = {
  "named-ability-grant": true,
  "named-ability-suppression": true,
  "named-ability-exchange": true,
};
const contains = (outer: CompileLeaf, inner: CompileLeaf): boolean =>
  outer.end_byte !== undefined && inner.end_byte !== undefined && outer.start_byte <= inner.start_byte && inner.end_byte <= outer.end_byte;

/**
 * Whether every printed duration of the host is the lifetime of the named grant just before it ("your units have
 * Ember until the start of your next Command phase"): the duration's wording follows the grant's with only spacing
 * between. Then the compiled lifetime belongs to the grants, not to the record's other parts (resource income).
 */
function grantsOwnDurations(leaves: readonly CompileLeaf[], sourceText: string | undefined): boolean {
  if (sourceText === undefined) return false;
  const durations = leaves.filter((leaf) => leaf.family_id === "duration");
  const grants = leaves.filter((leaf) => leaf.family_id === "named-ability-grant" && leaf.end_byte !== undefined);
  return durations.length > 0 && durations.every((lifetime) => grants.some((grant) => grant.end_byte! <= lifetime.start_byte
    && /^\s*$/u.test(exactSpan(sourceText, grant.end_byte!, lifetime.start_byte))));
}

/** A rule-wide state window sits between its shared recipient heading and the first state grant. */
function sharedRecipientDuration(leaves: readonly CompileLeaf[]): CompileLeaf | undefined {
  const operations = leaves.filter((leaf) => NAMED_OPERATIONS[leaf.family_id] && leaf.parameters.subject === "antecedent");
  if (!operations.length) return undefined;
  const localFilters = new Set(leaves.filter((filter) => filter.family_id === "unit-filter"
    && operations.some((operation) => contains(operation, filter))));
  const firstOperation = Math.min(...operations.map((operation) => operation.start_byte));
  const headers = leaves.filter((filter) => filter.family_id === "unit-filter" && !localFilters.has(filter)
    && filter.start_byte < firstOperation);
  if (headers.length !== 1) return undefined;
  const candidates = leaves.filter((leaf) => leaf.family_id === "duration" && leaf.start_byte > headers[0]!.start_byte
    && (leaf.end_byte ?? leaf.start_byte) <= firstOperation);
  if (candidates.length > 1) throw new CompileError("A shared named-ability recipient heading has more than one rule-wide duration.");
  return candidates[0];
}

/**
 * Bind the units named by a rule-wide recipient heading, or by wording contained in one operation,
 * to named-state operations only. Resource income in the same record remains army state, not a
 * per-recipient conditional effect.
 */
export function bindNamedAbilityRecipients(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const operations = leaves.filter((leaf) => NAMED_OPERATIONS[leaf.family_id] && leaf.parameters.subject === "antecedent");
  if (!operations.length) return [...leaves];
  const filters = leaves.filter((leaf) => leaf.family_id === "unit-filter");
  const local = new Map<CompileLeaf, CompileLeaf>();
  const claimed = new Set<CompileLeaf>();
  for (const operation of operations) {
    const matches = filters.filter((filter) => contains(operation, filter));
    if (matches.length > 1) throw new CompileError(`Named ability operation at byte ${operation.start_byte} contains more than one recipient filter.`);
    if (matches[0]) {
      local.set(operation, matches[0]);
      claimed.add(matches[0]);
    }
  }
  const unresolved = operations.filter((operation) => !local.has(operation));
  const headers = filters.filter((filter) => !claimed.has(filter) && unresolved.every((operation) => filter.start_byte < operation.start_byte));
  if (unresolved.length && headers.length !== 1) {
    throw new CompileError(`Named ability operations with antecedent recipients need exactly one shared recipient filter; found ${headers.length}.`);
  }
  const header = headers[0];
  const bound = new Map<CompileLeaf, CompileLeaf>();
  for (const operation of operations) {
    const filter = local.get(operation) ?? header!;
    claimed.add(filter);
    bound.set(operation, { ...operation, parameters: {
      ...operation.parameters,
      subject: "filtered-units",
      subject_filter: dslUnitFilter(filter),
    } });
  }
  const owners = new Set<CompileLeaf>();
  for (const owner of leaves.filter((leaf) => leaf.family_id === "unit-owner")) {
    const operation = operations.find((candidate) => contains(candidate, owner));
    const ordering = leaves.find((candidate) => candidate.family_id === RESOURCE_BEFORE_ABILITIES && contains(candidate, owner));
    const usesHeader = header !== undefined && owner.start_byte >= header.start_byte
      && (owner.start_byte < Math.min(...operations.map((candidate) => candidate.start_byte)) || ordering !== undefined);
    const filter = operation ? local.get(operation) ?? header : usesHeader ? header : undefined;
    if (!filter) continue;
    if (owner.parameters.owner !== filter.parameters.side) {
      throw new CompileError(`Named ability recipient ownership at byte ${owner.start_byte} conflicts with its unit-filter.`);
    }
    owners.add(owner);
  }
  const envelope = sharedRecipientDuration(leaves);
  return leaves.flatMap((leaf) => claimed.has(leaf) || owners.has(leaf) || leaf === envelope ? [] : [bound.get(leaf) ?? leaf]);
}

/** One reviewed operation; predicates, costs, timing and named bodies remain independent leaves. */
export function namedAbilityStateEffect(leaf: CompileLeaf): Node | undefined {
  const { family_id: family, parameters: p } = leaf;
  if (!["named-ability-grant", "named-ability-suppression", "named-ability-exchange"].includes(family)) return undefined;
  const target = unitOf(leaf, "subject");
  const ability = { ability_id: p.ability_id, definition_id: p.definition_id };
  if (family === "named-ability-grant") return { type: "ability-grant", target, modifier: { ability } };
  if (family === "named-ability-suppression" && Array.isArray(p.additional_definitions)) {
    return { type: "sequence", steps: [p.definition_id, ...p.additional_definitions].map((definition) => ({
      type: "rule-state", target, modifier: { direction: "suppressed", rule_kind: "ability",
        rule: { ability_id: p.ability_id, definition_id: definition }, except_from: p.except_from },
    })) };
  }
  return { type: "rule-state", target, modifier: {
    direction: family === "named-ability-exchange" ? "exchanged" : "suppressed", rule_kind: "ability", rule: ability,
    ...(family === "named-ability-exchange" ? { exchange_with: { ability_id: p.ability_id, definition_id: p.exchange_with } } : { except_from: p.except_from }),
  } };
}

function splitDefinitions(leaves: readonly CompileLeaf[]): { host: CompileLeaf[]; definitions: Definition[]; pools: string[] } {
  const host: CompileLeaf[] = [];
  const definitions: Definition[] = [];
  const pools: string[] = [];
  const orderings: CompileLeaf[] = [];
  let current: Definition | undefined;
  for (const leaf of ordered(leaves)) {
    if (leaf.family_id === NAMED_ABILITY_DEFINITION) {
      const id = String(leaf.parameters.definition_id);
      if (definitions.some((item) => item.id === id)) throw new CompileError(`Duplicate named ability definition ${id}.`);
      current = { id, label: String(leaf.parameters.label), leaves: [] };
      definitions.push(current);
    } else if (leaf.family_id === NAMED_ABILITY_DEFINITION_END) {
      if (!current) throw new CompileError("A named ability definition-end has no preceding definition.");
      current = undefined;
    } else if (leaf.family_id === RESOURCE_BEFORE_ABILITIES) {
      if (current) throw new CompileError("Resource resolution order belongs to the containing rule, not a named body.");
      const pool = String(leaf.parameters.pool);
      if (pools.includes(pool)) throw new CompileError(`Duplicate resource resolution order for ${pool}.`);
      pools.push(pool);
      orderings.push(leaf);
    } else if (leaf.family_id === "unit-owner" && orderings.some((ordering) => contains(ordering, leaf))) {
      if (leaf.parameters.owner !== "friendly") throw new CompileError("Resource ordering can only absorb the friendly owner of the named ability recipients.");
    } else if (current) current.leaves.push(leaf);
    else host.push(leaf);
  }
  for (const definition of definitions) {
    if (!definition.leaves.some((leaf) => leaf.role === "EFFECT")) throw new CompileError(`Named ability ${definition.id} has no reviewed effect leaves.`);
  }
  return { host, definitions, pools };
}

function has(value: unknown, predicate: (node: Node) => boolean): boolean {
  if (Array.isArray(value)) return value.some((child) => has(child, predicate));
  return object(value) && (predicate(value) || Object.values(value).some((child) => has(child, predicate)));
}

/** Move a common compiled lifetime onto only the named grants that printed it. */
export function localizeNamedAbilityGrantDuration(value: unknown, lifetime: string): { value: unknown; grants: number } {
  if (Array.isArray(value)) {
    const children = value.map((child) => localizeNamedAbilityGrantDuration(child, lifetime));
    return { value: children.map((child) => child.value), grants: children.reduce((total, child) => total + child.grants, 0) };
  }
  if (!object(value)) return { value, grants: 0 };
  const modifier = value.modifier;
  if (value.type === "ability-grant" && object(modifier) && object(modifier.ability) && typeof modifier.ability.definition_id === "string") {
    return { value: { type: "ability-part", duration: lifetime, effect: value }, grants: 1 };
  }
  const children = Object.entries(value).map(([key, child]) => {
    const localized = localizeNamedAbilityGrantDuration(child, lifetime);
    return { key, ...localized };
  });
  return {
    value: Object.fromEntries(children.map((child) => [child.key, child.value])),
    grants: children.reduce((total, child) => total + child.grants, 0),
  };
}

/** Attach each body to its first local grant; references elsewhere never duplicate the declaration. */
function declare(value: unknown, owner: string, definitions: Map<string, Node>, declared: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((child) => declare(child, owner, definitions, declared));
  if (!object(value)) return value;
  const node = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, declare(child, owner, definitions, declared)]));
  const modifier = node.modifier;
  if (node.type !== "ability-grant" || !object(modifier) || !object(modifier.ability) || modifier.ability.ability_id !== owner) return node;
  const id = String(modifier.ability.definition_id);
  const definition = definitions.get(id);
  if (!definition) throw new CompileError(`Local named ability ${id} has no reviewed definition.`);
  if (!declared.has(id)) {
    declared.add(id);
    node.modifier = { ...modifier, definition };
  }
  return node;
}

/** A fixed payment and its exchange are one guarded resolution, never a spend that can overdraw. */
export function guardNamedAbilityPayments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(guardNamedAbilityPayments);
  if (!object(value)) return value;
  const node = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, guardNamedAbilityPayments(child)]));
  if (node.type !== "sequence" || !Array.isArray(node.steps)) return node;
  const exchange = (item: Node) => item.type === "rule-state" && object(item.modifier) && item.modifier.direction === "exchanged";
  if (!node.steps.some((step) => has(step, exchange))) return node;
  const spends = node.steps.filter((step): step is Node => object(step) && step.type === "resource-spend");
  if (!spends.length) return node;
  if (spends.length !== 1) throw new CompileError("A named ability exchange needs one fixed resource payment in its resolution.");
  const modifier = spends[0]!.modifier;
  if (!object(modifier) || typeof modifier.pool !== "string" || !Number.isInteger(modifier.amount) || Number(modifier.amount) <= 0) {
    throw new CompileError("A named ability exchange payment must name a pool and a positive fixed amount.");
  }
  const spendAt = node.steps.indexOf(spends[0]!);
  if (node.steps.slice(0, spendAt).some((step) => has(step, exchange))) throw new CompileError("A named ability exchange must follow its payment.");
  return { type: "conditional", condition: { type: "resource", parameters: { pool: modifier.pool, count: { min: modifier.amount } } }, effect: node };
}

/** Merge matching phase-end parts into one ordered resolution, preserving each trigger's guard. */
export function orderResourceBeforeAbilities(value: unknown, pool: string): unknown {
  let orderedGroup = false;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!object(value)) return value;
    const node = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    if (node.type !== "sequence" || !Array.isArray(node.steps)) return node;
    const income = (part: Node) => has(part.effect, (child) => child.type === "resource-gain" && object(child.modifier) && child.modifier.pool === pool);
    const grants = (part: Node) => has(part.effect, (child) => child.type === "ability-grant" && object(child.modifier) && object(child.modifier.ability) && "definition_id" in child.modifier.ability);
    const candidates = node.steps.filter((step): step is Node => object(step) && step.type === "ability-part" && object(step.trigger) && step.trigger.event === "phase-ended" && (income(step) || grants(step)));
    if (!candidates.some(income) || !candidates.some(grants)) return node;
    if (candidates.some((part) => income(part) && grants(part))) throw new CompileError("Income and ability determination need separate reviewed phase-end parts before ordering.");
    const inner = (part: Node): Node => {
      const trigger = part.trigger as Node;
      if (Object.keys(trigger).some((key) => key !== "event" && key !== "condition")) throw new CompileError("Resource resolution ordering cannot erase a bound phase-end event.");
      const { trigger: _trigger, ...rest } = part;
      return trigger.condition ? { type: "conditional", condition: trigger.condition, effect: rest } : rest;
    };
    const combined = { type: "ability-part", trigger: { event: "phase-ended" }, effect: { type: "sequence", steps: [...candidates.filter(income), ...candidates.filter(grants)].map(inner) } };
    const first = node.steps.indexOf(candidates[0]!);
    orderedGroup = true;
    return { ...node, steps: node.steps.flatMap((step, index) => index === first ? [combined] : candidates.includes(step as Node) ? [] : [step]) };
  };
  const result = visit(value);
  if (!orderedGroup) throw new CompileError(`Resource order for ${pool} found no separate phase-end income and named-ability determination.`);
  return result;
}

function definitionNode(definition: Definition, sourceText: string | undefined, compileBody: Compile): Node {
  const leaves = ordered(definition.leaves);
  const sentenceOf = placements(leaves, sourceText).map((place) => place.sentence);
  const groups: CompileLeaf[][] = [];
  leaves.forEach((leaf, index) => {
    if (index === 0 || sentenceOf[index] !== sentenceOf[index - 1]) groups.push([]);
    groups.at(-1)!.push(leaf);
  });
  const compiled = groups.map((group) => {
    const result = compileBody(group, sourceText);
    if (!result.ok) throw new CompileError(`${definition.id}: ${result.errors.join("; ")}`);
    if (result.core || result.checks.length) throw new CompileError(`Named ability ${definition.id} cannot contain bearer/core restrictions.`);
    return result.mechanics;
  });
  const part = (mechanics: CompiledMechanics): Node => {
    const { effect, trigger, usage, scope, behavior } = mechanics;
    if (!trigger && !usage && scope.duration === "permanent" && behavior !== "activated") return effect;
    return { type: "ability-part", effect,
      ...(trigger ? { trigger } : {}), ...(usage ? { usage } : {}),
      ...(behavior === "activated" && !trigger ? { optional: true } : {}),
      ...(scope.duration !== undefined && scope.duration !== "permanent" ? { duration: scope.duration } : {}),
    };
  };
  if (compiled.length > 1) {
    return { type: "ability-part", name: definition.label, effect: { type: "sequence", steps: compiled.map(part) } };
  }
  const mechanics = compiled[0]!;
  const { effect, trigger, usage, scope, behavior } = mechanics;
  return { type: "ability-part", name: definition.label, effect,
    ...(trigger ? { trigger } : {}), ...(usage ? { usage } : {}),
    ...(behavior === "activated" && !trigger ? { optional: true } : {}),
    ...(scope.duration !== undefined && scope.duration !== "permanent" ? { duration: scope.duration } : {}),
  };
}

/** The wrapper compiles bodies through the ordinary compiler, then compiles the remaining host. */
export function compileNamedAbilityStates(leaves: readonly CompileLeaf[], sourceText: string | undefined, compileHost: CompileHost, compileBody: Compile, abilityId?: string): Compiled {
  if (!leaves.some((leaf) => leaf.family_id.startsWith("named-ability-") || leaf.family_id === RESOURCE_BEFORE_ABILITIES)) return compileHost(leaves, sourceText, false);
  const signature = shapeSignature(ordered(leaves), sourceText);
  try {
    const separated = splitDefinitions(leaves);
    const { definitions, pools } = separated;
    const recipientDuration = sharedRecipientDuration(separated.host);
    const host = bindNamedAbilityRecipients(separated.host);
    const bodies = new Map<string, Node>();
    if (definitions.length && !abilityId) throw new CompileError("Named ability definitions require the containing ability's stable identity.");
    for (const definition of definitions) bodies.set(definition.id, definitionNode(definition, sourceText, compileBody));
    // A resource order ("income is always gained before checking which ability …") ties the income paragraph to the
    // determination: they are one rule, so the host is not split into independent sentence parts, which would give the
    // determination's grants one shared lifetime apart from the income and leave nothing to order.
    const compiled = compileHost(host, sourceText, pools.length > 0);
    if (!compiled.ok) return { ...compiled, signature };
    const compiledDuration = recipientDuration && duration(recipientDuration);
    const rootDuration = compiled.mechanics.scope.duration;
    let effect: unknown = compiled.mechanics.effect;
    const ownLifetimes = !compiledDuration && grantsOwnDurations(host, sourceText);
    if ((compiledDuration || ownLifetimes) && typeof rootDuration === "string" && rootDuration !== "permanent" && rootDuration !== compiledDuration) {
      const localized = localizeNamedAbilityGrantDuration(effect, rootDuration);
      if (!localized.grants) throw new CompileError("A rule-wide named-ability duration has no named grants to qualify.");
      effect = localized.value;
    }
    effect = guardNamedAbilityPayments(effect);
    for (const pool of pools) effect = orderResourceBeforeAbilities(effect, pool);
    if (definitions.length) {
      const declared = new Set<string>();
      effect = declare(effect, abilityId!, bodies, declared);
      for (const id of bodies.keys()) if (!declared.has(id)) throw new CompileError(`Named ability ${id} has no grant to carry its declaration.`);
    }
    const scope = compiledDuration ? { ...compiled.mechanics.scope, duration: compiledDuration }
      : ownLifetimes ? { ...compiled.mechanics.scope, duration: "permanent" } : compiled.mechanics.scope;
    return { ...compiled, signature, mechanics: { ...compiled.mechanics, scope, effect: effect as Node } };
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
}
