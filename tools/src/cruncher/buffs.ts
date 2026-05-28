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
        | "leader"
        | "support";
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
  | { type: "feel-no-pain"; threshold: number }
  | { type: "damage-mod"; value: number };

/** Optional gating; the resolver drops buffs whose gate fails. */
export type BuffApplicability = {
  phases?: Phase[];
  rollType?: "hit" | "wound" | "save" | "damage";
  /** Target must carry this keyword (case-insensitive). */
  requiresTargetKeyword?: string;
  /** Attacker must carry this keyword (case-insensitive). */
  requiresAttackerKeyword?: string;
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
  /** Within half the weapon's range — Melta / Rapid Fire fire. */
  withinHalfRange?: boolean;
  /** Attacker benefits from cover (mostly informational; cover applies to defenders). */
  attackerInCover?: boolean;
  /** Target is in cover — the resolver flips on `cover`, the engine applies +1 to save. */
  targetInCover?: boolean;
  /** Attacker keywords (union of unit.keywords + faction_keywords), lower-cased. */
  attackerKeywords?: ReadonlyArray<string>;
  /** Target keywords (union of unit.keywords + faction_keywords), lower-cased. */
  targetKeywords?: ReadonlyArray<string>;
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
  feelNoPain: { threshold: number; dominantSource: BuffSource } | null;
  damageMod: { value: number; sources: BuffSource[] };
};

/** Stable ordering used to break ties when multiple buffs claim the same field. */
const SOURCE_KIND_RANK: Record<string, number> = {
  "ability:army": 0,
  "ability:detachment": 1,
  "ability:detachment-stratagem": 2,
  "ability:unit": 3,
  "ability:leader": 4,
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
    damageMod: { value: 0, sources: [] },
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
      case "feel-no-pain":
        if (out.feelNoPain === null || c.threshold < out.feelNoPain.threshold) {
          out.feelNoPain = { threshold: c.threshold, dominantSource: b.source };
        }
        break;
      case "damage-mod":
        out.damageMod.value += c.value;
        out.damageMod.sources.push(b.source);
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
