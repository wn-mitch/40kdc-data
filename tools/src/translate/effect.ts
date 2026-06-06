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
 *
 * Leaf phrasing favors graceful omission over placeholders: optional modifier
 * fields that are absent (a CP amount, a move distance, a range) drop their
 * clause instead of rendering `?`.
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

/** Minimal ability view for `describeAbility`. */
export interface AbilityLike {
  name?: string;
  effect?: Effect;
  scope?: AbilityScope;
}

/** JS-template stringification (numbers print without trailing `.0`). */
function jstr(v: unknown): string {
  if (v == null) return "?";
  if (Array.isArray(v)) return v.map(jstr).join(", ");
  return String(v);
}

/** `unit` → `the unit`, `self` → `this model`, etc. */
function formatTarget(t?: string): string {
  switch (t) {
    case "unit":
      return "the unit";
    case "self":
      return "this model";
    case "bearer":
      return "the bearer";
    case "attacker":
      return "the attacker";
    case "defender":
      return "the defender";
    case "enemy-within-aura":
      return "enemy units in range";
    case "friendly-within-aura":
      return "friendly units in range";
    case "all-friendly":
      return "all friendly units";
    case "all-enemy":
      return "all enemy units";
    case "attached-unit":
      return "the attached unit";
    case undefined:
      return "the target";
    default:
      return dekebab(t);
  }
}

/** `1 mortal wound` / `D3 mortal wounds` — `1` is the only singular amount. */
function plural(amount: unknown, noun: string): string {
  const n = jstr(amount);
  return n === "1" ? `${n} ${noun}` : `${n} ${noun}s`;
}

/** Targets that render as plural noun phrases and need plural verb forms. */
const PLURAL_TARGETS = new Set(["enemy-within-aura", "friendly-within-aura", "all-friendly", "all-enemy"]);

function isPluralTarget(t?: string): boolean {
  return t != null && PLURAL_TARGETS.has(t);
}

/** Pick the verb form agreeing with the target's number. */
function verb(pl: boolean, singular: string, pluralForm: string): string {
  return pl ? pluralForm : singular;
}

/** `the unit` → `the unit's`; `all friendly units` → `all friendly units'`. */
function possessive(t: string): string {
  return t.endsWith("s") ? `${t}'` : `${t}'s`;
}

function signed(operation: unknown, value: unknown): string {
  const op = operation === "add" || operation === "improve" ? "+" : "-";
  return `${op}${jstr(value)}`;
}

/** Datasheet stat abbreviations → words (unknown stats fall back to dekebab). */
function statName(stat: string): string {
  switch (stat) {
    case "M":
      return "Move";
    case "T":
      return "Toughness";
    case "Sv":
      return "Save";
    case "W":
      return "Wounds";
    case "Ld":
      return "Leadership";
    case "OC":
      return "OC";
    case "A":
      return "Attacks";
    case "S":
      return "Strength";
    case "D":
      return "Damage";
    case "AP":
      return "AP";
    case "BS":
      return "BS";
    case "WS":
      return "WS";
    default:
      return dekebab(stat);
  }
}

function formatComparison(comp: string, threshold: unknown): string {
  const th = jstr(threshold);
  const numeric = typeof threshold === "number";
  switch (comp) {
    case "gte":
      return numeric ? `${th}+` : `${th} or higher`;
    case "lte":
      return `${th} or less`;
    case "gt":
      return `greater than ${th}`;
    case "lt":
      return `less than ${th}`;
    case "eq":
      return `exactly ${th}`;
    default:
      return numeric ? `${th}+` : `${th} or higher`;
  }
}

/** The failing band of a comparison: `gte 4` fails on `below 4`. */
function formatComparisonInverse(comp: string, threshold: unknown): string {
  const th = jstr(threshold);
  switch (comp) {
    case "gte":
      return `below ${th}`;
    case "lte":
      return `above ${th}`;
    case "gt":
      return `${th} or less`;
    case "lt":
      return `${th} or more`;
    case "eq":
      return `not exactly ${th}`;
    default:
      return `below ${th}`;
  }
}

/**
 * Known `ability-grant` grant types → readable clauses (the grant type is a
 * community-authored tag, so this list tracks authoring vocabulary). Unmapped
 * values fall back to `gains <dekebab>`.
 */
function describeGrant(grant: string, target: string, capacity: unknown, pl: boolean): string {
  const has = verb(pl, "has", "have");
  switch (grant) {
    case "benefit-of-cover":
      return `${target} ${has} the Benefit of Cover`;
    case "lone-operative":
    case "lone-op":
      return pl ? `${target} are Lone Operatives` : `${target} is a Lone Operative`;
    case "leader":
    case "leader-attachment":
      return `${target} can be attached to a unit as a Leader`;
    case "fights-first":
      return `${target} ${verb(pl, "fights", "fight")} first`;
    case "firing-deck":
      return capacity != null ? `${target} ${has} Firing Deck ${jstr(capacity)}` : `${target} ${has} a Firing Deck`;
    case "deep-strike":
      return `${target} can deep strike`;
    case "deep-strike-6inch-exclusion":
      return `${target} can deep strike more than 6" from enemy units`;
    case "charge-after-advance":
      return `${target} can charge after advancing`;
    case "advance-and-charge":
      return `${target} can advance and charge`;
    case "reactive-overwatch":
      return `${target} can fire overwatch reactively`;
    case "forced-attachment":
      return `${target} must be attached to a unit`;
    case "attached-unit-eligibility":
      return `${target} ${has} special leader-attachment eligibility`;
    case "transport-disembark-modifier":
      return `${target} ${has} a special disembark rule`;
    case "special-embark-rule":
      return `${target} ${has} a special embark rule`;
    case "once-per-battle-special":
      return `${target} ${has} a once-per-battle special rule`;
    case "once-per-round-special":
      return `${target} ${has} a once-per-round special rule`;
    case "post-attack-debuff":
      return `${target} ${verb(pl, "applies", "apply")} a debuff after attacking`;
    case "target-in-engagement":
      return `${target} can shoot at targets within engagement range`;
    case "extended-order-range":
      return `${target} ${has} an extended order range`;
    case "flavor-text":
      return `${target}: no game effect (flavor text)`;
    case "faction-metadata":
      return `${target}: faction rule (see faction rules)`;
    default: {
      const cap = capacity != null ? ` (${jstr(capacity)})` : "";
      return `${target} ${verb(pl, "gains", "gain")} ${dekebab(grant)}${cap}`;
    }
  }
}

/**
 * Known `movement-modifier` kinds → readable clauses. A null/zero distance
 * omits the inches clause entirely (no `0"` noise). Unmapped kinds fall back
 * to `gains <dekebab>`.
 */
function describeMove(kind: string, target: string, dist: unknown, pl: boolean): string {
  const hasDist = dist != null && dist !== 0 && dist !== "0";
  const inches = hasDist ? ` ${jstr(dist)}"` : "";
  const upTo = hasDist ? ` of up to ${jstr(dist)}"` : "";
  const has = verb(pl, "has", "have");
  switch (kind) {
    case "scouts":
      return `${target} ${has} Scouts${inches}`;
    case "infiltrate":
      return `${target} ${has} Infiltrators`;
    case "deep-strike":
      return `${target} can deep strike`;
    case "hover":
      return `${target} can hover`;
    case "reactive-move":
      return `${target} can make a reactive move${upTo}`;
    case "shoot-and-scoot":
      return `${target} can move${upTo} after shooting`;
    case "redeploy-to-reserves":
      return `${target} can redeploy into reserves`;
    case "into-strategic-reserves":
      return `${target} can move into strategic reserves`;
    case "move-over-terrain":
      return `${target} can move over terrain`;
    case "move-through":
    case "terrain-passthrough":
      return `${target} can move through terrain`;
    case "move-after-shoot":
      return `${target} can move${upTo} after shooting`;
    case "pile-in-consolidation":
      return hasDist
        ? `${target} ${verb(pl, "piles", "pile")} in and ${verb(pl, "consolidates", "consolidate")} up to ${jstr(dist)}"`
        : `${target} ${has} extended pile-in and consolidation`;
    case "extended-consolidation":
      return hasDist
        ? `${target} ${verb(pl, "consolidates", "consolidate")} up to ${jstr(dist)}"`
        : `${target} ${has} extended consolidation`;
    case "surge-move":
      return `${target} can make a surge move${upTo}`;
    case "ignore-vertical":
      return `${target} ${verb(pl, "ignores", "ignore")} vertical distance when moving`;
    case "deep-strike-6inch-exclusion":
      return `${target} can deep strike more than 6" from enemy units`;
    case "deep-strike-min-distance":
    case "deep-strike-exclusion-range":
    case "deep-strike-close":
      return hasDist
        ? `${target} can deep strike more than ${jstr(dist)}" from enemy units`
        : `${target} has a modified deep strike distance`;
    case "normal":
      return `${target} can make a normal move${upTo}`;
    default:
      return `${target} ${verb(pl, "gains", "gain")} ${dekebab(kind)}${inches}`;
  }
}

/**
 * Known `attack-restriction` tags → readable clauses. Unmapped values fall
 * back to `<target>: <dekebab>`.
 */
function describeRestriction(what: string, target: string, pl: boolean): string {
  const is = verb(pl, "is", "are");
  switch (what) {
    case "cannot-be-targeted-unless-closest-or-within-12":
      return `${target} cannot be targeted unless the attacker is within 12" or ${pl ? "they are" : "it is"} the closest eligible target`;
    case "anti-fallback":
      return `enemy units in engagement range of ${target} cannot fall back`;
    case "must-be-warlord":
      return `${target} must be your Warlord`;
    case "cannot-be-warlord":
      return `${target} cannot be your Warlord`;
    case "no-charge":
    case "cannot-charge":
    case "cannot-declare-charge":
    case "charge-blocked":
    case "charge":
      return `${target} cannot declare a charge`;
    case "no-advance":
      return `${target} cannot advance`;
    case "reinforcement-denial":
    case "prevent-reserve-setup":
      return `enemy reinforcements cannot be set up near ${target}`;
    case "prevents-enemy-reserves-within-12":
      return `enemy reinforcements cannot be set up within 12" of ${target}`;
    case "army-composition-rule":
    case "army-composition-constraint":
      return `${target} ${is} subject to an army composition rule`;
    case "unique-unit-limit":
      return `${target} ${is} limited to one per army`;
    case "fire-overwatch":
      return `${target} can fire overwatch`;
    case "cannot-target-bearer":
      return `enemy units cannot target the bearer`;
    case "cannot-receive-enhancements":
      return `${target} cannot be given enhancements`;
    default:
      return `${target}: ${dekebab(what)}`;
  }
}

/** Single-clause translation for leaf effects (and inline container forms). */
export function describeEffectInline(e: Effect): string {
  const m = e.modifier ?? {};
  const target = formatTarget(e.target);
  const pl = isPluralTarget(e.target);

  switch (e.type) {
    case "stat-modifier": {
      const scope = m.attack_type ? ` (${jstr(m.attack_type)})` : "";
      if (m.stat == null) return `modify stats for ${target}`;
      const stat = statName(jstr(m.stat));
      if (m.operation === "set") return `set ${stat} to ${jstr(m.value)}${scope} for ${target}`;
      if (m.value == null) {
        const verb = m.operation === "add" || m.operation === "improve" ? "improve" : "worsen";
        return `${verb} ${stat}${scope} for ${target}`;
      }
      return `${signed(m.operation, m.value)} ${stat}${scope} for ${target}`;
    }
    case "roll-modifier": {
      const ctx = m.context ? ` (${jstr(m.context)})` : "";
      if (m.critical_on != null) return `critical ${jstr(m.roll)}s on ${jstr(m.critical_on)}+${ctx} for ${target}`;
      if (m.operation == null && m.value == null) return `modify ${jstr(m.roll)} rolls${ctx} for ${target}`;
      if (m.value == null) return `${dekebab(jstr(m.operation))} ${jstr(m.roll)} rolls${ctx} for ${target}`;
      return `${signed(m.operation, m.value)} to ${jstr(m.roll)} rolls${ctx} for ${target}`;
    }
    case "re-roll": {
      const atk = m.attack_type != null ? `${jstr(m.attack_type)} ` : "";
      const roll = `${atk}${jstr(m.roll)} rolls`;
      if (m.subset === "ones") return `re-roll ${roll} of 1 for ${target}`;
      if (m.subset === "all-failures") return `re-roll failed ${roll} for ${target}`;
      if (m.subset != null) return `re-roll ${roll} (${dekebab(jstr(m.subset))}) for ${target}`;
      return `re-roll ${roll} for ${target}`;
    }
    case "mortal-wounds": {
      if (m.trigger != null && m.threshold != null) {
        return `${dekebab(jstr(m.trigger))} triggers on ${jstr(m.threshold)}+ for ${target}`;
      }
      const base = m.count ?? m.amount;
      const amount = base != null && m.bonus != null ? `${jstr(base)}+${jstr(m.bonus)}` : base;
      const range = m.range ?? m.range_inches;
      // `enemy units in range (within 6")` is redundant — fold the inches in.
      const to = e.target === "enemy-within-aura" && range != null ? `enemy units within ${jstr(range)}"` : null;
      const within = to == null && range != null ? ` (within ${jstr(range)}")` : "";
      if (amount == null && m.amount_table != null) {
        return `deal mortal wounds (amount varies) to ${to ?? target}${within}`;
      }
      if (amount == null) return `deal mortal wounds to ${to ?? target}${within}`;
      return `deal ${plural(amount, "mortal wound")} to ${to ?? target}${within}`;
    }
    case "feel-no-pain":
      return `${target} ${verb(pl, "has", "have")} Feel No Pain ${jstr(m.threshold)}+`;
    case "ward":
      return `${target} ${verb(pl, "has", "have")} Ward ${jstr(m.threshold ?? m.value)}+`;
    case "invulnerable-save": {
      const value = m.invuln_sv ?? m.value ?? m.threshold;
      const has = verb(pl, "has", "have");
      if (value == null) return `${target} ${has} an invulnerable save`;
      return `${target} ${has} a ${jstr(value)}+ invulnerable save`;
    }
    case "keyword-grant": {
      const kw = Array.isArray(m.keywords) ? m.keywords.map(jstr).join(", ") : jstr(m.keyword ?? "keywords");
      if (m.weapon_name != null) return `${possessive(target)} ${jstr(m.weapon_name)} gains ${kw}`;
      if (m.weapon_type != null) return `${possessive(target)} ${jstr(m.weapon_type)} weapons gain ${kw}`;
      return `${possessive(target)} weapons gain ${kw}`;
    }
    case "ability-grant": {
      const grant = m.grant_type ?? m.ability_id;
      if (grant == null) return `${target} ${verb(pl, "gains", "gain")} an ability`;
      return describeGrant(jstr(grant), target, m.capacity, pl);
    }
    case "movement-modifier": {
      const kind = m.move_type ?? m.type;
      const dist = m.distance ?? m.value;
      if (kind == null) return `${target} ${verb(pl, "gains", "gain")} a movement effect`;
      return describeMove(jstr(kind), target, dist, pl);
    }
    case "damage-reduction": {
      const amount = m.reduction ?? m.amount ?? m.value;
      if (amount == null) return `reduce incoming damage to ${target}`;
      return `reduce incoming damage to ${target} by ${jstr(amount)}`;
    }
    case "resurrection":
      return `return ${plural(m.count ?? 1, "model")} to ${target} with ${jstr(m.wounds_remaining ?? "full")} wounds`;
    case "model-destruction": {
      if (m.count == null) return `destroy a non-leader model from ${target}`;
      return `destroy ${plural(m.count, "non-leader model")} from ${target}`;
    }
    case "cp-gain": {
      const once = m.type === "once-per-battle-resource" ? " (once per battle)" : "";
      if (m.amount == null) return `gain CP${once}`;
      return `gain ${jstr(m.amount)} CP${once}`;
    }
    case "cp-refund": {
      const once = m.type === "once-per-battle-resource" ? " (once per battle)" : "";
      const strat = m.stratagem != null ? ` for ${dekebab(jstr(m.stratagem))}` : "";
      const freq = m.frequency != null ? ` (${dekebab(jstr(m.frequency))})` : "";
      if (m.amount == null) return `refund CP${strat}${freq}${once}`;
      return `refund ${jstr(m.amount)} CP${strat}${freq}${once}`;
    }
    case "resource-gain": {
      const pool = m.pool_id ?? m.resource;
      const what = pool != null ? dekebab(jstr(pool)).replace(/ pool$/, "") : "resource";
      if (m.amount == null) return `gain ${what}`;
      return `gain ${jstr(m.amount)} ${what}`;
    }
    case "resource-spend": {
      const pool = m.pool_id ?? m.resource;
      const what = pool != null ? dekebab(jstr(pool)).replace(/ pool$/, "") : "resource";
      if (m.operation === "multiply") return `${what} costs are multiplied by ${jstr(m.value)} for ${target}`;
      if (m.amount == null) return `spend ${what}`;
      return `spend ${jstr(m.amount)} ${what}`;
    }
    case "leadership-modifier": {
      if (m.test != null && m.operation == null) return `force a ${dekebab(jstr(m.test))} test on ${target}`;
      if (m.test != null) return `${dekebab(jstr(m.operation))} ${dekebab(jstr(m.test))} tests for ${target}`;
      if (m.operation != null && m.value == null) {
        const verb = m.operation === "add" || m.operation === "improve" ? "improve" : "worsen";
        return `${verb} Leadership for ${target}`;
      }
      if (m.operation != null) return `${signed(m.operation, m.value)} Leadership for ${target}`;
      return `modify Leadership for ${target}`;
    }
    case "fight-first":
      return `${target} ${verb(pl, "fights", "fight")} first`;
    case "fight-last":
      return `${target} ${verb(pl, "fights", "fight")} last`;
    case "fight-on-death":
      return `${target} can fight after being destroyed`;
    case "shoot-on-death":
      return `${target} can shoot after being destroyed`;
    case "deep-strike":
      return `${target} can deep strike`;
    case "fallback-and-act":
      return `${target} can fall back and still act`;
    case "attack-restriction": {
      const what = m.restriction ?? m.restriction_type;
      const range = m.range != null ? ` (within ${jstr(m.range)}")` : "";
      const max = m.max_models != null ? ` (max ${jstr(m.max_models)} models)` : "";
      if (what == null && m.attack_type === "charge") return `${target} cannot declare a charge${range}${max}`;
      if (what == null && m.attack_type != null)
        return `${target} cannot make ${jstr(m.attack_type)} attacks${range}${max}`;
      if (what == null) return `${target}: attack restriction${range}${max}`;
      return `${describeRestriction(jstr(what), target, pl)}${range}${max}`;
    }
    case "objective-control-modifier": {
      if (m.sticky) return `objectives captured by ${target} remain under your control after it moves away`;
      if (m.operation != null && m.value == null) {
        const verb = m.operation === "add" || m.operation === "improve" ? "improve" : "worsen";
        return `${verb} OC for ${target}`;
      }
      if (m.operation != null) return `${signed(m.operation, m.value)} OC for ${target}`;
      if (m.value == null) return `modify OC of ${target}`;
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
      if (e.on_success == null && e.on_fail != null) {
        const inv = formatComparisonInverse(e.comparison ?? "gte", e.threshold);
        return `roll ${jstr(e.dice)}: on ${inv}, ${describeEffectInline(e.on_fail)}`;
      }
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
      if (e.on_success == null && e.on_fail != null) {
        const inv = formatComparisonInverse(e.comparison ?? "gte", e.threshold);
        return `${indent}${arrow}Roll ${jstr(e.dice)}: on ${inv}, ${describeEffectInline(e.on_fail)}`;
      }
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
          `${indent}  - ${jstr(opt.name)}: needs a ${jstr(opt.requirement?.type)} of ${jstr(opt.requirement?.min_value)}+ -> ${describeEffectInline(opt.effect ?? {})}`
        );
      }
      return lines.join("\n");
    }
    default:
      return `${indent}${arrow}${describeEffectInline(e)}`;
  }
}

/** `Scope: aura 6". Duration: phase.` — empty string when absent. */
export function describeScope(s?: AbilityScope): string {
  if (!s || (!s.range && !s.duration)) return "";
  let range = dekebab(s.range ?? "");
  // `aura-6` carries its radius in the range tag itself — add the inch mark.
  const auraMatch = /^aura (\d+)$/.exec(range);
  if (auraMatch) range = `aura ${auraMatch[1]}"`;
  const inches = s.range_inches != null ? ` (${jstr(s.range_inches)}")` : "";
  const duration = dekebab(s.duration ?? "");
  return `Scope: ${range}${inches}. Duration: ${duration}.`;
}

/**
 * Full generated text for an ability: the effect tree plus a trailing scope
 * line. This is the `ability.print()` consumers render when the dataset
 * carries no rules prose.
 */
export function describeAbility(a: AbilityLike): string {
  const effect = a.effect ? describeEffect(a.effect) : "";
  const scope = describeScope(a.scope);
  return scope ? (effect ? `${effect}\n${scope}` : scope) : effect;
}
