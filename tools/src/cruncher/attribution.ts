/**
 * Per-stage buff attribution by leave-one-out (LOO) recompute.
 *
 * The engine is closed-form, so the honest way to answer "how much did this
 * buff lift this stage?" is to re-run {@link crunch} with that buff removed and
 * diff the stage value. LOO is exactly correct through every non-linearity the
 * pipeline has — the ±1 hit/wound caps, the wound-threshold table, save clamps,
 * FNP, the models-killed cap — and it respects the resolver's non-additive
 * rules for free: a buff that grants a keyword the weapon already carries (e.g.
 * a second Sustained Hits 1) is deduped inside `resolveBuffs`, so its LOO delta
 * comes out ≈ 0 rather than double-counting.
 *
 * Only *toggleable* buffs are attributed — abilities (army / detachment /
 * stratagem / unit / attached / support) and manual UI toggles. The weapon's
 * intrinsic keywords are auto-injected inside `crunch`, are not levers, and are
 * never removed; they're reported by id in {@link AttributedStage.intrinsics}
 * so a UI can explain an elevated baseline without splitting them out.
 *
 * @packageDocumentation
 */
import type { Dataset } from "../data/dataset.js";
import type { BuffSource } from "./buffs.js";
import { crunch, type EngineInput, type EngineOutput, type Stage } from "./engine.js";

/** One toggleable buff group's marginal effect on a single stage. */
export type StageLift = {
  /** Representative source of the group (all its `Buff`s share a group key). */
  source: BuffSource;
  /** `stageValue(all buffs) − stageValue(all buffs minus this group)`. */
  delta: number;
};

/** A pipeline stage with its value decomposed across the toggleable buffs. */
export type AttributedStage = {
  name: Stage["name"];
  /** Stage value with every buff on — identical to {@link crunch}'s stage. */
  expected: number;
  /** The engine's stage detail string, unchanged. */
  detail: string;
  /** Stage value with all groupable buffs removed (intrinsics kept). */
  baseline: number;
  /** Per-group marginal effect; groups whose |delta| ≤ epsilon are dropped. */
  lifts: StageLift[];
  /**
   * `expected − baseline − Σ lifts`. Non-zero when buffs collide under a cap
   * (two +1s sharing one ±1 cap each show ≈0 lift; the real +1 lands here),
   * so a UI can surface it honestly as "overlap (capped)".
   */
  residual: number;
  /** Active weapon-keyword ids (intrinsic, auto-injected); display-only. */
  intrinsics: string[];
};

const DEFAULT_EPSILON = 1e-6;

/**
 * Buffs the UI toggles on/off — the only kinds we attribute. Weapon-keyword
 * buffs (intrinsics) are left in place for every recompute, so they never show
 * up as a lift and never perturb the baseline.
 */
function isGroupable(source: BuffSource): boolean {
  return source.kind === "ability" || source.kind === "manual";
}

/**
 * Stable grouping key. Every `Buff` a single UI toggle flatMaps to shares one
 * key, so a LOO pass removes the whole toggle, never a fragment of it.
 */
function groupKey(source: BuffSource): string {
  switch (source.kind) {
    case "ability":
      return `a:${source.abilityId}:${source.sourceUnitId ?? ""}`;
    case "manual":
      return `m:${source.label}`;
    case "weapon-keyword":
      return `w:${source.weaponId}:${source.keywordId}`;
  }
}

/**
 * Decompose each pipeline stage of `crunch(input)` into the marginal lift of
 * every toggleable buff group, via leave-one-out recompute.
 *
 * Cost is `groups + 2` `crunch` calls (full + baseline + one per group); the
 * engine is closed-form, so this is cheap to call per weapon line.
 *
 * @param input   The same {@link EngineInput} you'd pass to {@link crunch}.
 * @param dataset Optional dataset override (defaults to the embedded one).
 * @param opts    `epsilon` — lifts/residuals at or below this magnitude are
 *                treated as zero (default 1e-6).
 */
export function attributeStages(
  input: EngineInput,
  dataset?: Dataset,
  opts?: { epsilon?: number },
): AttributedStage[] {
  const epsilon = opts?.epsilon ?? DEFAULT_EPSILON;
  const full = crunch(input, dataset);

  // First-seen order of groupable buff groups, with a representative source.
  const order: string[] = [];
  const repSource = new Map<string, BuffSource>();
  for (const b of input.buffs) {
    if (!isGroupable(b.source)) continue;
    const key = groupKey(b.source);
    if (!repSource.has(key)) {
      repSource.set(key, b.source);
      order.push(key);
    }
  }

  // Baseline keeps only non-groupable buffs (weapon-keyword passthroughs) plus
  // the engine's auto-injected intrinsics.
  const baseline = crunch(
    { ...input, buffs: input.buffs.filter((b) => !isGroupable(b.source)) },
    dataset,
  );

  // Leave-one-out: drop one whole group, keep the rest.
  const loo = new Map<string, EngineOutput>();
  for (const key of order) {
    const without = input.buffs.filter(
      (b) => !isGroupable(b.source) || groupKey(b.source) !== key,
    );
    loo.set(key, crunch({ ...input, buffs: without }, dataset));
  }

  const intrinsics = full.resolved.extraKeywords.map((e) => e.keywordRef.keyword_id);

  // crunch always emits the same seven stages in the same order, so index
  // alignment across full / baseline / loo is sound.
  return full.stages.map((s, i) => {
    const expected = s.expected;
    const baseExpected = baseline.stages[i].expected;
    let totalLift = 0;
    const lifts: StageLift[] = [];
    for (const key of order) {
      const delta = expected - loo.get(key)!.stages[i].expected;
      totalLift += delta;
      if (Math.abs(delta) > epsilon) {
        lifts.push({ source: repSource.get(key)!, delta });
      }
    }
    const residual = expected - baseExpected - totalLift;
    return {
      name: s.name,
      expected,
      detail: s.detail,
      baseline: baseExpected,
      lifts,
      residual: Math.abs(residual) > epsilon ? residual : 0,
      intrinsics,
    };
  });
}
