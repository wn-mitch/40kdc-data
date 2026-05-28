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

/**
 * Whose perspective the translation runs from.
 *
 * - `"attacker"`: the buffed unit is *firing*. `target: "unit"/"self"` etc.
 *   become attacker-side mods (re-rolls, hit/wound mods, A/S shifts, granted
 *   keywords). `target: "defender"` is silently dropped — that's incoming
 *   penalty math relevant when the buffed unit is the *target*, surfaced via
 *   the `"target"` perspective instead.
 *
 * - `"target"`: the buffed unit is *being shot at*. Defensive mods on the
 *   buffed unit (`stat-modifier T`, `stat-modifier Sv`, `feel-no-pain`,
 *   `roll-modifier save`) become defender-side buffs. Conversely, attacker-
 *   only mods (re-rolls, hit/wound mods, A/S shifts) drop silently because
 *   they describe what the buffed unit does when *attacking*.
 *
 * The bs-modifier effect (a -1 to incoming hit rolls, e.g. Benefit of Cover)
 * becomes a `hit-mod` buff under target perspective so it stacks correctly
 * with attacker-side modifiers in the resolver's ±1 cap.
 */
export type TranslationPerspective = "attacker" | "target";

/** Targets that resolve to the buffed unit itself. */
const SELF_TARGETS = new Set([
  "self",
  "bearer",
  "unit",
  "attached-unit",
  "friendly-within-aura",
  "all-friendly",
]);

/** Aliases the DSL uses when a node specifically calls out "the attacker". */
const ATTACKER_TARGET = "attacker";
/** Aliases the DSL uses when a node specifically calls out "the defender". */
const DEFENDER_TARGETS = new Set(["defender", "enemy-within-aura", "all-enemy"]);

/**
 * Walk an ability DSL `effect` tree and produce the buff stack it contributes
 * against `context` from the given `perspective`, plus an `unsupported` list
 * naming any branches the buff layer can't express today.
 */
export function effectToBuffs(
  effect: unknown,
  source: BuffSource,
  context: EngineContext,
  perspective: TranslationPerspective = "attacker",
): EffectTranslation {
  const out: EffectTranslation = { applied: [], unsupported: [] };
  walk(effect, source, { context, perspective }, out);
  return out;
}

type WalkOpts = { context: EngineContext; perspective: TranslationPerspective };

function walk(
  node: unknown,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  if (!isObject(node)) return;
  const type = node.type;
  switch (type) {
    case "re-roll":
      translateReroll(node, source, opts, out);
      return;
    case "roll-modifier":
      translateRollModifier(node, source, opts, out);
      return;
    case "stat-modifier":
      translateStatModifier(node, source, opts, out);
      return;
    case "feel-no-pain":
      translateFeelNoPain(node, source, opts, out);
      return;
    case "keyword-grant":
      translateKeywordGrant(node, source, opts, out);
      return;
    case "bs-modifier":
      translateBsModifier(node, source, opts, out);
      return;
    case "conditional":
      translateConditional(node, source, opts, out);
      return;
    case "sequence":
      for (const step of (node.steps as unknown[]) ?? []) walk(step, source, opts, out);
      return;
    case "choice":
      // Player decision — auto-applying every branch would double-count.
      out.unsupported.push({
        reason: "choice: player picks one option; the buff layer can't choose",
        effectFragment: node,
      });
      return;
    case "dice-gated":
      // Probabilistic; the buff layer is deterministic.
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

/**
 * Classify a node's `target` field against the perspective we're translating
 * for. Returns:
 *  - `"self"`: the node targets the buffed unit (apply attacker-side or
 *    defender-side translation, depending on perspective + stat).
 *  - `"attacker"` / `"defender"`: the node targets the other party explicitly.
 *  - `"unknown"`: missing/malformed target.
 */
function classifyTarget(
  node: Record<string, unknown>,
): "self" | "attacker" | "defender" | "unknown" {
  const target = node.target;
  if (typeof target !== "string") return "unknown";
  if (target === ATTACKER_TARGET) return "attacker";
  if (DEFENDER_TARGETS.has(target)) return "defender";
  if (SELF_TARGETS.has(target)) return "self";
  return "unknown";
}

/**
 * Does this node's target match the buffed unit under the current
 * perspective? Used for symmetric roll/keyword translations where the same
 * effect is "self" in either direction.
 */
function appliesToBuffedUnit(
  node: Record<string, unknown>,
  perspective: TranslationPerspective,
): boolean {
  const cls = classifyTarget(node);
  if (cls === "self") return true;
  if (cls === "attacker") return perspective === "attacker";
  if (cls === "defender") return perspective === "target";
  return false;
}

function translateReroll(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  // Rerolls are inherently attacker-side (you re-roll your own hit/wound/
  // damage; save rerolls fire when *you* are the target). Apply only under
  // the matching perspective so a target-perspective walk doesn't grab the
  // attacker's reroll-failed-hits buff.
  if (opts.perspective === "attacker" && !appliesToBuffedUnit(node, "attacker")) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({ reason: "re-roll: missing modifier object", effectFragment: node });
    return;
  }
  const roll = modifier.roll;
  const subset = modifier.subset;
  // Under target perspective, only "save" rerolls fire on the buffed unit.
  if (opts.perspective === "target" && roll !== "save") return;
  if (
    (roll === "hit" || roll === "wound" || roll === "save" || roll === "damage") &&
    (subset === "ones" || subset === "all-failures")
  ) {
    out.applied.push({ source, contribution: { type: "reroll", roll, subset } });
    return;
  }
  out.unsupported.push({
    reason: `re-roll on "${String(roll)}" (subset "${String(subset)}") is outside the damage path`,
    effectFragment: node,
  });
}

function translateRollModifier(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
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
  // Each roll type is intrinsically on one side. Hit / wound / damage are
  // attacker-side; save is defender-side. The perspective decides whether the
  // buffed unit's `target` is the right party for that roll type.
  if (opts.perspective === "attacker") {
    if (!appliesToBuffedUnit(node, "attacker")) return;
    if (roll === "save") return; // saves apply to the defender, not the attacker.
  } else {
    // target perspective: only `save` rolls on the buffed unit fire here.
    if (roll !== "save") return;
    if (!appliesToBuffedUnit(node, "target")) return;
  }
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
  opts: WalkOpts,
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
  const isOnBuffedUnit = appliesToBuffedUnit(node, opts.perspective);
  switch (stat) {
    case "A":
      if (opts.perspective !== "attacker" || !isOnBuffedUnit) return;
      out.applied.push({ source, contribution: { type: "attacks-mod", value } });
      return;
    case "S":
      if (opts.perspective !== "attacker" || !isOnBuffedUnit) return;
      out.applied.push({ source, contribution: { type: "strength-mod", value } });
      return;
    case "T":
      // Defender stat. Only relevant under target perspective.
      if (opts.perspective !== "target") {
        out.unsupported.push({
          reason: "stat-modifier T: defender-side stat; applies when the buffed unit is the target",
          effectFragment: node,
        });
        return;
      }
      if (!isOnBuffedUnit) return;
      out.applied.push({ source, contribution: { type: "toughness-mod", value } });
      return;
    case "Sv":
      // Saves improve when the *defender* gets +Sv. A +1 to Sv in printed
      // rules means "improve the save by 1", which maps to a `save-mod` of
      // `-value` since save-mod is signed against the *needed roll*.
      // (Equivalent: a -1 Sv penalty is a +1 save-mod.) We translate
      // "Sv add 1" → save-mod -1 to keep the resolver's sign convention.
      if (opts.perspective !== "target") {
        out.unsupported.push({
          reason: "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target",
          effectFragment: node,
        });
        return;
      }
      if (!isOnBuffedUnit) return;
      out.applied.push({ source, contribution: { type: "save-mod", value: -value } });
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
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  // FNP applies when the buffed unit is the *target* — it ablates incoming
  // damage. Under attacker perspective the FNP is irrelevant (the unit is
  // firing, not taking damage). Drop silently rather than as `unsupported`
  // so attacker-perspective walks don't surface a spurious diagnostic for
  // every unit that happens to have a FNP rule.
  if (opts.perspective !== "target") return;
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
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  // Weapon-keyword grants ride with the attacker's profile (e.g. "your
  // weapons gain [Sustained Hits 1]"). Defender-perspective walks ignore
  // them — the keyword applies when the buffed unit fires, not when it's
  // shot at.
  if (opts.perspective !== "attacker") return;
  if (!appliesToBuffedUnit(node, "attacker")) return;
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

function translateBsModifier(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  // A bs-modifier on `target: "attacker"` is a defender-side rule: it
  // penalises *incoming* hit rolls (e.g. Benefit of Cover). Translate it
  // as a `hit-mod` buff under target perspective so the resolver's ±1 cap
  // composes with attacker-side mods.
  if (opts.perspective !== "target") return;
  const cls = classifyTarget(node);
  if (cls !== "attacker") return; // a bs-modifier on self wouldn't make sense.
  const modifier = node.modifier;
  if (!isObject(modifier)) return;
  const value = signedValue(modifier);
  if (value === null) return;
  out.applied.push({ source, contribution: { type: "hit-mod", value } });
}

function translateConditional(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const condition = node.condition;
  const effect = node.effect;
  if (!isObject(condition)) return;
  const negated = condition.negated === true;
  const verdict = evaluateCondition(condition, opts.context);
  if (verdict === "unknown") {
    out.unsupported.push({
      reason: `conditional: cannot evaluate condition "${String(condition.type)}" against current context`,
      effectFragment: node,
    });
    return;
  }
  const active = negated ? !verdict : verdict;
  if (!active) return;
  walk(effect, source, opts, out);
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
