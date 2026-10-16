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
import type { Phase, WeaponKeywordRef } from "../generated.js";
export type { WeaponKeywordRef } from "../generated.js";
import { matchesUnitFilter } from "./unit-filter.js";
import type { RecipientSnapshot } from "./recipient-snapshots.js";
export type { RecipientSnapshot } from "./recipient-snapshots.js";

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
       * came from (so the UI can name it and show its leader/bodyguard role);
       * for `"support"`, the other unit that provides it. Absent for other kinds.
       */
      sourceUnitId?: string;
    }
  | { kind: "manual"; label: string };


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
  | { type: "invulnerable-save"; threshold: number }
  /** Attacker-side: an unmodified roll of `value`+ is a critical hit/wound. Lowest wins. */
  | { type: "crit-threshold"; roll: "hit" | "wound"; value: number }
  /**
   * Attacker-side: the attacker ignores every negative modifier to this roll (and, for hits, the
   * benefit of cover). Positive modifiers still apply.
   */
  | { type: "ignore-modifiers"; roll: "hit" | "wound" }
  /**
   * Attacker-side: improve the WS or BS characteristic by `value` (a characteristic change, so not
   * capped like a hit-roll modifier). The engine floors the characteristic at 2+.
   */
  | { type: "skill-mod"; stat: "WS" | "BS"; value: number }
  /** Defender-side: the Save characteristic becomes `value`+. Best (lowest) wins. */
  | { type: "save-characteristic"; value: number };

/** Optional gating; the resolver drops buffs whose gate fails. */
export type BuffApplicability = {
  phases?: Phase[];
  rollType?: "hit" | "wound" | "save" | "damage";
  /** Target must carry this keyword (case-insensitive). */
  requiresTargetKeyword?: string;
  /** Attacker must carry this keyword (case-insensitive). */
  requiresAttackerKeyword?: string;
  attackerFilter?: Record<string, unknown>;
  targetFilter?: Record<string, unknown>;
  /** Target must carry none of these keywords (case-insensitive). Permissive when the target's keywords are unknown. */
  excludedTargetKeywords?: string[];
  /**
   * Fixed-distance applicability lowered from canonical range predicates.
   * Requires a known target distance at or within this inclusive maximum;
   * absent distance does not establish eligibility.
   */
  maxRangeInches?: number;
  /**
   * Only attacks with the weapon of this name (lower case). Missing weapon context does not
   * establish a match; the engine always supplies its names.
   */
  weaponName?: string;
  /** Structured keyword selectors: inclusion matches any, exclusions reject any. */
  weaponKeywords?: WeaponKeywordRef[];
  excludedWeaponKeywords?: WeaponKeywordRef[];
  excludedWeaponName?: string;
  /** Additional conjunctive weapon predicates inherited from enclosing effects. */
  weaponRequirements?: BuffApplicability[];
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
   * for range-gated abilities. When absent, explicit maximum-range gates do
   * not match; buffs without such a gate are unaffected.
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
  /** Whether the attacking and defending unit are attached; this alone never establishes a role. */
  attackerAttached?: boolean;
  targetAttached?: boolean;
  /** The army's Army Faction id. Drives the `army-faction` condition; undefined leaves it "unknown". */
  armyFaction?: string;
  /** The battle size being played. Drives the `battle-size` condition; undefined leaves it "unknown". */
  battleSize?: "incursion" | "strike-force" | "onslaught";
  /**
   * The attacking unit is Guided (For the Greater Good: not an Observer, targeting a Spotted unit).
   * Drives the `guided` condition; undefined leaves it "unknown".
   */
  attackerGuided?: boolean;
  /**
   * Lower-cased names of the attacking weapon and its profile. Drives
   * `applicableWhen.weaponName`; missing names cannot satisfy a weapon-name gate.
   */
  weaponNames?: ReadonlyArray<string>;
  /**
   * Catalog IDs printed on the attacking weapon profile, sufficient for rating-agnostic
   * selectors. The engine also supplies parameter-bearing refs for rated selectors.
   */
  weaponKeywords?: ReadonlyArray<string>;
  /** Parameter-bearing printed keywords, needed for rated weapon selectors. */
  weaponKeywordRefs?: readonly WeaponKeywordRef[];
  attackerAttachmentRole?: "leader" | "bodyguard";
  targetAttachmentRole?: "leader" | "bodyguard";
  /** Actual per-member roles, used when a condition refers to the ability's source model. */
  attachmentRoles?: Readonly<Record<string, "leader" | "bodyguard">>;
  attackerUnitId?: string;
  targetUnitId?: string;
  battleRound?: number;
  /**
   * Caller-attested trigger-time recipient evidence, not current membership.
   * Each entry preserves the ability source/sourceUnitId, exact canonical
   * trigger and selector, selectionPath JSON pointer, perspective,
   * recipientUnitId, and selected result. Object-key order is immaterial;
   * array order and every supplied field matter. Callers provide live
   * event-time evidence and assert activation/equipment; no internal history
   * or clock is consulted. Missing, mismatched, or conflicting evidence is
   * unsupported; selected:false resolves to no effect. Parent trigger
   * identity remains distinct from unrelated effect guards.
   */
  recipientSnapshots?: readonly RecipientSnapshot[];
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
  /** Lowest critical threshold granted per roll; absent rolls crit on a 6. */
  critThresholds: Partial<Record<"hit" | "wound", { value: number; dominantSource: BuffSource }>>;
  /** Rolls whose negative modifiers the attacker ignores. */
  ignoreModifiers: Partial<Record<"hit" | "wound", { dominantSource: BuffSource }>>;
  /** Summed WS/BS characteristic improvements. */
  skillMod: Record<"WS" | "BS", { value: number; sources: BuffSource[] }>;
  /** Ability-set Save characteristic; `null` keeps the printed one. */
  saveCharacteristic: { value: number; dominantSource: BuffSource } | null;
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
  if (buff.contribution.type === "extra-keyword") {
    const parameters = buff.contribution.keywordRef.parameters;
    const required = parameters?.required_target_keywords_any;
    const excluded = parameters?.excluded_target_keywords;
    if ((required !== undefined || excluded !== undefined) && ctx.targetKeywords === undefined) return false;
    if (Array.isArray(required) && !required.some((keyword) => typeof keyword === "string" && ctx.targetKeywords?.includes(keyword.toLowerCase()))) return false;
    if (Array.isArray(excluded) && excluded.some((keyword) => typeof keyword === "string" && ctx.targetKeywords?.includes(keyword.toLowerCase()))) return false;
  }
  const w = buff.applicableWhen;
  if (!w) return true;
  if (w.attackerFilter && matchesUnitFilter(w.attackerFilter, ctx, "attacker", "enemy") !== true) return false;
  if (w.targetFilter && matchesUnitFilter(w.targetFilter, ctx, "target", "enemy") !== true) return false;
  if (w.phases && !w.phases.includes(ctx.phase)) return false;
  if (w.rollType && buff.contribution.type === "reroll" && buff.contribution.roll !== w.rollType) {
    return false;
  }
  if (w.requiresTargetKeyword) {
    const target = ctx.targetKeywords ?? [];
    if (!target.includes(w.requiresTargetKeyword.toLowerCase())) return false;
  }
  if (w.excludedTargetKeywords && ctx.targetKeywords) {
    const target = ctx.targetKeywords;
    if (w.excludedTargetKeywords.some((keyword) => target.includes(keyword.toLowerCase()))) return false;
  }
  if (w.requiresAttackerKeyword) {
    const attacker = ctx.attackerKeywords ?? [];
    if (!attacker.includes(w.requiresAttackerKeyword.toLowerCase())) return false;
  }
  // Unknown distance does not establish an explicit maximum-range predicate.
  if (
    w.maxRangeInches !== undefined &&
    (ctx.distanceInches === undefined || ctx.distanceInches > w.maxRangeInches)
  ) {
    return false;
  }
  if (w.weaponName !== undefined && !ctx.weaponNames?.includes(w.weaponName)) return false;
  if (w.excludedWeaponName !== undefined && (ctx.weaponNames === undefined || ctx.weaponNames.includes(w.excludedWeaponName))) return false;
  return true;
}

/**
 * The buffs whose gates hold. A weapon-keyword gate reads the weapon's printed keywords plus the
 * keywords other live buffs grant, so one pass is repeated until no further gated buff joins
 * ("weapons with Lethal Hits gain Rapid Fire 1" sees a granted Lethal Hits).
 */
function liveBuffs(buffs: Buff[], ctx: ResolveContext): Buff[] {
  const base = buffs.filter((buff) => applies(buff, ctx));
  const printed = ctx.weaponKeywordRefs ?? ctx.weaponKeywords?.map((keyword_id) => ({ keyword_id }));
  const selected = new Set<Buff>();
  const matches = (ref: WeaponKeywordRef, selector: WeaponKeywordRef): boolean =>
    ref.keyword_id === selector.keyword_id && Object.entries(selector.parameters ?? {}).every(([key, value]) => {
      const actual = ref.parameters?.[key as keyof NonNullable<WeaponKeywordRef["parameters"]>];
      if (key === "target_keyword" && typeof actual === "string" && typeof value === "string") return actual.toLowerCase() === value.toLowerCase();
      if (Array.isArray(value)) return Array.isArray(actual) && actual.length === value.length &&
        value.every((item) => typeof item === "string" && actual.some((candidate) => typeof candidate === "string" && candidate.toLowerCase() === item.toLowerCase()));
      return actual === value;
    });
  const gatesHold = (gate: BuffApplicability | undefined, refs: readonly WeaponKeywordRef[] | undefined, exclusions: boolean): boolean => {
    if (!gate) return true;
    if (gate.weaponName !== undefined && !ctx.weaponNames?.includes(gate.weaponName)) return false;
    if (gate.excludedWeaponName !== undefined && (ctx.weaponNames === undefined || ctx.weaponNames.includes(gate.excludedWeaponName))) return false;
    if (gate.weaponRequirements?.some((required) => !gatesHold(required, refs, exclusions))) return false;
    const selectors = exclusions ? gate.excludedWeaponKeywords : gate.weaponKeywords;
    if (selectors === undefined) return true;
    if (refs === undefined) return false;
    if (exclusions && selectors.some((selector) => refs.some((ref) => ref.keyword_id === selector.keyword_id &&
      Object.keys(selector.parameters ?? {}).some((key) => ref.parameters?.[key as keyof NonNullable<WeaponKeywordRef["parameters"]>] === undefined)))) return false;
    const found = selectors.some((selector) => refs.some((ref) => matches(ref, selector)));
    return exclusions ? !found : found;
  };
  // Positive dependencies are monotone. Resolve them first, then apply exclusions against the
  // complete candidate keyword set so a granted keyword cannot bypass an exclusion.
  for (;;) {
    const refs = printed === undefined ? undefined : [...printed];
    if (refs) for (const buff of selected) {
      if (buff.contribution.type === "extra-keyword") refs.push(buff.contribution.keywordRef);
    }
    const next = base.filter((buff) => !selected.has(buff) && gatesHold(buff.applicableWhen, refs, false));
    if (next.length === 0) break;
    for (const buff of next) selected.add(buff);
  }
  const refs = printed === undefined ? undefined : [...printed];
  if (refs) for (const buff of selected) {
    if (buff.contribution.type === "extra-keyword") refs.push(buff.contribution.keywordRef);
  }
  let live = base.filter((buff) => selected.has(buff) && gatesHold(buff.applicableWhen, refs, true));
  for (;;) {
    const remaining = printed === undefined ? undefined : [...printed];
    if (remaining) for (const buff of live) {
      if (buff.contribution.type === "extra-keyword") remaining.push(buff.contribution.keywordRef);
    }
    const next = live.filter((buff) => gatesHold(buff.applicableWhen, remaining, false));
    if (next.length === live.length) return live;
    live = next;
  }
}

/**
 * Collapse a flat buff stack into a {@link ResolvedModifiers} read-out. Pure
 * function; the engine — and any UI that wants to render the resolved table
 * before crunching — both go through this.
 */
export function resolveBuffs(buffs: Buff[], ctx: ResolveContext): ResolvedModifiers {
  const live = liveBuffs(buffs, ctx);

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
    critThresholds: {},
    ignoreModifiers: {},
    skillMod: { WS: { value: 0, sources: [] }, BS: { value: 0, sources: [] } },
    saveCharacteristic: null,
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
      case "crit-threshold": {
        const cur = out.critThresholds[c.roll];
        if (!cur || c.value < cur.value || (c.value === cur.value && rank(b.source) < rank(cur.dominantSource))) {
          out.critThresholds[c.roll] = { value: c.value, dominantSource: b.source };
        }
        break;
      }
      case "ignore-modifiers": {
        const cur = out.ignoreModifiers[c.roll];
        if (!cur || rank(b.source) < rank(cur.dominantSource)) out.ignoreModifiers[c.roll] = { dominantSource: b.source };
        break;
      }
      case "skill-mod":
        out.skillMod[c.stat].value += c.value;
        out.skillMod[c.stat].sources.push(b.source);
        break;
      case "save-characteristic":
        if (
          out.saveCharacteristic === null ||
          c.value < out.saveCharacteristic.value ||
          (c.value === out.saveCharacteristic.value && rank(b.source) < rank(out.saveCharacteristic.dominantSource))
        ) {
          out.saveCharacteristic = { value: c.value, dominantSource: b.source };
        }
        break;
    }
  }

  // An ignored roll keeps only its positive modifiers.
  const kept = (contribs: { value: number; source: BuffSource }[], ignored: boolean) => (ignored ? contribs.filter((c) => c.value > 0) : contribs);
  out.hitMod = capModifier(kept(hitContribs, out.ignoreModifiers.hit !== undefined));
  out.woundMod = capModifier(kept(woundContribs, out.ignoreModifiers.wound !== undefined));

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
