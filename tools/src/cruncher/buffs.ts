/**
 * The flat `Buff` type every contribution flows through, and the
 * {@link resolveBuffs} resolver that collapses a stack into a
 * {@link ResolvedModifiers} read-out the engine can consume.
 *
 * The same shape carries weapon-keyword effects, ability buffs, stratagem
 * effects, and manual UI toggles — reroll-stacking, hit/wound caps, and
 * feel-no-pain-best-threshold all fall out of one resolver rather than each
 * source kind reinventing precedence.
 *
 * @packageDocumentation
 */
import type { Phase } from "../generated.js";

/** Where a buff originated. Drives stable tie-breaking inside `resolveBuffs`. */
export type BuffSource =
  | { kind: "weapon-keyword"; weaponId: string; keywordId: string }
  | {
      kind: "ability";
      abilityId: string;
      abilityKind:
        | "army"
        | "detachment"
        | "detachment-stratagem"
        | "unit"
        | "attached"
        | "support";
      /**
       * For `abilityKind: "attached"`, the combined-unit member the ability
       * came from (so the UI can name it and show its leader/bodyguard role).
       * Absent for other kinds.
       */
      sourceUnitId?: string;
    }
  | { kind: "manual"; label: string };

/** A weapon-keyword reference (id + parameter map), as found on weapon profiles. */
export type WeaponKeywordRef = {
  keyword_id: string;
  parameters?: Record<string, unknown>;
};

/** One typed contribution; the engine reads `ResolvedModifiers` for the rest. */
export type BuffContribution =
  | { type: "hit-mod"; value: number }
  | { type: "wound-mod"; value: number }
  | { type: "save-mod"; value: number }
  | { type: "cover" }
  | {
      type: "reroll";
      roll: "hit" | "wound" | "save" | "damage";
      subset: "ones" | "all-failures";
    }
  | { type: "extra-keyword"; keywordRef: WeaponKeywordRef }
  /**
   * Feel-no-pain: roll one D6 per unsaved wound at `threshold`+, ignoring the
   * wound on a pass. `scope` controls which wound stream it applies to:
   *  - `"all"` (default): every unsaved wound (main + mortal).
   *  - `"mortal"`: mortal-wound stream only (e.g. Death Guard 5+ FNP vs
   *    mortals). A target may carry both an all-FNP and a mortal-FNP; the
   *    engine rolls both against mortals.
   */
  | { type: "feel-no-pain"; threshold: number; scope?: "all" | "mortal" }
  | { type: "damage-mod"; value: number }
  /** Additive modifier to the attacker's per-model attack count (A stat). */
  | { type: "attacks-mod"; value: number }
  /** Additive modifier to the attacker's Strength stat. */
  | { type: "strength-mod"; value: number }
  /** Additive modifier to the defender's Toughness stat. */
  | { type: "toughness-mod"; value: number }
  /**
   * Additive modifier to the attacker's weapon AP. AP is signed against the
   * defender's save (negative = more piercing), so a value of `-1` here makes
   * the weapon one AP more piercing.
   */
  | { type: "ap-mod"; value: number }
  /**
   * Defender-side: subtract `value` from each unsaved damage point (floored at
   * 1 by the engine). Multiple sources do NOT stack in 10e — the largest
   * reduction wins. The corpus also encodes `"half"` and `"to-zero"`
   * reductions; the buff layer only models the additive form because the
   * other two are typically one-use ablation that doesn't fold into the
   * expected-value math cleanly.
   */
  | { type: "damage-reduction"; value: number }
  /**
   * Defender-side: ability-granted invulnerable save threshold (e.g. a buff
   * that grants a 4+ invuln). Best (lowest) threshold wins; the engine then
   * picks the better of `printed Sv after AP/cover` and `effective invuln`
   * (invuln bypasses both AP and cover).
   */
  | { type: "invulnerable-save"; threshold: number };

/** Optional gating; the resolver drops buffs whose gate fails. */
export type BuffApplicability = {
  phases?: Phase[];
  rollType?: "hit" | "wound" | "save" | "damage";
  /** Target must carry this keyword (case-insensitive). */
  requiresTargetKeyword?: string;
  /** Attacker must carry this keyword (case-insensitive). */
  requiresAttackerKeyword?: string;
  /**
   * Range-gated abilities (DSL `scope.range_inches`, e.g. a "within 18\"" reroll):
   * the buff applies only when the target is within this many inches. Gate is
   * permissive when the caller leaves `EngineContext.distanceInches` undefined,
   * so callers that don't track distance keep their current behavior.
   */
  maxRangeInches?: number;
};

/** A single buff: where it came from, when it applies, what it contributes. */
export type Buff = {
  source: BuffSource;
  applicableWhen?: BuffApplicability;
  contribution: BuffContribution;
};

/**
 * Shared engine context. Carries the phase plus a few attacker/target flags
 * the keyword translator and the resolver both need. The engine fills it from
 * its `EngineInput.context` plus the unit-keyword unions; the resolver reads
 * only the subset relevant to its `applicableWhen` checks.
 */
export type EngineContext = {
  phase: Phase;
  /** Attacker has not moved this turn — Heavy fires its +1 to hit. */
  attackerStationary?: boolean;
  /**
   * Attacker made a charge move this turn — drives the `charged-this-turn`
   * condition (e.g. World Eaters' Relentless Rage). Left undefined when the
   * caller can't determine it — the condition then evaluates as `"unknown"` and
   * the SPA surfaces a diagnostic (mirrors `attackerStationary` / `timing`).
   */
  attackerCharged?: boolean;
  /** Within half the weapon's range — Melta / Rapid Fire fire. */
  withinHalfRange?: boolean;
  /**
   * Distance to the target in inches. Drives `applicableWhen.maxRangeInches`
   * for range-gated abilities. Undefined when the caller doesn't track distance
   * — range gates then evaluate permissively (the buff applies).
   */
  distanceInches?: number;
  /** Attacker benefits from cover (mostly informational; cover applies to defenders). */
  attackerInCover?: boolean;
  /** Target is in cover — the resolver flips on `cover`, the engine applies +1 to save. */
  targetInCover?: boolean;
  /** Attacker keywords (union of unit.keywords + faction_keywords), lower-cased. */
  attackerKeywords?: ReadonlyArray<string>;
  /** Target keywords (union of unit.keywords + faction_keywords), lower-cased. */
  targetKeywords?: ReadonlyArray<string>;
  /**
   * Sub-phase timing flag (e.g. `"start-of-phase"`, `"end-of-phase"`,
   * `"on-destroyed"`). Consumed by the `timing-is` condition. Left undefined
   * when the caller can't pin a sub-phase down — the condition then evaluates
   * as `"unknown"` and the SPA surfaces a diagnostic.
   */
  timing?: string;
  /**
   * The buffed unit is part of a combined ("attached") unit — a leader is
   * attached to a bodyguard, or vice-versa. Drives the `is-attached` and
   * `model-is-leader` conditions. Derived from a non-empty
   * `EligibilityInput.attachedUnitIds`. Left undefined when the caller can't
   * determine attachment — the conditions then evaluate as `"unknown"` and the
   * SPA surfaces a diagnostic (mirrors how `timing` undefined behaves).
   */
  attackerAttached?: boolean;
};

/** Back-compat alias — `resolveBuffs` accepts the shared engine context. */
export type ResolveContext = EngineContext;

/** Read-out of a resolved buff stack, with provenance per field. */
export type ResolvedModifiers = {
  hitMod: { value: number; dominantSource: BuffSource | null };
  woundMod: { value: number; dominantSource: BuffSource | null };
  saveMod: { value: number; sources: BuffSource[] };
  cover: { active: boolean; source: BuffSource | null };
  rerolls: Partial<
    Record<
      "hit" | "wound" | "save" | "damage",
      { subset: "ones" | "all-failures"; dominantSource: BuffSource }
    >
  >;
  extraKeywords: { keywordRef: WeaponKeywordRef; source: BuffSource }[];
  /** All-wound FNP — fires on the main and mortal damage streams alike. */
  feelNoPain: { threshold: number; dominantSource: BuffSource } | null;
  /** Mortal-only FNP — fires only on the mortal-wound damage stream. */
  feelNoPainMortal: { threshold: number; dominantSource: BuffSource } | null;
  damageMod: { value: number; sources: BuffSource[] };
  attacksMod: { value: number; sources: BuffSource[] };
  strengthMod: { value: number; sources: BuffSource[] };
  toughnessMod: { value: number; sources: BuffSource[] };
  apMod: { value: number; sources: BuffSource[] };
  /**
   * Defender-side damage reduction. Highest-wins (multiple sources do not
   * stack in 10e); the dominant source is the one whose value matches the
   * surviving reduction.
   */
  damageReduction: { value: number; dominantSource: BuffSource | null };
  /**
   * Ability-granted invulnerable save. Best (lowest) threshold wins. `null`
   * when no ability granted one; the engine still uses the unit's printed
   * `invuln_sv` from the profile in that case.
   */
  invulnerable: { threshold: number; dominantSource: BuffSource } | null;
};

/** Stable ordering used to break ties when multiple buffs claim the same field. */
const SOURCE_KIND_RANK: Record<string, number> = {
  "ability:army": 0,
  "ability:detachment": 1,
  "ability:detachment-stratagem": 2,
  "ability:unit": 3,
  "ability:attached": 4,
  "ability:support": 5,
  manual: 6,
  "weapon-keyword": 7,
};

function rank(s: BuffSource): number {
  if (s.kind === "ability") return SOURCE_KIND_RANK[`ability:${s.abilityKind}`] ?? 99;
  return SOURCE_KIND_RANK[s.kind] ?? 99;
}

function applies(buff: Buff, ctx: ResolveContext): boolean {
  const w = buff.applicableWhen;
  if (!w) return true;
  if (w.phases && w.phases.length > 0 && !w.phases.includes(ctx.phase)) return false;
  if (w.rollType && buff.contribution.type === "reroll" && buff.contribution.roll !== w.rollType) {
    return false;
  }
  if (w.requiresTargetKeyword) {
    const target = ctx.targetKeywords ?? [];
    if (!target.includes(w.requiresTargetKeyword.toLowerCase())) return false;
  }
  if (w.requiresAttackerKeyword) {
    const attacker = ctx.attackerKeywords ?? [];
    if (!attacker.includes(w.requiresAttackerKeyword.toLowerCase())) return false;
  }
  // Range gate: drop only when the distance is known and exceeds the ability's
  // range. Unknown distance is permissive (preserves callers that don't track it).
  if (
    w.maxRangeInches !== undefined &&
    ctx.distanceInches !== undefined &&
    ctx.distanceInches > w.maxRangeInches
  ) {
    return false;
  }
  return true;
}

/**
 * Collapse a flat buff stack into a {@link ResolvedModifiers} read-out. Pure
 * function; the engine — and any UI that wants to render the resolved table
 * before crunching — both go through this.
 */
export function resolveBuffs(buffs: Buff[], ctx: ResolveContext): ResolvedModifiers {
  const live = buffs.filter((b) => applies(b, ctx));

  const out: ResolvedModifiers = {
    hitMod: { value: 0, dominantSource: null },
    woundMod: { value: 0, dominantSource: null },
    saveMod: { value: 0, sources: [] },
    cover: { active: false, source: null },
    rerolls: {},
    extraKeywords: [],
    feelNoPain: null,
    feelNoPainMortal: null,
    damageMod: { value: 0, sources: [] },
    attacksMod: { value: 0, sources: [] },
    strengthMod: { value: 0, sources: [] },
    toughnessMod: { value: 0, sources: [] },
    apMod: { value: 0, sources: [] },
    damageReduction: { value: 0, dominantSource: null },
    invulnerable: null,
  };

  // Hit / wound mods: sum, then cap at ±1, with dominant source picked from
  // the contributors whose sign matches the surviving value.
  const hitContribs: { value: number; source: BuffSource }[] = [];
  const woundContribs: { value: number; source: BuffSource }[] = [];

  for (const b of live) {
    const c = b.contribution;
    switch (c.type) {
      case "hit-mod":
        hitContribs.push({ value: c.value, source: b.source });
        break;
      case "wound-mod":
        woundContribs.push({ value: c.value, source: b.source });
        break;
      case "save-mod":
        out.saveMod.value += c.value;
        out.saveMod.sources.push(b.source);
        break;
      case "cover":
        if (!out.cover.active || rank(b.source) < rank(out.cover.source!)) {
          out.cover = { active: true, source: b.source };
        }
        break;
      case "reroll": {
        const cur = out.rerolls[c.roll];
        const incoming = c.subset;
        if (!cur) {
          out.rerolls[c.roll] = { subset: incoming, dominantSource: b.source };
        } else {
          const incomingStronger =
            (incoming === "all-failures" && cur.subset === "ones") ||
            (incoming === cur.subset && rank(b.source) < rank(cur.dominantSource));
          if (incomingStronger) {
            out.rerolls[c.roll] = { subset: incoming, dominantSource: b.source };
          }
        }
        break;
      }
      case "extra-keyword": {
        const key = `${c.keywordRef.keyword_id}::${JSON.stringify(c.keywordRef.parameters ?? {})}`;
        if (!out.extraKeywords.some((e) => keyOf(e.keywordRef) === key)) {
          out.extraKeywords.push({ keywordRef: c.keywordRef, source: b.source });
        }
        break;
      }
      case "feel-no-pain": {
        // Best (lowest) threshold wins per scope. An undeclared scope is
        // treated as "all" — that's the existing convention (unscoped FNP =
        // applies to every wound) and keeps every shipped FNP buff regression-safe.
        const scope = c.scope ?? "all";
        const slot = scope === "mortal" ? "feelNoPainMortal" : "feelNoPain";
        if (out[slot] === null || c.threshold < out[slot]!.threshold) {
          out[slot] = { threshold: c.threshold, dominantSource: b.source };
        }
        break;
      }
      case "damage-mod":
        out.damageMod.value += c.value;
        out.damageMod.sources.push(b.source);
        break;
      case "attacks-mod":
        out.attacksMod.value += c.value;
        out.attacksMod.sources.push(b.source);
        break;
      case "strength-mod":
        out.strengthMod.value += c.value;
        out.strengthMod.sources.push(b.source);
        break;
      case "toughness-mod":
        out.toughnessMod.value += c.value;
        out.toughnessMod.sources.push(b.source);
        break;
      case "ap-mod":
        out.apMod.value += c.value;
        out.apMod.sources.push(b.source);
        break;
      case "damage-reduction":
        // Highest reduction wins (no stacking). Ties break by source rank so
        // an ability source is preferred over a manual one for provenance
        // purposes; either way the resolved value is unchanged.
        if (
          out.damageReduction.dominantSource === null ||
          c.value > out.damageReduction.value ||
          (c.value === out.damageReduction.value &&
            rank(b.source) < rank(out.damageReduction.dominantSource))
        ) {
          out.damageReduction = { value: c.value, dominantSource: b.source };
        }
        break;
      case "invulnerable-save":
        // Best (lowest threshold) wins. Same tie-break by source rank.
        if (
          out.invulnerable === null ||
          c.threshold < out.invulnerable.threshold ||
          (c.threshold === out.invulnerable.threshold &&
            rank(b.source) < rank(out.invulnerable.dominantSource))
        ) {
          out.invulnerable = { threshold: c.threshold, dominantSource: b.source };
        }
        break;
    }
  }

  out.hitMod = capModifier(hitContribs);
  out.woundMod = capModifier(woundContribs);

  return out;
}

function keyOf(ref: WeaponKeywordRef): string {
  return `${ref.keyword_id}::${JSON.stringify(ref.parameters ?? {})}`;
}

/** Sum, clamp to ±1, then pick the dominant contributing source by rank. */
function capModifier(
  contribs: { value: number; source: BuffSource }[],
): { value: number; dominantSource: BuffSource | null } {
  if (contribs.length === 0) return { value: 0, dominantSource: null };
  const sum = contribs.reduce((a, c) => a + c.value, 0);
  const capped = Math.max(-1, Math.min(1, sum));
  if (capped === 0) return { value: 0, dominantSource: null };
  const sign = Math.sign(capped);
  const matching = contribs.filter((c) => Math.sign(c.value) === sign);
  matching.sort((a, b) => rank(a.source) - rank(b.source));
  return { value: capped, dominantSource: matching[0]?.source ?? null };
}
