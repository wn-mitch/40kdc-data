/**
 * Translate a weapon-keyword catalog entry into the Buff stack it contributes
 * for a given reference-site parameter set and engine context.
 *
 * Two paths converge here:
 *
 * 1. **DSL walk**, for keywords whose catalog `effect` is non-null
 *    (`twin-linked`, `heavy`). The walker handles a deliberately small subset
 *    of nodes — `re-roll`, `roll-modifier`, `conditional`-on-the-conditions
 *    the engine knows about — and produces `Buff`s with
 *    `source.kind = "weapon-keyword"`.
 *
 * 2. **Id dispatch**, for the eight rules whose catalog `effect` is null
 *    because the DSL has no primitive for them yet — `lethal-hits`,
 *    `sustained-hits`, `devastating-wounds`, `anti`, `melta`, `rapid-fire`,
 *    `torrent`, `ignores-cover`. These are surfaced as `extra-keyword` buffs
 *    so the engine can read them out of `ResolvedModifiers.extraKeywords`
 *    and dispatch its math directly.
 *
 * Unrecognised nodes drop silently in M1 — diagnostic surfacing belongs to
 * M2's broader ability translator.
 */
import type { Buff, BuffSource, EngineContext, WeaponKeywordRef } from "./buffs.js";

/** Keywords whose math the engine encodes directly (catalog `effect` is null). */
const ENGINE_DISPATCH_KEYWORDS = new Set([
  "lethal-hits",
  "sustained-hits",
  "devastating-wounds",
  "anti",
  "melta",
  "rapid-fire",
  "torrent",
  "ignores-cover",
]);

/**
 * Convert a single weapon-keyword reference (catalog effect + reference-site
 * parameters) into the buff contributions it makes against `context`.
 */
export function buffsFromKeyword(args: {
  keywordId: string;
  weaponId: string;
  effect: unknown;
  parameters?: Record<string, unknown>;
  context: EngineContext;
}): Buff[] {
  const source: BuffSource = {
    kind: "weapon-keyword",
    weaponId: args.weaponId,
    keywordId: args.keywordId,
  };

  if (ENGINE_DISPATCH_KEYWORDS.has(args.keywordId)) {
    const ref: WeaponKeywordRef = {
      keyword_id: args.keywordId,
      ...(args.parameters !== undefined ? { parameters: args.parameters } : {}),
    };
    return [{ source, contribution: { type: "extra-keyword", keywordRef: ref } }];
  }

  if (args.effect === null || args.effect === undefined) return [];
  return walk(args.effect, source, args.context);
}

function walk(node: unknown, source: BuffSource, ctx: EngineContext): Buff[] {
  if (!isObject(node)) return [];
  const type = node.type;

  switch (type) {
    case "re-roll":
      return rerollBuffs(node, source);
    case "roll-modifier":
      return rollModifierBuffs(node, source);
    case "feel-no-pain":
      return feelNoPainBuffs(node, source);
    case "keyword-grant":
      return keywordGrantBuffs(node, source);
    case "conditional":
      return conditionalBuffs(node, source, ctx);
    case "sequence":
      return walkChildren((node as { steps?: unknown[] }).steps, source, ctx);
    default:
      return [];
  }
}

function walkChildren(children: unknown[] | undefined, source: BuffSource, ctx: EngineContext): Buff[] {
  if (!Array.isArray(children)) return [];
  const out: Buff[] = [];
  for (const child of children) out.push(...walk(child, source, ctx));
  return out;
}

function rerollBuffs(node: Record<string, unknown>, source: BuffSource): Buff[] {
  const modifier = node.modifier;
  if (!isObject(modifier)) return [];
  const roll = modifier.roll;
  const subset = modifier.subset;
  if (
    (roll === "hit" || roll === "wound" || roll === "save" || roll === "damage") &&
    (subset === "ones" || subset === "all-failures")
  ) {
    return [{ source, contribution: { type: "reroll", roll, subset } }];
  }
  return [];
}

function rollModifierBuffs(node: Record<string, unknown>, source: BuffSource): Buff[] {
  const modifier = node.modifier;
  if (!isObject(modifier)) return [];
  const operation = modifier.operation;
  if (operation !== "add") return []; // M1 supports additive only; multiplicative effects are out of scope.
  const value = typeof modifier.value === "number" ? modifier.value : NaN;
  if (!Number.isFinite(value)) return [];
  const roll = modifier.roll;
  switch (roll) {
    case "hit":
      return [{ source, contribution: { type: "hit-mod", value } }];
    case "wound":
      return [{ source, contribution: { type: "wound-mod", value } }];
    case "save":
      return [{ source, contribution: { type: "save-mod", value } }];
    case "damage":
      return [{ source, contribution: { type: "damage-mod", value } }];
    default:
      return [];
  }
}

function feelNoPainBuffs(node: Record<string, unknown>, source: BuffSource): Buff[] {
  const modifier = node.modifier;
  if (!isObject(modifier)) return [];
  const threshold = typeof modifier.threshold === "number" ? modifier.threshold : NaN;
  if (!Number.isFinite(threshold)) return [];
  return [{ source, contribution: { type: "feel-no-pain", threshold } }];
}

function keywordGrantBuffs(node: Record<string, unknown>, source: BuffSource): Buff[] {
  const modifier = node.modifier;
  if (!isObject(modifier)) return [];
  const id = modifier.keyword_id ?? modifier.id;
  if (typeof id !== "string" || id === "") return [];
  const params = isObject(modifier.parameters) ? modifier.parameters : undefined;
  const ref: WeaponKeywordRef = {
    keyword_id: id,
    ...(params !== undefined ? { parameters: params } : {}),
  };
  return [{ source, contribution: { type: "extra-keyword", keywordRef: ref } }];
}

function conditionalBuffs(
  node: Record<string, unknown>,
  source: BuffSource,
  ctx: EngineContext,
): Buff[] {
  const condition = node.condition;
  const effect = node.effect;
  if (!isObject(condition)) return [];
  const negated = condition.negated === true;
  const verdict = evaluateCondition(condition, ctx);
  if (verdict === "unknown") return [];
  const active = negated ? !verdict : verdict;
  if (!active) return [];
  return walk(effect, source, ctx);
}

/**
 * Returns true/false when the engine can evaluate the condition against
 * `ctx`; "unknown" when the condition references state the M1 engine has no
 * channel for (the buff is then dropped — M2's diagnostic surface owns the
 * "cannot auto-apply" reporting).
 */
function evaluateCondition(
  condition: Record<string, unknown>,
  ctx: EngineContext,
): boolean | "unknown" {
  switch (condition.type) {
    case "remained-stationary":
      return ctx.attackerStationary === true;
    case "target-has-keyword": {
      const parameters = isObject(condition.parameters) ? condition.parameters : {};
      const kw = parameters.keyword;
      if (typeof kw !== "string") return "unknown";
      return (ctx.targetKeywords ?? []).includes(kw.toLowerCase());
    }
    default:
      return "unknown";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
