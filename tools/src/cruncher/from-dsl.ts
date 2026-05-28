/**
 * Translate an Ability DSL `effect` tree into the {@link Buff} stack it
 * contributes (for an attacker-perspective crunch) along with a list of
 * effect fragments the translator could not auto-apply.
 *
 * The buff layer is intentionally a subset of the DSL: it covers the math the
 * cruncher's expected-value engine reads (rerolls, die-roll modifiers, S/A/T
 * stat shifts, FNP, granted weapon keywords, cover) and reports everything
 * else — choice nodes (player decisions), dice-gated effects (stochastic),
 * defender-side bs-modifier, attack-restrictions, ability grants, mortal
 * wound triggers — as `unsupported` so the SPA can surface "this ability has
 * effects we can't auto-apply" rather than silently dropping them.
 *
 * The walker classifies an effect's `target` against the attacker
 * perspective: `self`, `bearer`, `unit`, `attached-unit`, `attacker`, and
 * `friendly-within-aura` are all treated as "applies to my unit". `defender`,
 * `enemy-within-aura`, and `all-enemy` are dropped without being marked
 * unsupported — those are defender-side mods and would surface from the
 * target's perspective (M3 work), not the attacker's.
 *
 * @packageDocumentation
 */
import type { Buff, BuffSource, EngineContext, WeaponKeywordRef } from "./buffs.js";

/** A fragment we couldn't translate. The SPA can render these as warnings. */
export type UnsupportedFragment = {
  reason: string;
  effectFragment: unknown;
};

export type EffectTranslation = {
  applied: Buff[];
  unsupported: UnsupportedFragment[];
};

/** Targets that apply to the attacker-perspective unit being crunched. */
const ATTACKER_PERSPECTIVE_TARGETS = new Set([
  "self",
  "bearer",
  "unit",
  "attached-unit",
  "attacker",
  "friendly-within-aura",
  "all-friendly",
]);

/** Targets we silently drop because they describe defender-side effects. */
const DEFENDER_PERSPECTIVE_TARGETS = new Set([
  "defender",
  "enemy-within-aura",
  "all-enemy",
]);

/**
 * Walk an ability DSL `effect` tree and produce the buff stack it contributes
 * against `context`, plus an `unsupported` list naming any branches the buff
 * layer can't express today.
 */
export function effectToBuffs(
  effect: unknown,
  source: BuffSource,
  context: EngineContext,
): EffectTranslation {
  const out: EffectTranslation = { applied: [], unsupported: [] };
  walk(effect, source, context, out);
  return out;
}

function walk(
  node: unknown,
  source: BuffSource,
  ctx: EngineContext,
  out: EffectTranslation,
): void {
  if (!isObject(node)) return;
  const type = node.type;
  switch (type) {
    case "re-roll":
      translateReroll(node, source, out);
      return;
    case "roll-modifier":
      translateRollModifier(node, source, out);
      return;
    case "stat-modifier":
      translateStatModifier(node, source, out);
      return;
    case "feel-no-pain":
      translateFeelNoPain(node, source, out);
      return;
    case "keyword-grant":
      translateKeywordGrant(node, source, out);
      return;
    case "conditional":
      translateConditional(node, source, ctx, out);
      return;
    case "sequence":
      for (const step of (node.steps as unknown[]) ?? []) walk(step, source, ctx, out);
      return;
    case "choice":
      // Player decision — auto-applying every branch would double-count.
      out.unsupported.push({
        reason: "choice: player picks one option; the buff layer can't choose",
        effectFragment: node,
      });
      return;
    case "dice-gated":
      // Probabilistic; the buff layer is deterministic. M2-out-of-scope.
      out.unsupported.push({
        reason: "dice-gated effect: stochastic; not expressible as a buff",
        effectFragment: node,
      });
      return;
    case "dice-pool-allocation":
      out.unsupported.push({
        reason: "dice-pool-allocation: player allocates dice at runtime",
        effectFragment: node,
      });
      return;
    case "bs-modifier":
      // A defender-side mod on incoming attacks (-1 to hit against this unit).
      // Drop it from attacker-perspective crunches; the M3 target side will
      // surface it from the opposing direction.
      out.unsupported.push({
        reason: "bs-modifier: a defender-side hit penalty; applies when this unit is being shot at",
        effectFragment: node,
      });
      return;
    default:
      // Unknown effect — record it. Covers ability-grant, deep-strike,
      // mortal-wounds, cp-gain, movement-modifier, etc.; the buff layer
      // doesn't model these as deterministic mods to a single shot.
      out.unsupported.push({
        reason: `effect type "${String(type)}" is not modelled by the buff layer`,
        effectFragment: node,
      });
      return;
  }
}

// ---------------------------------------------------------------------------
// Leaf translators
// ---------------------------------------------------------------------------

function targetApplies(node: Record<string, unknown>): boolean {
  const target = node.target;
  if (typeof target !== "string") return false;
  if (DEFENDER_PERSPECTIVE_TARGETS.has(target)) return false;
  return ATTACKER_PERSPECTIVE_TARGETS.has(target);
}

function translateReroll(
  node: Record<string, unknown>,
  source: BuffSource,
  out: EffectTranslation,
): void {
  if (!targetApplies(node)) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({ reason: "re-roll: missing modifier object", effectFragment: node });
    return;
  }
  const roll = modifier.roll;
  const subset = modifier.subset;
  if (
    (roll === "hit" || roll === "wound" || roll === "save" || roll === "damage") &&
    (subset === "ones" || subset === "all-failures")
  ) {
    out.applied.push({ source, contribution: { type: "reroll", roll, subset } });
    return;
  }
  // Charge / advance / armour-pen rerolls aren't part of the damage math.
  out.unsupported.push({
    reason: `re-roll on "${String(roll)}" (subset "${String(subset)}") is outside the damage path`,
    effectFragment: node,
  });
}

function translateRollModifier(
  node: Record<string, unknown>,
  source: BuffSource,
  out: EffectTranslation,
): void {
  if (!targetApplies(node)) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "roll-modifier: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const value = signedValue(modifier);
  if (value === null) {
    out.unsupported.push({
      reason: `roll-modifier: operation "${String(modifier.operation)}" not supported`,
      effectFragment: node,
    });
    return;
  }
  const roll = modifier.roll;
  switch (roll) {
    case "hit":
      out.applied.push({ source, contribution: { type: "hit-mod", value } });
      return;
    case "wound":
      out.applied.push({ source, contribution: { type: "wound-mod", value } });
      return;
    case "save":
      out.applied.push({ source, contribution: { type: "save-mod", value } });
      return;
    case "damage":
      out.applied.push({ source, contribution: { type: "damage-mod", value } });
      return;
    default:
      out.unsupported.push({
        reason: `roll-modifier on "${String(roll)}" is outside the damage path`,
        effectFragment: node,
      });
  }
}

function translateStatModifier(
  node: Record<string, unknown>,
  source: BuffSource,
  out: EffectTranslation,
): void {
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "stat-modifier: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const value = signedValue(modifier);
  if (value === null) {
    out.unsupported.push({
      reason: `stat-modifier: operation "${String(modifier.operation)}" not supported`,
      effectFragment: node,
    });
    return;
  }
  const stat = modifier.stat;
  const isAttackerSide = targetApplies(node);
  switch (stat) {
    case "A":
      if (!isAttackerSide) return;
      out.applied.push({ source, contribution: { type: "attacks-mod", value } });
      return;
    case "S":
      if (!isAttackerSide) return;
      out.applied.push({ source, contribution: { type: "strength-mod", value } });
      return;
    case "T":
      // Toughness is a defender stat. If this ability's target is the
      // attacker-perspective unit (e.g. "+1 T to my unit"), the M2 crunch
      // doesn't read it — the unit is firing, not being shot at. Defer to M3.
      out.unsupported.push({
        reason: "stat-modifier T: defender-side stat; applies when the buffed unit is the target",
        effectFragment: node,
      });
      return;
    case "Sv":
      out.unsupported.push({
        reason: "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target",
        effectFragment: node,
      });
      return;
    default:
      out.unsupported.push({
        reason: `stat-modifier on "${String(stat)}" is outside the damage path`,
        effectFragment: node,
      });
  }
}

function translateFeelNoPain(
  node: Record<string, unknown>,
  source: BuffSource,
  out: EffectTranslation,
): void {
  // FNP applies when the buffed unit is the *target* (it ablates incoming
  // damage). For an attacker-perspective crunch, this is irrelevant — but the
  // target-perspective path (M3) will read the same buff list, so we still
  // emit it. Engines that only care about the attacker side can ignore the
  // `feelNoPain` field in `ResolvedModifiers`; M3 plumbs it through.
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "feel-no-pain: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const threshold = Number(modifier.threshold);
  if (!Number.isFinite(threshold)) {
    out.unsupported.push({
      reason: "feel-no-pain: threshold not numeric",
      effectFragment: node,
    });
    return;
  }
  out.applied.push({ source, contribution: { type: "feel-no-pain", threshold } });
}

function translateKeywordGrant(
  node: Record<string, unknown>,
  source: BuffSource,
  out: EffectTranslation,
): void {
  if (!targetApplies(node)) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) return;
  const keywords = modifier.keywords;
  if (!Array.isArray(keywords)) return;
  for (const raw of keywords) {
    if (typeof raw !== "string") continue;
    const ref = parseKeywordGrant(raw);
    if (!ref) {
      out.unsupported.push({
        reason: `keyword-grant: cannot parse "${raw}" to a catalog keyword`,
        effectFragment: { keyword: raw },
      });
      continue;
    }
    out.applied.push({ source, contribution: { type: "extra-keyword", keywordRef: ref } });
  }
}

function translateConditional(
  node: Record<string, unknown>,
  source: BuffSource,
  ctx: EngineContext,
  out: EffectTranslation,
): void {
  const condition = node.condition;
  const effect = node.effect;
  if (!isObject(condition)) return;
  const negated = condition.negated === true;
  const verdict = evaluateCondition(condition, ctx);
  if (verdict === "unknown") {
    out.unsupported.push({
      reason: `conditional: cannot evaluate condition "${String(condition.type)}" against current context`,
      effectFragment: node,
    });
    return;
  }
  const active = negated ? !verdict : verdict;
  if (!active) return;
  walk(effect, source, ctx, out);
}

// ---------------------------------------------------------------------------
// Condition evaluator
// ---------------------------------------------------------------------------

function evaluateCondition(
  condition: Record<string, unknown>,
  ctx: EngineContext,
): boolean | "unknown" {
  switch (condition.type) {
    case "phase-is": {
      const wanted = (condition.parameters as Record<string, unknown> | undefined)?.phase;
      if (typeof wanted !== "string") return "unknown";
      return ctx.phase === wanted;
    }
    case "remained-stationary":
      return ctx.attackerStationary === true;
    case "target-has-keyword": {
      const kw = (condition.parameters as Record<string, unknown> | undefined)?.keyword;
      if (typeof kw !== "string") return "unknown";
      return (ctx.targetKeywords ?? []).includes(kw.toLowerCase());
    }
    case "unit-has-keyword": {
      const kw = (condition.parameters as Record<string, unknown> | undefined)?.keyword;
      if (typeof kw !== "string") return "unknown";
      return (ctx.attackerKeywords ?? []).includes(kw.toLowerCase());
    }
    case "is-attached":
      // The resolver knows whether a leader is attached; absent that signal
      // here, treat as unknown so the SPA can surface the gap.
      return "unknown";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a signed numeric value out of a modifier `{operation, value}` pair.
 * "add"/"subtract" become the matching sign; "set" / "multiply" / etc. return
 * `null` (translator surfaces them as unsupported).
 */
function signedValue(modifier: Record<string, unknown>): number | null {
  const value = Number(modifier.value);
  if (!Number.isFinite(value)) return null;
  switch (modifier.operation) {
    case "add":
      return value;
    case "subtract":
      return -value;
    default:
      return null;
  }
}

/**
 * Parse a printed weapon-keyword string (e.g. `"Sustained Hits 1"`,
 * `"Anti-INFANTRY 4+"`, `"Lethal Hits"`) into a `{keyword_id, parameters?}`
 * catalog reference, or `null` if the form is unrecognised.
 *
 * Reverses the conventions baked into the M0 catalog: kebab-case ids,
 * trailing number → `value`, embedded keyword + threshold → `target_keyword`
 * + `threshold`.
 */
export function parseKeywordGrant(raw: string): WeaponKeywordRef | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Anti-X N+ → { anti, target_keyword: X, threshold: N }
  const antiMatch = /^anti-([A-Z][A-Z\s-]*)\s+(\d+)\+?$/i.exec(trimmed);
  if (antiMatch) {
    return {
      keyword_id: "anti",
      parameters: { target_keyword: antiMatch[1].trim(), threshold: Number(antiMatch[2]) },
    };
  }

  // "Lethal Hits", "Twin-linked", "Heavy" → kebab-case lookup, no params.
  // "Sustained Hits 1", "Rapid Fire 2", "Melta 2" → kebab-case + value.
  const valueMatch = /^(.+?)\s+(\d+)$/.exec(trimmed);
  if (valueMatch) {
    return {
      keyword_id: toKebabCase(valueMatch[1]),
      parameters: { value: Number(valueMatch[2]) },
    };
  }
  return { keyword_id: toKebabCase(trimmed) };
}

function toKebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
