import type { CutoverContext, Node } from "./vocab-cutover-types.js";

const UNIT_FILTER_KEYS: Record<string, true> = {
  owner: true, keywords: true, keyword_match: true, all_of: true, any_of: true, none_of: true, not_all_of: true, any_of_filters: true,
  target_kind: true, model_names: true, model_keyword: true, excluded_keywords: true, exclude_keywords: true, excludes_keyword: true,
  member_of: true, requires_ability: true, has_ability: true, lacks_ability: true, within_inches: true, range_inches: true, range: true,
  reference: true, origin: true, within_inches_from: true, within_objective: true, visible_to: true, visibility_required: true, engagement_relation: true,
  engaged_with: true, not_engaged_with: true, excluding: true, designated: true, designated_by: true, not_designated: true,
  embarked_in: true, allowance: true, selection_limit: true, limit: true, count: true, min_count: true, max_count: true, count_min: true, count_max: true, at_least: true, at_most: true,
};

const SELECTOR_KEYS: Record<string, true> = {
  ...UNIT_FILTER_KEYS,
  filter: true, eligibility: true, bind_as: true, timing: true, scope: true, kind: true, selector: true, selection_policy: true, select_policy: true, selection_mode: true,
};

const SELECTOR_FILTER_EXCLUSIONS: Record<string, true> = {
  type: true, filter: true, count: true, min_count: true, max_count: true, count_min: true, count_max: true, at_least: true, at_most: true,
  selection_limit: true, allowance: true, limit: true, bind_as: true, eligibility: true, timing: true, selection_mode: true,
};
const FILTER_SIGNAL_KEYS: Record<string, true> = {
  owner: true, keywords: true, keyword_match: true, all_of: true, any_of: true, none_of: true, not_all_of: true,
  any_of_filters: true, target_kind: true, model_names: true, model_keyword: true, excluded_keywords: true,
  exclude_keywords: true, excludes_keyword: true, member_of: true, requires_ability: true, has_ability: true,
  lacks_ability: true, visible_to: true, visibility_required: true, engagement_relation: true, engaged_with: true,
  not_engaged_with: true, excluding: true, designated: true, designated_by: true, not_designated: true,
  embarked_in: true, reference: true, within_inches_from: true, within_objective: true,
};
const COMPARISON_ALIASES: Record<string, string> = {
  "greater-than": "gt",
  "greater-or-equal": "gte",
  "less-than": "lt",
  "less-or-equal": "lte",
  "at-least": "gte",
  "at-most": "lte",
  equal: "eq",
  "equal-to": "eq",
};
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);
const asNode = (value: unknown): Node | undefined => isNode(value) ? value : undefined;
const isPrimitiveQuantity = (value: unknown): value is number | string => typeof value === "number" || typeof value === "string";

function report(ctx: CutoverContext, reason: string, node: unknown): void {
  ctx.report(reason, node, ctx.pointer);
}

function without(input: Node, keys: Readonly<Record<string, true>>): Node {
  const out: Node = {};
  for (const [key, value] of Object.entries(input)) if (!Object.hasOwn(keys, key)) out[key] = value;
  return out;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function put(out: Node, key: string, value: unknown, source: string, input: Node, ctx: CutoverContext): boolean {
  if (out[key] !== undefined && !same(out[key], value)) {
    report(ctx, `ambiguous ${source}: ${key} disagrees with its canonical value`, input);
    return false;
  }
  out[key] = value;
  return true;
}

/** Map the legacy built-in selector origin to the common unit-ref spelling. */
export function selectorOrigin(value: unknown, ctx: CutoverContext, node: unknown): unknown | undefined {
  if (value === undefined) return "this-model";
  if (value === "bearer") return "this-model";
  if (value === "bearer-unit") return "this-unit";
  if (value === "target") {
    report(ctx, "selector origin target is ambiguous without an explicit bound reference", node);
    return undefined;
  }
  if (value === "unit") return "this-unit";
  if (typeof value === "string" || isNode(value)) return value;
  report(ctx, `invalid selector origin ${String(value)}`, node);
  return undefined;
}

function quantityBounds(value: unknown, ctx: CutoverContext, node: unknown): Node | undefined {
  if (isNode(value)) {
    const out = { ...value };
    if (Object.keys(out).some((key) => key !== "min" && key !== "max")) {
      report(ctx, "count bounds contain unknown properties", node);
      return undefined;
    }
    if (out.min === undefined && out.max === undefined) {
      report(ctx, "count bounds need min or max", node);
      return undefined;
    }
    return out;
  }
  if (!isPrimitiveQuantity(value)) {
    report(ctx, "cardinality is not a quantity", node);
    return undefined;
  }
  return { min: value, max: value };
}

/** Normalize a legacy exact/up-to/count-min/count-max cardinality to count-bounds. */
export function transformCountBounds(node: Node, ctx: CutoverContext): Node {
  const out = { ...node };
  const has = (key: string): boolean => Object.hasOwn(node, key);
  const exact = node.count;
  const min = node.min_count ?? node.count_min ?? node.at_least;
  const max = node.max_count ?? node.count_max ?? node.at_most;
  const minKeys = ["min_count", "count_min", "at_least"].filter((key) => has(key));
  const maxKeys = ["max_count", "count_max", "at_most"].filter((key) => has(key));
  if (minKeys.length > 1 && minKeys.slice(1).some((key) => !same(node[key], node[minKeys[0]!]))) report(ctx, "minimum cardinality aliases disagree", node);
  if (maxKeys.length > 1 && maxKeys.slice(1).some((key) => !same(node[key], node[maxKeys[0]!]))) report(ctx, "maximum cardinality aliases disagree", node);
  const hasMin = minKeys.length > 0;
  const hasMax = maxKeys.length > 0;
  const aliasesConflict = (minKeys.length > 1 && minKeys.slice(1).some((key) => !same(node[key], node[minKeys[0]!]))
    || maxKeys.length > 1 && maxKeys.slice(1).some((key) => !same(node[key], node[maxKeys[0]!])));
  if (aliasesConflict) return out;

  if (has("count") && (hasMin || hasMax)) {
    report(ctx, "count conflicts with count_min/count_max", node);
  } else if (has("count")) {
    const bounds = quantityBounds(exact, ctx, node);
    if (bounds !== undefined) {
      out.count = bounds;
      delete out.min_count;
      delete out.max_count;
      delete out.count_min;
      delete out.count_max;
      delete out.at_least;
      delete out.at_most;
    }
  } else if (hasMin || hasMax) {
    const bounds: Node = {};
    if (hasMin) bounds.min = min;
    else bounds.min = 0;
    if (hasMax) bounds.max = max;
    if (quantityBounds(bounds, ctx, node) !== undefined) {
      out.count = bounds;
      delete out.min_count;
      delete out.max_count;
      delete out.count_min;
      delete out.count_max;
      delete out.at_least;
      delete out.at_most;
    }
  }
  return out;
}

function mapRange(value: unknown, ctx: CutoverContext, node: unknown): unknown | undefined {
  if (isNode(value)) return { ...value };
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return { inches: value };
  if (typeof value === "string") return value;
  report(ctx, `invalid range ${String(value)}`, node);
  return undefined;
}

function transformWeaponScope(node: Node, ctx: CutoverContext): Node {
  const hasName = Object.hasOwn(node, "weapon_name");
  const hasKeyword = Object.hasOwn(node, "weapon_keyword");
  if (!hasName && !hasKeyword) return { ...node };
  const out = { ...node };
  const legacy: Node = {};
  if (hasName) {
    if (typeof node.weapon_name !== "string") {
      report(ctx, "weapon_name is not a string", node);
      return out;
    }
    legacy.name = node.weapon_name;
  }
  if (hasKeyword) {
    if (typeof node.weapon_keyword !== "string") {
      report(ctx, "weapon_keyword is not a string", node);
      return out;
    }
    legacy.keyword = { keyword_id: node.weapon_keyword };
  }
  if (isNode(node.weapons)) {
    for (const key of Object.keys(legacy)) {
      if (node.weapons[key] !== undefined && !same(node.weapons[key], legacy[key])) {
        report(ctx, `weapon scope ${key} conflicts with legacy selector`, node);
        return out;
      }
    }
    out.weapons = { ...node.weapons, ...legacy };
  } else if (node.weapons !== undefined) {
    report(ctx, "weapons scope is not an object", node);
    return out;
  } else out.weapons = legacy;
  delete out.weapon_name;
  delete out.weapon_keyword;
  return out;
}

function mapMemberOf(value: unknown, ctx: CutoverContext, node: unknown): unknown | undefined {
  if (value === "bearer-unit") return "this-unit";
  if (value === "embarked-in-bearer") return "bearer-transport";
  if (value === "target") { report(ctx, "member_of target needs an explicit enclosing binding", node); return undefined; }
  if (typeof value === "string" || isNode(value)) return value;
  report(ctx, `invalid member_of reference ${String(value)}`, node);
  return undefined;
}

function mapKeywordList(value: unknown, ctx: CutoverContext, node: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    report(ctx, "keyword predicate is not a string array", node);
    return undefined;
  }
  return [...value];
}

function mapWithin(out: Node, input: Node, ctx: CutoverContext): void {
  const hasLegacyRange = Object.hasOwn(input, "within_inches") || Object.hasOwn(input, "range_inches");
  if (isNode(input.within)) {
    const within = { ...input.within };
    if (isNode(within.of) && isLikelyUnitFilter(within.of)) within.of = transformUnitFilter(within.of, ctx);
    out.within = within;
  }
  const a = input.within_inches;
  const b = input.range_inches;
  if (a !== undefined && b !== undefined && !same(a, b)) {
    report(ctx, "within_inches and range_inches disagree", input);
    return;
  }
  const rawRange = a ?? b;
  const range = hasLegacyRange ? mapRange(rawRange, ctx, input) : undefined;
  let origin: unknown = undefined;
  if (Object.hasOwn(input, "within_objective")) {
    const marker = input.within_objective;
    origin = isNode(marker) && marker.selection_var !== undefined ? { objective: { selection_var: marker.selection_var } } : { objective: marker };
  } else if (Object.hasOwn(input, "within_inches_from")) origin = input.within_inches_from;
  else if (Object.hasOwn(input, "origin")) origin = input.origin;
  else if (Object.hasOwn(input, "reference")) origin = selectorOrigin(input.reference, ctx, input);
  else if (hasLegacyRange) origin = selectorOrigin(undefined, ctx, input);
  const explicitOriginKeys = ["within_objective", "within_inches_from", "origin", "reference"].filter((key) => Object.hasOwn(input, key));
  if (explicitOriginKeys.length > 1) report(ctx, `range origin has multiple explicit sources: ${explicitOriginKeys.join(", ")}`, input);
  if (range !== undefined) {
    const within: Node = { range };
    if (origin !== undefined) within.of = origin;
    if (input.wholly === true) within.wholly = true;
    put(out, "within", within, "range", input, ctx);
    delete out.within_inches;
    delete out.range_inches;
    delete out.within_inches_from;
    delete out.within_objective;
    delete out.origin;
    delete out.reference;
  } else if (Object.hasOwn(input, "reference") && input.engagement_relation === undefined) {
    // `reference` has no meaning without a range or engagement relation; retain it for diagnosis.
    report(ctx, "selector reference has no range or engagement relation", input);
  }
}

function transformAnyOfFilters(value: unknown, ctx: CutoverContext): unknown {
  if (!Array.isArray(value) || value.length < 2 || !value.every(isNode)) {
    report(ctx, "any_of_filters is not an array of at least two filters", value);
    return value;
  }
  return value.map((item) => transformUnitFilter(item, ctx));
}

/** Normalize a unit-filter, including selectors' former flattened filter fields. */
export function transformUnitFilter(node: Node, ctx: CutoverContext): Node {
  const out = normalizeSharedScalars(node, ctx);
  const list = (key: string): string[] | undefined => mapKeywordList(node[key], ctx, node);
  if (Object.hasOwn(node, "keywords")) {
    const values = list("keywords");
    if (values !== undefined) {
      const destination = node.keyword_match === "any" ? "any_of" : "all_of";
      if (put(out, destination, values, "keywords", node, ctx)) delete out.keywords;
    }
  }
  for (const [legacy, canonical] of [["excluded_keywords", "none_of"], ["exclude_keywords", "none_of"], ["excludes_keyword", "none_of"]] as const) {
    if (!Object.hasOwn(node, legacy)) continue;
    const values = Array.isArray(node[legacy]) ? list(legacy) : typeof node[legacy] === "string" ? [node[legacy]] : undefined;
    if (values === undefined) {
      report(ctx, `${legacy} is not a keyword list`, node);
      continue;
    }
    if (put(out, canonical, values, legacy, node, ctx)) delete out[legacy];
  }
  if (Object.hasOwn(node, "keyword_match")) {
    if (node.keyword_match === "all" || node.keyword_match === "any") delete out.keyword_match;
    else report(ctx, `invalid keyword_match ${String(node.keyword_match)}`, node);
  }
  if (Object.hasOwn(node, "target_kind")) {
    if (node.target_kind === "unit" || node.target_kind === "model") {
      if (put(out, "level", node.target_kind, "target_kind", node, ctx)) delete out.target_kind;
    } else report(ctx, `invalid target_kind ${String(node.target_kind)}`, node);
  }
  if (Object.hasOwn(node, "model_keyword")) {
    const values = typeof node.model_keyword === "string" ? [node.model_keyword] : mapKeywordList(node.model_keyword, ctx, node);
    if (values !== undefined && put(out, "all_of", values, "model_keyword", node, ctx)) delete out.model_keyword;
  }
  if (Object.hasOwn(node, "requires_ability")) {
    const values = typeof node.requires_ability === "string" ? [node.requires_ability] : Array.isArray(node.requires_ability) ? node.requires_ability : undefined;
    if (values !== undefined && values.every((item) => typeof item === "string") && put(out, "has_ability", [...values], "requires_ability", node, ctx)) delete out.requires_ability;
    else report(ctx, "requires_ability is not an ability id or list", node);
  }
  if (Object.hasOwn(node, "member_of")) {
    const value = mapMemberOf(node.member_of, ctx, node);
    if (value !== undefined) out.member_of = value;
  }
  if (Object.hasOwn(node, "any_of_filters")) out.any_of_filters = transformAnyOfFilters(node.any_of_filters, ctx);
  mapWithin(out, node, ctx);
  if (node.visible === true) {
    out.visible = { to: "this-model" };
  } else if (node.visible === false) {
    delete out.visible;
  } else if (Object.hasOwn(node, "visible_to")) {
    const to = selectorOrigin(node.visible_to, ctx, node);
    if (to !== undefined && put(out, "visible", { to }, "visible_to", node, ctx)) delete out.visible_to;
  } else if (node.visibility_required === true) {
    const to = selectorOrigin(node.reference, ctx, node);
    if (to !== undefined && put(out, "visible", { to }, "visibility_required", node, ctx)) delete out.visibility_required;
  } else if (node.visibility_required === false) delete out.visibility_required;
  if (Object.hasOwn(node, "engagement_relation")) {
    const relation = node.engagement_relation;
    if (relation === "any") delete out.engagement_relation;
    else if (relation === "engaged-with-bearer" || relation === "not-engaged-with-bearer") {
      const ref = selectorOrigin(node.reference, ctx, node);
      const key = relation === "engaged-with-bearer" ? "engaged_with" : "not_engaged_with";
      if (ref !== undefined && put(out, key, ref, "engagement_relation", node, ctx)) {
        delete out.engagement_relation;
        delete out.reference;
      }
    } else report(ctx, `invalid engagement_relation ${String(relation)}`, node);
  }
  const withRange = out.within;
  if (isNode(withRange) && Object.hasOwn(withRange, "of") && withRange.of === undefined) delete withRange.of;
  if (Object.hasOwn(node, "reference") && out.within === undefined && out.engaged_with === undefined && out.not_engaged_with === undefined && out.visible === undefined) {
    report(ctx, "selector reference has no canonical relationship to attach", node);
  }
  return out;
}

function selectorFilter(input: Node, ctx: CutoverContext): Node {
  const nested = asNode(input.filter);
  const base = nested === undefined ? {} : transformUnitFilter(nested, ctx);
  const predicates = Object.fromEntries(Object.entries(input).filter(([key]) => Object.hasOwn(UNIT_FILTER_KEYS, key) && !Object.hasOwn(SELECTOR_FILTER_EXCLUSIONS, key)));
  const flattened = transformUnitFilter(predicates, ctx);
  const merged: Node = { ...base };
  for (const [key, value] of Object.entries(flattened)) {
    if (merged[key] !== undefined && !same(merged[key], value)) {
      report(ctx, `selector filter has conflicting ${key} predicates`, input);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function objectiveFilter(input: Node, ctx: CutoverContext): Node {
  const out: Node = {};
  const keys: Record<string, true> = {
    role: true,
    home_of: true,
    territory: true,
    controlled_by: true,
    designated: true,
    name: true,
    selection_var: true,
  };
  const selectorOnly: Record<string, true> = {
    scope: true,
    timing: true,
    kind: true,
    selector: true,
    filter: true,
    count: true,
    min_count: true,
    max_count: true,
    count_min: true,
    count_max: true,
    at_least: true,
    at_most: true,
    selection_limit: true,
    allowance: true,
    limit: true,
    bind_as: true,
    eligibility: true,
  };
  for (const [key, value] of Object.entries(input)) {
    if (key === "owner") {
      if (value === "friendly" || value === "your-army" || value === "owner-army") out.controlled_by = "friendly";
      else if (value === "enemy" || value === "opponent" || value === "opponent-army") out.controlled_by = "enemy";
      else if (value === "any") out.controlled_by = value;
      else report(ctx, `invalid objective owner ${String(value)}`, input);
    } else if (Object.hasOwn(keys, key)) out[key] = value;
    else if (!Object.hasOwn(selectorOnly, key)) out[key] = value;
  }
  return out;
}

function cardinalitySelector(input: Node, ctx: CutoverContext): Node {
  const filter = selectorFilter(input, ctx);
  const out: Node = { filter };
  const counted = transformCountBounds(input, ctx);
  if (counted.count !== undefined) out.count = counted.count;
  if (isNode(input.limit)) out.limit = { ...input.limit };
  else if (isNode(input.selection_limit)) out.limit = { ...input.selection_limit };
  else if (isNode(input.allowance)) out.limit = { ...input.allowance };
  if (input.bind_as !== undefined) out.bind_as = input.bind_as;
  if (input.eligibility !== undefined) out.eligibility = input.eligibility;
  if (input.selection_mode !== undefined) out.selection_mode = input.selection_mode;
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(SELECTOR_KEYS, key) && key !== "count" && key !== "min_count" && key !== "max_count" && key !== "count_min" && key !== "count_max" && key !== "selection_limit" && key !== "allowance" && key !== "limit" && key !== "bind_as" && key !== "eligibility") out[key] = value;
  }
  return out;
}

function transformSelect(input: Node, ctx: CutoverContext): Node {
  const existing = asNode(input.selector);
  let kind = input.kind;
  const scope = input.scope;
  if (kind === undefined && typeof scope === "string") {
    if (scope === "enemy-unit" || scope === "friendly-unit" || scope === "unit" || scope === "model") kind = "unit";
    else if (scope === "objective" || scope === "objectives" || scope === "objective-marker") kind = "objective";
    else report(ctx, `cannot determine selection kind from scope ${scope}`, input);
  }
  if (kind !== "unit" && kind !== "objective") {
    report(ctx, "selection needs an explicit unit/objective discriminator", input);
    return { ...input };
  }
  const source = existing ?? input;
  const withScope: Node = { ...source };
  if (kind === "unit" && scope === "model") withScope.target_kind = "model";
  if (kind === "unit" && scope === "unit") withScope.target_kind = "unit";
  if (kind === "unit" && typeof scope === "string" && scope.startsWith("friendly")) withScope.owner = "friendly";
  if (kind === "unit" && typeof scope === "string" && scope.startsWith("enemy")) withScope.owner = "enemy";
  const selector = kind === "unit" ? cardinalitySelector(withScope, ctx) : objectiveSelector(withScope, ctx);
  const out: Node = { ...input, kind };
  for (const key of Object.keys(SELECTOR_KEYS)) if (key !== "timing") delete out[key];
  out.kind = kind;
  out.selector = selector;
  // `timing` belongs to the timing migration, not selector canonicalization. Keep it visible for that pass.
  if (input.timing !== undefined) out.timing = input.timing;
  return out;
}

function objectiveSelector(input: Node, ctx: CutoverContext): Node {
  const out: Node = { filter: objectiveFilter(input, ctx) };
  const counted = transformCountBounds(input, ctx);
  if (counted.count !== undefined) out.count = counted.count;
  if (isNode(input.limit)) out.limit = { ...input.limit };
  else if (isNode(input.selection_limit)) out.limit = { ...input.selection_limit };
  else if (isNode(input.allowance)) out.limit = { ...input.allowance };
  if (input.bind_as !== undefined) out.bind_as = input.bind_as;
  if (input.eligibility !== undefined) out.eligibility = input.eligibility;
  return out;
}

function staticKeywords(value: unknown, ctx: CutoverContext, node: unknown): Node | null {
  if (value === null) return null;
  if (Array.isArray(value)) {
    const values = mapKeywordList(value, ctx, node);
    return values === undefined ? null : { all_of: values };
  }
  const input = asNode(value);
  if (input === undefined) {
    report(ctx, "static keyword predicate is not an object", node);
    return null;
  }
  const out: Node = { ...input };
  const required = input.required_keywords ?? input.keywords;
  const excluded = input.excluded_keywords ?? input.exclude_keywords;
  const any = input.any_keywords ?? input.any_of;
  if (required !== undefined) {
    const values = mapKeywordList(required, ctx, input);
    if (values !== undefined && put(out, "all_of", values, "required_keywords", input, ctx)) {
      delete out.required_keywords;
      delete out.keywords;
    }
  }
  if (any !== undefined) {
    const values = mapKeywordList(any, ctx, input);
    if (values !== undefined && put(out, "any_of", values, "any_keywords", input, ctx)) {
      delete out.any_keywords;
      delete out.any_of;
      out.any_of = values;
    }
  }
  if (excluded !== undefined) {
    const values = mapKeywordList(excluded, ctx, input);
    if (values !== undefined && put(out, "none_of", values, "excluded_keywords", input, ctx)) {
      delete out.excluded_keywords;
      delete out.exclude_keywords;
    }
  }
  return out;
}

/** Normalize the static roster-side applies_to predicate without deriving it from runtime effects. */
export function transformAppliesTo(value: unknown, ctx: CutoverContext): unknown {
  return staticKeywords(value, ctx, value);
}
function normalizeSharedScalars(node: Node, ctx: CutoverContext): Node {
  const out = { ...node };
  if (typeof out.comparison === "string" && COMPARISON_ALIASES[out.comparison] !== undefined) out.comparison = COMPARISON_ALIASES[out.comparison];
  if (typeof out.comparison === "string" && !Object.hasOwn(COMPARISON_ALIASES, out.comparison) && ["gt", "gte", "lt", "lte", "eq"].indexOf(out.comparison) < 0) report(ctx, `invalid comparison ${out.comparison}`, node);
  for (const key of ["owner", "controlled_by"]) {
    const value = out[key];
    if (value === "opponent" || value === "opponent-army") out[key] = "enemy";
    else if (value === "your-army" || value === "owner-army") out[key] = "friendly";
  }
  if (out.period === "round") out.period = "battle-round";
  if (out.window === "round") out.window = "battle-round";
  if (out.round === "round") out.round = "battle-round";
  const distance = out.range_inches ?? out.within_inches;
  if (distance !== undefined && out.of !== undefined && !isLikelyUnitFilter(out)) {
    const range = mapRange(distance, ctx, node);
    if (range !== undefined) {
      out.range = range;
      delete out.range_inches;
      delete out.within_inches;
    }
  }
  return out;
}

function conditionResult(parameters: Node, filter: Node): Node {
  const out: Node = { type: "matches", parameters: { filter } };
  if (parameters.subject !== undefined) (out.parameters as Node).subject = parameters.subject;
  return out;
}

/** Normalize ordinary unit predicates while retaining atoms with genuinely different semantics. */
export function transformCondition(node: Node, ctx: CutoverContext): Node {
  const type = node.type;
  let rawParameters = asNode(node.parameters);
  if (typeof type !== "string" || rawParameters === undefined) return { ...node };
  if (["count_min", "count_max", "at_least", "at_most"].some((key) => Object.hasOwn(rawParameters!, key))) {
    rawParameters = transformCountBounds(rawParameters, ctx);
    node = { ...node, parameters: rawParameters };
  }
  if (type === "operation-markers" && (rawParameters.side === "opponent" || rawParameters.side === "your-army")) {
    rawParameters = { ...rawParameters, side: rawParameters.side === "opponent" ? "enemy" : "friendly" };
    node = { ...node, parameters: rawParameters };
  }
  if ((type === "named-weapon" || type === "unit-wargear") && isNode(rawParameters.models)) {
    return { ...node, parameters: { ...rawParameters, models: transformCountBounds(rawParameters.models, ctx) } };
  }
  if (type === "equipped-weapon-count") {
    const parameters = transformCountBounds(rawParameters, ctx);
    const weapons = isNode(parameters.weapons) ? { ...parameters.weapons } : {};
    if (parameters.weapon_type !== undefined) {
      weapons.type = parameters.weapon_type;
      delete parameters.weapon_type;
    }
    if (parameters.other_than !== undefined) {
      weapons.exclude_name = parameters.other_than;
      delete parameters.other_than;
    }
    return { ...node, parameters: { ...parameters, weapons } };
  }
  if (type === "controls" && rawParameters.compare === "more-than-opponent") return { ...node, parameters: { ...rawParameters, compare: { owner: "enemy", comparison: "gt" } } };
  if (type === "operation-markers" && rawParameters.within_range_of === "opponent-home-objective") {
    const { within_range_of: _within, ...parameters } = rawParameters;
    return { ...node, parameters: { ...parameters, within: { of: { objective: { home_of: "enemy" } }, range: "objective-control" } } };
  }
  if (type === "attack-is") return { ...node, parameters: transformWeaponScope(rawParameters, ctx) };
  if (type === "happened" || type === "happened-compare") {
    const parameters = { ...rawParameters };
    if (typeof parameters.window === "string" && parameters.window === "round") parameters.window = "battle-round";
    if (type === "happened-compare") {
      if (typeof parameters.comparison === "string" && COMPARISON_ALIASES[parameters.comparison] !== undefined) parameters.comparison = COMPARISON_ALIASES[parameters.comparison];
      for (const side of ["left", "right"]) {
        const event = asNode(parameters[side]);
        if (event !== undefined && event.window === "round") parameters[side] = { ...event, window: "battle-round" };
      }
    }
    return { ...node, parameters };
  }
  if (type === "matches") {
    if (isNode(rawParameters.filter)) return { ...node, parameters: { ...rawParameters, filter: transformUnitFilter(rawParameters.filter, ctx) } };
    return { ...node };
  }
  if (["has-keyword", "owned-by", "has-ability", "unit-state", "within", "visible", "designated"].indexOf(type) < 0) return { ...node };
  const parameters = normalizeSharedScalars(rawParameters, ctx);
  if (type === "has-keyword") {
    if (parameters.chosen_by !== undefined) return { ...node };
    const allowed: Record<string, true> = { subject: true, all_of: true, any_of: true, none_of: true, not_all_of: true, keyword: true };
    if (Object.keys(parameters).some((key) => !Object.hasOwn(allowed, key))) return { ...node };
    const filter: Node = {};
    if (parameters.keyword !== undefined) {
      if (parameters.all_of !== undefined || parameters.any_of !== undefined) return { ...node };
      filter.all_of = [parameters.keyword];
    }
    for (const key of ["all_of", "any_of", "none_of", "not_all_of"]) if (parameters[key] !== undefined) filter[key] = parameters[key];
    if (!Object.keys(filter).length) return { ...node };
    return conditionResult(parameters, filter);
  }
  if (type === "owned-by") {
    if (Object.keys(parameters).some((key) => key !== "subject" && key !== "owner")) return { ...node };
    if (parameters.owner === undefined) return { ...node };
    return conditionResult(parameters, { owner: parameters.owner });
  }
  if (type === "has-ability") {
    if (Object.keys(parameters).some((key) => key !== "subject" && key !== "ability" && key !== "abilities")) return { ...node };
    if (parameters.abilities !== undefined && parameters.ability !== undefined) return { ...node };
    const values = parameters.abilities ?? (parameters.ability === undefined ? undefined : [parameters.ability]);
    if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) return { ...node };
    return conditionResult(parameters, { has_ability: [...values] });
  }
  if (type === "unit-state") {
    if (parameters.at !== undefined || parameters.with !== undefined) return { ...node };
    if (Object.keys(parameters).some((key) => key !== "subject" && key !== "state")) return { ...node };
    if (parameters.state === "unengaged") return conditionResult(parameters, { not_states: ["engaged"] });
    if (parameters.state === undefined) return { ...node };
    return conditionResult(parameters, { state: parameters.state });
  }
  if (type === "within") {
    if (parameters.at !== undefined || parameters.models !== undefined || parameters.count !== undefined) return { ...node };
    if (parameters.of === undefined || parameters.range === undefined) return { ...node };
    const allowed: Record<string, true> = { subject: true, of: true, range: true, wholly: true };
    if (Object.keys(parameters).some((key) => !Object.hasOwn(allowed, key))) return { ...node };
    const normalizedRange = isNode(parameters.range) ? parameters.range : mapRange(parameters.range, ctx, parameters);
    if (normalizedRange === undefined) return { ...node };
    const origin = isNode(parameters.of) && parameters.of.visible === true
      ? { ...parameters.of, visible: { to: parameters.subject ?? "this-unit" } } : parameters.of;
    const within: Node = { range: normalizedRange, of: origin };
    if (parameters.wholly === true) within.wholly = true;
    return conditionResult(parameters, { within });
  }
  if (type === "visible") {
    if (parameters.fully === true || parameters.blocked_by !== undefined) return { ...node };
    if (Object.keys(parameters).some((key) => key !== "subject" && key !== "to")) return { ...node };
    return conditionResult(parameters, { visible: { to: parameters.to ?? "attacker" } });
  }
  if (type === "designated") {
    if (parameters.count !== undefined || isNode(parameters.subject)) return { ...node };
    if (Object.keys(parameters).some((key) => key !== "subject" && key !== "tag" && key !== "by")) return { ...node };
    if (parameters.tag === undefined) return { ...node };
    const filter: Node = { designated: parameters.tag };
    if (parameters.by !== undefined) filter.designated_by = parameters.by;
    return conditionResult(parameters, filter);
  }
  return { ...node };
}

/** The walker may annotate the slot owning an object; unknown objects are never guessed as filters. */
type TraversalContext = CutoverContext & { parentKey?: string; parentType?: string };

function slot(ctx: CutoverContext): { parentKey?: string; parentType?: string } {
  const annotated = ctx as TraversalContext;
  return { parentKey: annotated.parentKey, parentType: annotated.parentType };
}

function shouldTransformFilter(node: Node, ctx: CutoverContext): boolean {
  const { parentKey, parentType } = slot(ctx);
  if (parentKey === "filter" || parentKey === "target" || parentKey === "attacker_filter" || parentKey === "attacker_unit_filter") return isLikelyUnitFilter(node);
  if (parentKey === "of" && parentType === "within") return isLikelyUnitFilter(node);
  return false;
}

/** Transform one node; traversal and child recursion belong to the migration orchestrator. */
export function transformFilters(node: Node, ctx: CutoverContext): Node {
  let out: Node = { ...node };
  const type = out.type;
  if (type === "select-units" || type === "for-each-unit") {
    const selector = asNode(out.selector);
    if (selector !== undefined) out.selector = cardinalitySelector(selector, ctx);
  } else if (type === "paired-unit-selector") {
    out = cardinalitySelector(without(out, { type: true }), ctx);
  } else if (isNode(out.paired_selector)) {
    out.paired_selector = cardinalitySelector(out.paired_selector, ctx);
  }
  if (type === "designate-target" || type === "persistent-designation") {
    if (type === "persistent-designation" && isNode(out.select)) {
      const select = { ...out.select };
      for (const key of ["selection_policy", "allow_while_embarked"]) {
        if (select[key] !== undefined && put(out, key, select[key], key, node, ctx)) delete select[key];
      }
      out.select = select;
    }
    if (isNode(out.select)) out.select = transformSelect(out.select, ctx);
    if (isNode(out.applies)) {
      const applies = { ...out.applies };
      if (Array.isArray(applies.attacker_keywords)) {
        const attackerFilter = transformUnitFilter({ level: "model", all_of: applies.attacker_keywords }, ctx);
        if (put(applies, "attacker_filter", attackerFilter, "attacker_keywords", applies, ctx)) delete applies.attacker_keywords;
      }
      if (Array.isArray(applies.attacker_unit_keywords)) {
        const attackerUnitFilter = transformUnitFilter({ all_of: applies.attacker_unit_keywords }, ctx);
        if (put(applies, "attacker_unit_filter", attackerUnitFilter, "attacker_unit_keywords", applies, ctx)) delete applies.attacker_unit_keywords;
      }
      out.applies = applies;
    }
    if (type === "persistent-designation" && isNode(out.consumer) && (out.consumer as Node).beneficiary !== undefined) {
      const consumer = { ...(out.consumer as Node) };
      if (consumer.beneficiary === "bearer") consumer.beneficiary = "this-model";
      else if (consumer.beneficiary === "unit") consumer.beneficiary = "this-unit";
      out.consumer = consumer;
    }
  }
  if (Object.hasOwn(out, "applies_to") && ctx.parentKey !== "modifier") out.applies_to = transformAppliesTo(out.applies_to, ctx);
  if (typeof type === "string") out = transformCondition(out, ctx);
  else {
    const { parentKey } = slot(ctx);
    if (parentKey === "filter") out = transformWeaponScope(out, ctx);
    if (shouldTransformFilter(out, ctx)) out = transformUnitFilter(out, ctx);
  }
  return out;
}

function isLikelyUnitFilter(node: Node): boolean {
  if (Object.keys(node).some((key) => Object.hasOwn(FILTER_SIGNAL_KEYS, key))) return true;
  return Object.hasOwn(node, "within_inches") || Object.hasOwn(node, "range_inches")
    ? Object.hasOwn(node, "owner") || Object.hasOwn(node, "count") || Object.hasOwn(node, "max_count") || Object.hasOwn(node, "min_count")
    : false;
}

export { isLikelyUnitFilter, transformSelect, transformUnitFilter as normalizeUnitFilter };