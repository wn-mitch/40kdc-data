/**
 * Humanize an Ability-DSL `effect` tree into plain English — the
 * `ability.print()` of the dataset. Output is an *approximation* generated
 * purely from the structured data (no external rules text), ASCII-only, with
 * a fixed clause order: it is pinned byte-for-byte across the TS and Rust
 * ports by the `conformance/effect-translation` corpus, so any phrasing
 * change here is a semantic corpus change (bump `conformance/SPEC_VERSION`).
 *
 * Container nodes (`sequence`, `conditional`, `choice`, `dice-gated`,
 * `dice-pool-allocation`) render block-style with two-space indentation and
 * an ASCII `-> ` arrow; leaves render as single clauses. Unknown leaf types
 * and unrecognized modifier shapes degrade to a deterministic bracketed form
 * (`[the-type]`) rather than failing — coverage improves as authoring does.
 */

import { describeCondition, dekebab, type Condition } from "./condition.js";

/**
 * Minimal structural view of an effect node. Matches the ability-dsl effect
 * schema: a single effect carries `type` + `target` + `modifier`; containers
 * carry their own shape (`steps`, `options`, `condition`/`effect`, dice
 * fields).
 */
export interface Effect {
  type?: string;
  target?: string;
  modifier?: Record<string, unknown>;
  condition?: Condition;
  effect?: Effect;
  steps?: Effect[];
  options?: (Effect & {
    name?: string;
    requirement?: Record<string, unknown>;
  })[];
  choice_label?: string;
  dice?: string;
  threshold?: number | string;
  comparison?: string;
  on_success?: Effect | null;
  on_fail?: Effect | null;
  pool?: { count: number; die: string };
  max_activations?: number;
}

/** Ability scope, as carried on enrichment ability entries. */
export interface AbilityScope {
  range?: string;
  duration?: string;
  range_inches?: number;
}

/** Curated keyword filter naming which units an ability benefits. */
export interface AbilityAppliesTo {
  required_keywords?: string[];
  excluded_keywords?: string[];
}

/** Minimal ability view for `describeAbility`. */
export interface AbilityLike {
  name?: string;
  effect?: Effect;
  scope?: AbilityScope;
  applies_to?: AbilityAppliesTo | null;
}

/** JS-template stringification (numbers print without trailing `.0`). */
function jstr(v: unknown): string {
  if (v == null) return "?";
  if (Array.isArray(v)) return v.map(jstr).join(", ");
  return String(v);
}

function formatTarget(t?: string): string {
  return t ? dekebab(t) : "target";
}

function signed(operation: unknown, value: unknown): string {
  const op = operation === "add" || operation === "improve" ? "+" : "-";
  return `${op}${jstr(value)}`;
}

function formatComparison(comp: string, threshold: unknown): string {
  const th = jstr(threshold);
  switch (comp) {
    case "gte":
      return `${th}+`;
    case "lte":
      return `${th} or less`;
    case "gt":
      return `greater than ${th}`;
    case "lt":
      return `less than ${th}`;
    case "eq":
      return `exactly ${th}`;
    default:
      return `${th}+`;
  }
}

/** Single-clause translation for leaf effects (and inline container forms). */
export function describeEffectInline(e: Effect): string {
  const m = e.modifier ?? {};
  const target = formatTarget(e.target);

  switch (e.type) {
    case "stat-modifier": {
      const scope = m.attack_type ? ` (${jstr(m.attack_type)})` : "";
      if (m.stat == null) return `modify stats for ${target}`;
      if (m.operation === "set") return `set ${jstr(m.stat)} to ${jstr(m.value)}${scope} for ${target}`;
      return `${signed(m.operation, m.value)} ${jstr(m.stat)}${scope} for ${target}`;
    }
    case "roll-modifier": {
      const ctx = m.context ? ` (${jstr(m.context)})` : "";
      if (m.value == null) return `${dekebab(jstr(m.operation))} ${jstr(m.roll)} rolls${ctx} for ${target}`;
      return `${signed(m.operation, m.value)} to ${jstr(m.roll)} rolls${ctx} for ${target}`;
    }
    case "re-roll": {
      const subset = m.subset ? ` (${dekebab(jstr(m.subset))})` : "";
      const atk = m.attack_type ? ` (${jstr(m.attack_type)})` : "";
      return `re-roll ${jstr(m.roll)} rolls${subset}${atk} for ${target}`;
    }
    case "mortal-wounds": {
      const amount = m.count ?? m.amount ?? (m.amount_table ? "variable" : "?");
      const range = m.range ?? m.range_inches;
      const within = range != null ? ` (within ${jstr(range)}")` : "";
      return `deal ${jstr(amount)} mortal wounds to ${target}${within}`;
    }
    case "feel-no-pain":
      return `${target} gains Feel No Pain ${jstr(m.threshold)}+`;
    case "ward":
      return `${target} gains Ward ${jstr(m.threshold ?? m.value)}+`;
    case "invulnerable-save":
      return `${target} gains a ${jstr(m.invuln_sv ?? m.value)}+ invulnerable save`;
    case "keyword-grant": {
      const kw = Array.isArray(m.keywords) ? m.keywords.map(jstr).join(", ") : jstr(m.keyword ?? "keywords");
      if (m.weapon_name != null) return `${target}'s ${jstr(m.weapon_name)} gains ${kw}`;
      if (m.weapon_type != null) return `${target}'s ${jstr(m.weapon_type)} weapons gain ${kw}`;
      return `${target}'s weapons gain ${kw}`;
    }
    case "ability-grant": {
      const grant = m.grant_type ?? m.ability_id;
      const cap = m.capacity != null ? ` (${jstr(m.capacity)})` : "";
      return `${target} gains ${grant != null ? dekebab(jstr(grant)) : "an ability"}${cap}`;
    }
    case "movement-modifier": {
      const kind = m.move_type ?? m.type;
      const dist = m.distance ?? m.value;
      const inches = dist != null ? ` ${jstr(dist)}"` : "";
      return `${target} gains ${kind != null ? dekebab(jstr(kind)) : "a movement effect"}${inches}`;
    }
    case "damage-reduction":
      return `reduce incoming damage to ${target} by ${jstr(m.amount ?? m.value)}`;
    case "resurrection":
      return `return ${jstr(m.count ?? 1)} model(s) to ${target} with ${jstr(m.wounds_remaining ?? "full")} wounds`;
    case "model-destruction":
      return `destroy ${jstr(m.count)} non-leader model(s) from ${target}`;
    case "cp-gain":
      return `gain ${jstr(m.amount)} CP`;
    case "cp-refund":
      return `refund ${jstr(m.amount)} CP`;
    case "resource-gain":
      return `gain ${jstr(m.amount)} to ${jstr(m.pool_id)}`;
    case "resource-spend":
      return `spend ${jstr(m.amount)} from ${jstr(m.pool_id)}`;
    case "leadership-modifier": {
      if (m.test != null && m.operation == null) return `force a ${dekebab(jstr(m.test))} test on ${target}`;
      if (m.test != null) return `${dekebab(jstr(m.operation))} ${dekebab(jstr(m.test))} tests for ${target}`;
      if (m.operation != null) return `${signed(m.operation, m.value)} Leadership for ${target}`;
      return `modify Leadership for ${target}`;
    }
    case "fight-first":
      return `${target} fights first`;
    case "fight-last":
      return `${target} fights last`;
    case "fight-on-death":
      return `${target} fights on death`;
    case "shoot-on-death":
      return `${target} shoots on death`;
    case "deep-strike":
      return `${target} can deep strike`;
    case "fallback-and-act":
      return `${target} can fall back and act`;
    case "attack-restriction": {
      const what = m.restriction ?? m.restriction_type;
      const range = m.range != null ? ` (within ${jstr(m.range)}")` : "";
      const max = m.max_models != null ? ` (max ${jstr(m.max_models)} models)` : "";
      return `${target}: ${what != null ? dekebab(jstr(what)) : "attack restriction"}${range}${max}`;
    }
    case "objective-control-modifier": {
      if (m.operation != null) return `${signed(m.operation, m.value)} OC for ${target}`;
      return `modify OC of ${target} by ${jstr(m.value)}`;
    }
    case "bs-modifier":
      return `${signed(m.operation, m.value)} BS for ${target}`;
    case "charge-roll-modifier":
      return `${signed(m.operation, m.value)} to charge rolls for ${target}`;
    case "engagement-passthrough":
      return `${target} can move through engagement range`;
    case "terrain-area-tag":
      return `tag the terrain area as ${dekebab(jstr(m.tag))}`;
    case "objective-tag":
      return `tag the objective as ${dekebab(jstr(m.tag))}`;
    case "unit-tag":
      return `tag ${target} as ${dekebab(jstr(m.tag))}`;

    // Container types — inline forms.
    case "conditional":
      return `if ${describeCondition(e.condition ?? {})}: ${describeEffectInline(e.effect ?? {})}`;
    case "sequence":
      return (e.steps ?? []).map(describeEffectInline).join("; ");
    case "choice": {
      const label = e.choice_label ? ` (${e.choice_label})` : "";
      return `choose one${label}: ${(e.options ?? []).map(describeEffectInline).join(" / ")}`;
    }
    case "dice-gated": {
      const comp = formatComparison(e.comparison ?? "gte", e.threshold);
      const success = e.on_success ? describeEffectInline(e.on_success) : "nothing";
      const fail = e.on_fail ? `, otherwise ${describeEffectInline(e.on_fail)}` : "";
      return `roll ${jstr(e.dice)}: on ${comp}, ${success}${fail}`;
    }
    case "dice-pool-allocation": {
      const pool = e.pool ? `${jstr(e.pool.count)}${jstr(e.pool.die)}` : "?";
      const opts = (e.options ?? [])
        .map((o) => `${jstr(o.name)} (${jstr(o.requirement?.min_value)}+): ${describeEffectInline(o.effect ?? {})}`)
        .join(" / ");
      return `roll ${pool}: ${opts}`;
    }

    default:
      return `[${e.type ?? "unknown"}]`;
  }
}

/**
 * Block translation of an effect tree. Containers expand over multiple lines
 * with two-space indentation; leaves delegate to `describeEffectInline`.
 */
export function describeEffect(e: Effect, depth: number = 0): string {
  const indent = "  ".repeat(depth);
  const arrow = depth > 0 ? "-> " : "";

  switch (e.type) {
    case "conditional":
      return `${indent}If ${describeCondition(e.condition ?? {})}:\n` + describeEffect(e.effect ?? {}, depth + 1);
    case "sequence":
      return (e.steps ?? []).map((s) => describeEffect(s, depth)).join("\n");
    case "choice": {
      const label = e.choice_label ? ` (${e.choice_label})` : "";
      return (
        `${indent}${arrow}Choose one${label}:\n` +
        (e.options ?? []).map((o, i) => `${indent}  ${i + 1}. ${describeEffectInline(o)}`).join("\n")
      );
    }
    case "dice-gated": {
      const comp = formatComparison(e.comparison ?? "gte", e.threshold);
      const success = e.on_success ? describeEffectInline(e.on_success) : "nothing";
      const fail = e.on_fail ? `, otherwise ${describeEffectInline(e.on_fail)}` : "";
      return `${indent}${arrow}Roll ${jstr(e.dice)}: on ${comp}, ${success}${fail}`;
    }
    case "dice-pool-allocation": {
      const pool = e.pool ? `${jstr(e.pool.count)}${jstr(e.pool.die)}` : "?";
      const lines = [`${indent}${arrow}Roll ${pool} (max ${jstr(e.max_activations)} activations):`];
      for (const opt of e.options ?? []) {
        lines.push(
          `${indent}  - ${jstr(opt.name)}: need ${jstr(opt.requirement?.type)} of ${jstr(opt.requirement?.min_value)}+ -> ${describeEffectInline(opt.effect ?? {})}`
        );
      }
      return lines.join("\n");
    }
    default:
      return `${indent}${arrow}${describeEffectInline(e)}`;
  }
}

/** `Scope: aura (6"). Duration: phase.` — empty string when absent. */
export function describeScope(s?: AbilityScope): string {
  if (!s || (!s.range && !s.duration)) return "";
  const range = dekebab(s.range ?? "");
  const inches = s.range_inches != null ? ` (${jstr(s.range_inches)}")` : "";
  const duration = dekebab(s.duration ?? "");
  return `Scope: ${range}${inches}. Duration: ${duration}.`;
}

/**
 * `Applies to: units with Possessed.` — the roster-highlighting audience named
 * by a curated `applies_to` filter. Empty string when the filter is absent or
 * carries no keywords (nothing to say). `required_keywords` reads as an AND set;
 * `excluded_keywords` render as a trailing `(excluding …)`.
 */
export function describeAppliesTo(a?: AbilityAppliesTo | null): string {
  if (!a) return "";
  const required = a.required_keywords ?? [];
  const excluded = a.excluded_keywords ?? [];
  if (required.length === 0 && excluded.length === 0) return "";
  const base = required.length ? `units with ${required.join(", ")}` : "all units";
  const exc = excluded.length ? ` (excluding ${excluded.join(", ")})` : "";
  return `Applies to: ${base}${exc}.`;
}

/**
 * Full generated text for an ability: the effect tree, a trailing scope line,
 * and a trailing `Applies to:` line when the ability carries a curated
 * `applies_to` filter. This is the `ability.print()` consumers render when the
 * dataset carries no rules prose.
 */
export function describeAbility(a: AbilityLike): string {
  const effect = a.effect ? describeEffect(a.effect) : "";
  const scope = describeScope(a.scope);
  const applies = describeAppliesTo(a.applies_to);
  return [effect, scope, applies].filter(Boolean).join("\n");
}
