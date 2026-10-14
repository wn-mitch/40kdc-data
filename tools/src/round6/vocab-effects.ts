/**
 * Rules that move one legacy single effect to the round-6 effect vocabulary
 * (effect.schema.json `single-effect`). The legacy `target` becomes a unit-ref; the
 * ability's `scope.range` supplies an aura target's range. A modifier key a rule does
 * not place returns a review reason instead of being dropped.
 */
import type { Node, Outcome } from "./vocab-conditions.js";

export type EffectContext = {
  /** The ability's scope.range and range_inches (aura-6, engagement-range, …). */
  scopeRange?: string;
  rangeInches?: number;
  abilityType?: string;
  /** Inside a selection's effect `unit` is the selected unit; inside an aura it is the recipient. */
  within?: "selection" | "aura";
};

const AURA_INCHES: Record<string, number> = { "aura-6": 6, "aura-9": 9, "aura-12": 12 };

/** The range an aura target reaches, from the ability's scope. */
/** The radius an ability's legacy scope gave its aura targets; null when the scope never said. */
function auraRange(ctx: EffectContext): Node | string | null {
  if (ctx.scopeRange && AURA_INCHES[ctx.scopeRange]) return { inches: AURA_INCHES[ctx.scopeRange] };
  if (ctx.scopeRange === "aura-custom" && typeof ctx.rangeInches === "number") return { inches: ctx.rangeInches };
  if (ctx.scopeRange === "engagement-range") return "engagement";
  return null;
}

/** A legacy effect target as a unit-ref. */
export function targetRef(target: unknown, ctx: EffectContext): unknown | null {
  switch (target) {
    case "unit":
      return ctx.within === "selection" ? "selected-unit" : ctx.within === "aura" ? "recipient" : "this-unit";
    case "attached-unit":
      return "this-unit";
    case "self":
    case "bearer":
      return "this-model";
    case "attacker":
      return "attacker";
    case "defender":
      return "defender";
    case "target":
      return ctx.abilityType === "stratagem" ? "stratagem-target" : "defender";
    case "selected-models-unit":
      return "selected-unit";
    case "destroyed-model":
      return "event-object";
    case "triggering-unit":
      return "event-subject";
    case "all-friendly":
      return { owner: "friendly" };
    case "all-enemy":
      return { owner: "enemy" };
    case "friendly-within-aura":
    case "enemy-within-aura": {
      const owner = target === "friendly-within-aura" ? "friendly" : "enemy";
      if (ctx.scopeRange === "any-visible") return { owner, visible: true };
      if (ctx.scopeRange === "any-on-battlefield") return { owner };
      const range = auraRange(ctx);
      return range === null ? null : { owner, within: { range } };
    }
    default:
      return null;
  }
}

const WEAPON_KEYS = ["weapon_type", "weapon_name", "weapon_keyword"];

/** Copy the weapon filter; legacy attack_type means the same as weapon_type. */
function weapon(m: Node, out: Node): string | null {
  for (const k of WEAPON_KEYS) if (m[k] != null) out[k] = m[k];
  if (m.attack_type != null) {
    if (m.attack_type !== "melee" && m.attack_type !== "ranged") return `attack_type ${String(m.attack_type)}`;
    if (out.weapon_type != null && out.weapon_type !== m.attack_type) return "attack_type disagrees with weapon_type";
    out.weapon_type = m.attack_type;
  }
  if (m.weapon != null) out.weapon_name = m.weapon;
  if (m.incoming === true) out.incoming = true;
  return null;
}

const node = (type: string, target: unknown, modifier: Node): Node => (Object.keys(modifier).length ? { type, target, modifier } : { type, target });

const DICE = /^(\d*D(3|6)(\+\d+)?|\d+)$/;
function dice(v: unknown): unknown {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.toUpperCase().replace(/\s+/g, "");
    if (/^\d+$/.test(s)) return Number(s);
    return DICE.test(s) ? s : null;
  }
  return null;
}

/** Keys of `m` outside `allowed`. */
const stray = (m: Node, allowed: string[]): string[] => Object.keys(m).filter((k) => !allowed.includes(k));

const ROLL_ALIASES: Record<string, string> = { "battle-shock-test": "battle-shock", "saving-throw": "save", "attacks-characteristic": "attacks", "normal-move-distance": "normal-move" };

export function migrateEffect(e: Node, ctx: EffectContext): Outcome {
  const t = String(e.type);
  const m = ((e.modifier ?? {}) as Node) ?? {};
  const extra = Object.keys(e).filter((k) => !["type", "target", "modifier", "scaling"].includes(k));
  if (extra.length) return { review: `effect keys ${extra.join(", ")}` };
  const target = targetRef(e.target, ctx);
  if (target === null) return { review: `target ${String(e.target)}` };
  const r = rule(t, m, target, ctx);
  if ("review" in r) return r;
  if (e.scaling !== undefined && r.node.type !== undefined && !("operator" in r.node)) r.node.scaling = e.scaling;
  return r;
}

function rule(t: string, m: Node, target: unknown, ctx: EffectContext): Outcome {
  const keys = Object.keys(m);
  const only = (...a: string[]) => stray(m, a);
  const fail = (why: string): Outcome => ({ review: `${t}: ${why}` });
  switch (t) {
    case "stat-modifier":
    case "bs-modifier":
    case "detection-range-modifier": {
      const s = only("stat", "operation", "value", "attack_type", ...WEAPON_KEYS, "incoming", "weapon");
      if (s.length) return fail(`keys ${s.join(", ")}`);
      const stat = t === "bs-modifier" ? "BS" : t === "detection-range-modifier" ? "detection-range" : m.stat;
      if (t === "bs-modifier" && m.operation === "ignore-modifiers") return { node: node("ignore-modifiers", target, { what: "characteristics", stats: ["BS"] }) };
      const out: Node = { stat, operation: m.operation };
      if (m.value != null) {
        const v = dice(m.value);
        if (v === null) return fail(`value ${String(m.value)}`);
        out.value = v;
      }
      const w = weapon(m, out);
      if (w) return fail(w);
      return { node: node("stat-modifier", target, out) };
    }
    case "objective-control-modifier": {
      if (m.sticky === true) return only("sticky", "retake").length ? fail("sticky keys") : { node: node("objective-sticky", target, {}) };
      const s = only("operation", "value", "stat");
      if (s.length) return fail(`keys ${s.join(", ")}`);
      if (m.operation === "secure") return { node: node("objective-sticky", target, {}) };
      return { node: node("stat-modifier", target, { stat: "OC", operation: m.operation, ...(m.value != null ? { value: m.value } : {}) }) };
    }
    case "modifier-immunity":
      return only("scope").length ? fail("keys") : { node: node("ignore-modifiers", target, { what: "characteristics" }) };
    case "roll-modifier":
    case "charge-roll-modifier": {
      const s = only("roll", "operation", "value", "attack_type", ...WEAPON_KEYS, "incoming", "critical_on", "weapon", "applies_when");
      if (s.length) return fail(`keys ${s.join(", ")}`);
      if (m.applies_when != null) {
        if (m.applies_when !== "attacker-strength-greater-than-target-toughness") return fail(`applies_when ${String(m.applies_when)}`);
        const { applies_when: _a, ...inner } = m;
        const r = rule(t, inner, target, ctx);
        if ("review" in r) return r;
        return { node: { type: "conditional", condition: { type: "attack-compare", parameters: { left: { of: "attacker", stat: "S" }, comparison: "greater-than", right: { of: "defender", stat: "T" } } }, effect: r.node } };
      }
      const roll = t === "charge-roll-modifier" ? "charge" : ROLL_ALIASES[String(m.roll)] ?? m.roll;
      const out: Node = { roll };
      const w = weapon(m, out);
      if (w) return fail(w);
      if (m.operation === "ignore-modifiers") return { node: node("ignore-modifiers", target, { what: "rolls", rolls: [roll], ...stripRoll(out) }) };
      if (m.operation === "set") return { node: node("roll-result", target, { ...out, result: m.value }) };
      if (m.operation === "crit-on" || m.critical_on != null) return { node: node("roll-result", target, { ...out, critical_on: m.critical_on ?? m.value }) };
      if (m.operation !== "add" && m.operation !== "subtract") return fail(`operation ${String(m.operation)}`);
      const v = dice(m.value);
      if (v === null) return fail(`value ${String(m.value)}`);
      return { node: node("roll-modifier", target, { ...out, operation: m.operation, value: v }) };
    }
    case "re-roll": {
      const s = only("roll", "subset", "result_scope", "count", "attack_type", ...WEAPON_KEYS, "incoming", "weapon");
      if (s.length) return fail(`keys ${s.join(", ")}`);
      const out: Node = { roll: ROLL_ALIASES[String(m.roll)] ?? m.roll };
      if (m.subset != null) out.subset = m.subset;
      if (m.result_scope != null) out.result_scope = m.result_scope;
      if (m.count != null) out.count = m.count;
      const w = weapon(m, out);
      if (w) return fail(w);
      return { node: node("re-roll", target, out) };
    }
    case "auto-result": {
      if (only("result", "roll", "test").length) return fail("keys");
      const roll = ROLL_ALIASES[String(m.roll ?? m.test)] ?? m.roll ?? m.test;
      return { node: node("roll-result", target, { roll, result: m.result }) };
    }
    case "leadership-modifier": {
      if (only("test", "operation", "value").length) return fail("keys");
      const roll = m.test === "leadership" ? "leadership" : "battle-shock";
      if (m.operation === "add" || m.operation === "subtract" || m.operation === "improve" || m.operation === "worsen") {
        const op = m.operation === "improve" ? "add" : m.operation === "worsen" ? "subtract" : m.operation;
        return { node: node("roll-modifier", target, { roll, operation: op, value: m.value ?? 1 }) };
      }
      if (m.operation === "re-roll") return { node: node("re-roll", target, { roll, subset: "all-failures" }) };
      if (m.operation === "force-test" || m.operation === "battle-shock-test" || m.operation === "force") return { node: node("test", target, { test: roll }) };
      if (m.operation === "auto-pass" || m.operation === "auto-success") return { node: node("roll-result", target, { roll, result: "pass" }) };
      // No operation: the target must take the test.
      if (m.operation == null && m.value == null) return { node: node("test", target, { test: roll }) };
      if (m.operation === "set" && roll === "battle-shock") return { node: node("state-change", target, { state: "battle-shocked", set: true }) };
      return fail(`operation ${String(m.operation)}`);
    }
    case "battle-shock-test":
      return keys.length ? fail("keys") : { node: node("test", target, { test: "battle-shock" }) };
    case "set-battle-shock":
    case "remove-battle-shock":
      return keys.length ? fail("keys") : { node: node("state-change", target, { state: "battle-shocked", set: t === "set-battle-shock" }) };
    case "keyword-grant": {
      const s = only("keywords", "keyword", "value", "attack_type", ...WEAPON_KEYS, "weapon", "incoming", "scope");
      if (s.length) return fail(`keys ${s.join(", ")}`);
      const list: string[] = Array.isArray(m.keywords) ? (m.keywords as string[]).map(String) : m.keyword != null ? [String(m.keyword)] : [];
      if (!list.length) return fail("no keywords");
      const abilities = m.value != null && list.length === 1 ? [`${list[0]} ${String(m.value)}`] : list;
      const out: Node = { abilities };
      const w = weapon(m, out);
      if (w) return fail(w);
      return { node: node("weapon-ability-grant", target, out) };
    }
    case "unit-keyword-grant":
      if (only("keyword").length) return fail("keys");
      return { node: node("keyword-grant", target, { keywords: [String(m.keyword).toUpperCase()] }) };
    case "unit-keyword":
      return only("keyword_id").length ? fail("keys") : { node: node("ability-grant", target, { ability: m.keyword_id }) };
    case "fight-first":
      return keys.length ? fail("keys") : { node: node("ability-grant", target, { ability: "fights-first" }) };
    case "ability-grant": {
      if (m.grant_type != null) return grantType(String(m.grant_type), m, target);
      if (m.ability_id === "firing-deck" && only("ability_id", "capacity").length === 0) return { node: node("ability-grant", target, { ability: "firing-deck", value: m.capacity }) };
      if (only("ability_id", "rules_bundle", "enabled", "value").length) return fail(`keys ${only("ability_id", "rules_bundle", "enabled", "value").join(", ")}`);
      if (m.enabled === false) return fail("disabled grant");
      return { node: node("ability-grant", target, { ability: m.ability_id, ...(m.value != null ? { value: m.value } : {}), ...(m.rules_bundle ? { rules_bundle: true } : {}) }) };
    }
    case "rule-state":
      if (only("direction", "rule_kind", "rule").length) return fail("keys");
      if (m.rule_kind === "core-rule" && (m.rule === "fall-back" || m.rule === "charge" || m.rule === "advance")) {
        const activity = m.rule === "charge" ? "declare-charge" : m.rule;
        return { node: node("permission", target, { activity, allow: m.direction === "granted" }) };
      }
      return { node: node("rule-state", target, { direction: m.direction, rule_kind: m.rule_kind, rule: m.rule }) };
    case "fallback-and-act":
      if (only("can_charge").length) return fail("keys");
      return m.can_charge
        ? { node: { type: "sequence", steps: [node("permission", target, { activity: "shoot", allow: true, after: ["fall-back"] }), node("permission", target, { activity: "declare-charge", allow: true, after: ["fall-back"] })] } }
        : { node: node("permission", target, { activity: "shoot", allow: true, after: ["fall-back"] }) };
    case "targeting-permission":
      if (only("attack_type", "gate", "range").length || m.gate !== "within-range") return fail("keys");
      return { node: node("targeting", { owner: "enemy" }, { may: "cannot-target", target, ...(m.attack_type === "ranged" ? { kind: "shoot" } : {}), range: { inches: m.range }, ...(m.attack_type === "ranged" ? { weapon_type: "ranged" } : {}) }) };
    case "mortal-wounds": {
      const s = only("count", "range", "amount", "range_inches", "dice");
      if (s.length) return fail(`keys ${s.join(", ")}`);
      const c = dice(m.count ?? m.amount ?? m.dice);
      if (c === null) return fail(`count ${String(m.count ?? m.amount)}`);
      const out: Node = { count: c };
      if (m.range != null) out.range = m.range === "engagement" ? "engagement" : { inches: m.range };
      if (m.range_inches != null) out.range = { inches: m.range_inches };
      return { node: node("mortal-wounds", target, out) };
    }
    case "damage-reduction": {
      if (only("reduction", "attack_type", ...WEAPON_KEYS).length) return fail("keys");
      const out: Node = { reduction: m.reduction };
      const w = weapon(m, out);
      return w ? fail(w) : { node: node("damage-reduction", target, out) };
    }
    case "feel-no-pain":
      if (only("threshold", "scope").length) return fail("keys");
      return { node: node("feel-no-pain", target, { threshold: m.threshold, ...(m.scope ? { against: m.scope } : {}) }) };
    case "invulnerable-save": {
      if (only("invuln_sv", "threshold", "attack_type", ...WEAPON_KEYS).length) return fail("keys");
      const out: Node = { invuln_sv: m.invuln_sv ?? m.threshold };
      const w = weapon(m, out);
      return w ? fail(w) : { node: node("invulnerable-save", target, out) };
    }
    case "heal-wounds":
      return only("amount").length ? fail("keys") : { node: node("heal", target, { amount: dice(m.amount) ?? m.amount }) };
    case "resurrection": {
      if (m.type === "wounds" && only("type", "count").length === 0) return { node: node("heal", target, { amount: dice(m.count) ?? m.count }) };
      if ((m.type === "models" || m.type == null) && only("type", "count", "wounds_remaining", "placement").length === 0) {
        const out: Node = { count: dice(m.count) ?? m.count };
        if (m.wounds_remaining != null) out.wounds_remaining = m.wounds_remaining === "full" ? "full" : dice(m.wounds_remaining) ?? m.wounds_remaining;
        if (m.placement === "closest-to-destruction" || m.placement === "unengaged") out.placement = m.placement;
        else if (m.placement != null) return fail(`placement ${String(m.placement)}`);
        return { node: node("return-models", target, out) };
      }
      return fail(`shape ${keys.join(", ")}`);
    }
    case "model-destruction": {
      if (only("count", "model_keyword", "remove_from_play", "exclude_leader").length) return fail("keys");
      const out: Node = { count: m.count === "all" ? "all" : dice(m.count ?? 1) };
      for (const k of ["model_keyword", "remove_from_play", "exclude_leader"]) if (m[k] != null) out[k] = m[k];
      return { node: node("destroy-models", target, out) };
    }
    case "fight-on-death":
    case "shoot-on-death": {
      if (only("resolution", "removal", "eligibility", "gate").length) return fail("keys");
      return { node: node("act-on-death", target, { act: t === "fight-on-death" ? "fight" : "shoot", ...m }) };
    }
    case "unit-division":
      return only("resulting_model_counts").length ? fail("keys") : { node: node("split-unit", target, { model_counts: m.resulting_model_counts }) };
    case "engagement-passthrough":
      if (only("no_end_in_engagement", "applies_to_moves").length) return fail("keys");
      return { node: node("move-modifier", target, { ...(m.applies_to_moves ? { applies_to_moves: m.applies_to_moves } : {}), passthrough: ["models"], ...(m.no_end_in_engagement ? { no_end_in_engagement: true } : {}) }) };
    case "deep-strike":
      return keys.length ? fail(`keys ${keys.join(", ")}`) : { node: node("ability-grant", target, { ability: "deep-strike" }) };
    case "cp-gain":
      if (only("amount", "count").length) return fail("keys");
      return { node: node("cp-gain", target, { amount: m.amount ?? m.count }) };
    case "cp-refund": {
      if (only("amount").length === 0) return { node: node("cp-gain", target, { amount: m.amount }) };
      // "You can use <Stratagem> on this unit for 0CP."
      const zero = (id?: string) => node("cost-modifier", target, { of: "stratagem", ...(id ? { id } : {}), operation: "set", amount: 0, applies_to: "targeting-this-unit" });
      if (only("stratagem").length === 0) {
        const ids = m.stratagem === "fire-overwatch-or-heroic" ? ["fire-overwatch", "heroic-intervention"] : [String(m.stratagem)];
        return { node: ids.length === 1 ? zero(ids[0]) : { type: "choice", options: ids.map((id) => zero(id)) } };
      }
      if (only("type").length === 0 && m.type === "stratagem-for-0cp") return { node: zero() };
      return fail(`shape ${keys.join(", ")}`);
    }
    case "stratagem-cost-modifier": {
      if (only("operation", "amount", "applies_to", "stratagem", "set_to").length) return fail("keys");
      const applies = { "stratagems-targeting-bearer": "targeting-this-unit", "triggering-stratagem-use": "the-triggering-use" }[String(m.applies_to)];
      if (!applies) return fail(`applies_to ${String(m.applies_to)}`);
      const op = m.operation === "set-to" ? "set" : m.operation;
      return { node: node("cost-modifier", target, { of: "stratagem", operation: op, amount: m.amount ?? m.set_to, applies_to: applies, ...(m.stratagem ? { id: m.stratagem } : {}) }) };
    }
    case "resource-gain":
    case "resource-spend": {
      if (only("amount", "pool_id", "resource", "resource_label").length) return fail(`keys ${only("amount", "pool_id", "resource", "resource_label").join(", ")}`);
      const pool = m.pool_id ?? m.resource;
      if (pool === "cp") return t === "resource-gain" ? { node: node("cp-gain", target, { amount: m.amount }) } : fail("cp spend");
      const amount = m.amount === "one or more" ? "one-or-more" : m.amount === "any number" ? "any" : dice(m.amount) ?? m.amount;
      return { node: node(t, target, { pool, amount, ...(m.resource_label ? { label: m.resource_label } : {}) }) };
    }
    case "resource-clear":
      return { node: node("resource-spend", target, { pool: m.pool_id, amount: "all", ...(m.resource_label ? { label: m.resource_label } : {}) }) };
    case "pool-add-die": {
      if (only("pool_id", "value", "count", "count_per_pool", "consumes_pool").length) return fail("keys");
      const out: Node = { pool: m.pool_id, operation: "add", value: m.value };
      for (const k of ["count", "count_per_pool", "consumes_pool"]) if (m[k] != null) out[k] = m[k];
      return { node: node("resource-die", target, out) };
    }
    case "replace-roll-from-pool":
      return { node: node("resource-die", target, { pool: m.pool_id, operation: "substitute", rolls: m.rolls }) };
    case "unit-tag":
      if (m.tag === "battle-shocked" && only("tag", "operation").length === 0) return { node: node("state-change", target, { state: "battle-shocked", set: m.operation !== "remove" }) };
      if (only("tag", "clears_on").length) return fail(`keys ${keys.join(", ")}`);
      return { node: node("designate", target, { tag: m.tag, ...(m.clears_on ? { clears_on: m.clears_on } : {}) }) };
    case "objective-tag":
    case "terrain-area-tag":
      if (only("tag", "source", "clears_on").length) return fail("keys");
      return { node: node("designate", target, { subject: t === "objective-tag" ? { objective: {} } : { terrain_area: {} }, tag: m.tag, ...(m.clears_on ? { clears_on: m.clears_on } : {}) }) };
    case "hazard-rolls":
    case "desperate-escape":
      return fail("test shape");
    case "strategic-reserves-arrival":
      if (only("min_distance").length) return fail("keys");
      return { node: node("set-up", target, { to: "battlefield", from: "strategic-reserves", ...(m.min_distance != null ? { min_enemy_distance: m.min_distance } : {}) }) };
    case "disembark":
      if (only("distance", "allow_engagement_range", "after").length) return fail("keys");
      return fail("disembark shape");
    case "unit-attachment":
      if (only("led_by", "mandatory").length) return fail("keys");
      return { node: node("army-rule", target, { rule: "attachment", ...(m.led_by ? { led_by: m.led_by } : {}), ...(m.mandatory ? { mandatory: true } : {}) }) };
    default:
      return fail("no rule");
  }
}

function stripRoll(n: Node): Node {
  const { roll: _roll, ...rest } = n;
  return rest;
}

/** Legacy effect targets; a node with any other target is already in the new vocabulary. */
export const LEGACY_TARGETS = new Set(["unit", "self", "bearer", "attached-unit", "selected-models-unit", "target", "targets-of-selected-unit-attacks",
  "friendly-within-aura", "enemy-within-aura", "all-friendly", "all-enemy", "destroyed-model", "triggering-unit"]);

/** Legacy single-effect types that no longer exist. */
export const LEGACY_ONLY_TYPES = new Set(["bs-modifier", "detection-range-modifier", "objective-control-modifier", "modifier-immunity", "charge-roll-modifier",
  "auto-result", "leadership-modifier", "battle-shock-test", "set-battle-shock", "remove-battle-shock", "unit-keyword-grant", "unit-keyword", "fight-first", "fight-last",
  "fallback-and-act", "targeting-permission", "stratagem-targeting-permission", "eligibility-override", "fight-eligibility-extension", "attack-restriction", "ward", "flyover",
  "heal-wounds", "resurrection", "model-destruction", "fight-on-death", "shoot-on-death", "unit-division", "deadly-demise-threshold", "engagement-passthrough",
  "disembark-after-move", "disembark", "embark", "reactive-charge", "deep-strike", "strategic-reserves-arrival", "transport-capacity-conversion",
  "persistent-battlefield-marker-state", "tracking-token", "hazard-rolls", "desperate-escape", "cp-refund", "cp-on-destroy", "stratagem-cost-modifier",
  "resource-clear", "pool-add-die", "recovery-pool", "miracle-die-operation", "ability-usage-limit", "objective-tag", "unit-tag", "terrain-area-tag",
  "unit-attachment", "attachment-eligibility-inherit", "formation-attachment-grant", "replace-roll-from-pool", "firing-deck", "movement-modifier"]);

/** A legacy movement-modifier: a move made now, a change to how moves work, or a set-up. */
export function migrateMovement(e: Node, ctx: EffectContext & { ruleText?: string }): Outcome {
  const m = (e.modifier ?? {}) as Node;
  const target = targetRef(e.target, ctx);
  if (target === null) return { review: `target ${String(e.target)}` };
  const extra = Object.keys(e).filter((k) => !["type", "target", "modifier"].includes(k));
  if (extra.length) return { review: `movement keys ${extra.join(", ")}` };
  const known = ["move_type", "distance", "to_reserves", "passthrough", "ignore_vertical", "replaces_default", "applies_to_moves"];
  const stray = Object.keys(m).filter((k) => !known.includes(k));
  if (stray.length) return { review: `movement-modifier: keys ${stray.join(", ")}` };
  const mt = m.move_type as string | undefined;
  if (m.to_reserves === true) return { node: node("set-up", target, { to: "strategic-reserves" }) };
  if (mt === "redeploy") return { node: node("set-up", target, { to: "battlefield", from: "battlefield" }) };
  if (mt === "infiltrate") return { node: node("ability-grant", target, { ability: "infiltrators" }) };
  if (mt == null) {
    const out: Node = {};
    if (m.applies_to_moves) out.applies_to_moves = m.applies_to_moves;
    if (m.passthrough) out.passthrough = m.passthrough;
    if (m.ignore_vertical) out.ignore_vertical = true;
    if (m.distance != null) out.distance_bonus = dice(m.distance) ?? m.distance;
    return Object.keys(out).length ? { node: node("move-modifier", target, out) } : { review: "movement-modifier: empty" };
  }
  // Scouts is an ability; an Advance distance is a bonus to the roll, or (at 6") no roll at all.
  if (mt === "scout") return { node: node("ability-grant", target, { ability: "scouts", ...(m.distance != null ? { value: m.distance } : {}) }) };
  if (mt === "advance" && m.distance != null) {
    if (m.distance === 6 && /do not make an advance roll/.test((ctx.ruleText ?? "").toLowerCase())) return { node: node("move-modifier", target, { advance: "fixed-6" }) };
    return { node: node("roll-modifier", target, { roll: "advance", operation: "add", value: dice(m.distance) ?? m.distance }) };
  }
  if (mt === "normal" && typeof m.distance === "number" && m.distance < 0 && !m.applies_to_moves)
    return { node: node("stat-modifier", target, { stat: "M", operation: "subtract", value: -m.distance }) };
  if (mt === "normal" && m.applies_to_moves) {
    const out: Node = { applies_to_moves: m.applies_to_moves, distance_bonus: dice(m.distance) ?? m.distance };
    if (m.passthrough) out.passthrough = m.passthrough;
    return { node: node("move-modifier", target, out) };
  }
  let moveType = mt;
  if (mt === "reactive" || mt === "shoot-and-scoot") {
    const text = (ctx.ruleText ?? "").toLowerCase();
    if (text.includes("surge move")) moveType = "surge";
    else if (text.includes("normal move") || mt === "shoot-and-scoot") moveType = "normal";
    else return { review: `movement-modifier: ${mt} move is neither a surge nor a Normal move in the rule text` };
  }
  const out: Node = { move_type: moveType };
  if (m.distance != null) {
    const d = dice(m.distance);
    if (d === null) return { review: `movement-modifier: distance ${String(m.distance)}` };
    out.distance = d;
  }
  if (m.passthrough) out.passthrough = m.passthrough;
  return { node: node("move", target, out) };
}

const CORE_GRANTS: Record<string, [string, number?]> = {
  "lone-operative": ["lone-operative"], infiltrators: ["infiltrators"], stealth: ["stealth"], Stealth: ["stealth"], "deep-strike": ["deep-strike"],
  "scouts-6": ["scouts", 6], "scouts-7": ["scouts", 7], "scouts-8": ["scouts", 8], "deep-strike-6": ["deep-strike"],
};

/** A legacy grant_type the classification placed by rule; anything else goes to review. */
function grantType(g: string, m: Node, target: unknown): Outcome {
  const rest = Object.keys(m).filter((k) => k !== "grant_type");
  const only = (...a: string[]) => rest.every((k) => a.includes(k));
  const perm = (activity: string, after: string[]) => node("permission", target, { activity, allow: true, after });
  if (CORE_GRANTS[g] && rest.length === 0) {
    const [ability, value] = CORE_GRANTS[g]!;
    return { node: node("ability-grant", target, { ability, ...(value != null ? { value } : {}) }) };
  }
  switch (g) {
    case "charge-after-advance":
      if (only()) return { node: perm("declare-charge", ["advance"]) };
      break;
    case "charge-after-fall-back":
      if (only()) return { node: perm("declare-charge", ["fall-back"]) };
      break;
    case "act-after-move":
      if (only("moves", "acts") && Array.isArray(m.moves) && Array.isArray(m.acts)) {
        const steps = (m.acts as string[]).map((a) => perm(a === "charge" ? "declare-charge" : a, m.moves as string[]));
        return { node: steps.length === 1 ? steps[0]! : { type: "sequence", steps } };
      }
      break;
    case "shoot-as-if-shooting-phase":
      if (only()) return { node: node("permission", target, { activity: "shoot", allow: true, as_if: "shooting-phase" }) };
      break;
    case "ingress-move":
    case "perform-ingress-move":
      if (only()) return { node: node("move", target, { move_type: "ingress" }) };
      break;
    case "place-into-strategic-reserves":
    case "enter-strategic-reserves":
      if (only()) return { node: node("set-up", target, { to: "strategic-reserves" }) };
      break;
    case "heal-wounds":
      if (only("amount")) return { node: node("heal", target, { amount: dice(m.amount) ?? m.amount }) };
      break;
    case "detection-range-modifier":
      if (only("value")) return { node: node("stat-modifier", target, { stat: "detection-range", operation: "add", value: m.value }) };
      break;
    case "reactive-charge":
      if (only()) return { node: node("move", target, { move_type: "charge" }) };
      break;
    case "advance-6-instead-of-roll":
    case "advance-roll-set-to-six":
    case "no-advance-roll":
      if (only()) return { node: node("move-modifier", target, { advance: "fixed-6" }) };
      break;
    case "battle-shock-test":
    case "take-battle-shock-test":
    case "forced-battle-shock-roll":
      if (only()) return { node: node("test", target, { test: "battle-shock" }) };
      break;
    case "remove-battle-shock":
    case "remove-battle-shocked-status":
      if (only()) return { node: node("state-change", target, { state: "battle-shocked", set: false }) };
      break;
    case "becomes-battle-shocked":
    case "apply-battle-shock":
    case "battle-shocked-status":
      if (only()) return { node: node("state-change", target, { state: "battle-shocked", set: true }) };
      break;
    case "reroll-advance":
    case "re-roll-advance":
      if (only()) return { node: node("re-roll", target, { roll: "advance", result_scope: "any-result" }) };
      break;
  }
  return { review: `ability-grant: grant_type ${g}` };
}
