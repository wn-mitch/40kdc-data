import type { DatabaseSync } from "node:sqlite";

import { diceTableInvariantErrors } from "../integrity.js";
import { effectToBuffs, type EffectTranslation } from "../cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../cruncher/buffs.js";
import type { CoverageView } from "./coverage.js";
import { tiledSources } from "./leaf-view.js";
import { cachedEmbeddings, type Embedder } from "./embeddings.js";
import { dot } from "./leaf-knn.js";
import { compileLeaves, type CompileLeaf, type Compiled } from "./compile.js";
import { coreCheckErrors } from "./core-checks.js";
import { checkEntry, entryWithMechanics, resolveAbilityEntity, round5cDataRoot } from "./entries.js";

/**
 * The compile+gate half of pipeline-8b: for every ability whose source is fully tiled by leaves,
 * compile it and check schema, core-record checks, source integrity, describer round-trip
 * fidelity, and whether the cruncher can model the compiled effect. Split out of pipeline-8b.ts
 * so each file stays under the repo's file-size guideline; `pipeline-8b.ts` is the only caller.
 */

export type GateFailure = { faction_id: string; ability_id: string; reason: string; detail: string };

/**
 * Informational only (never gates): how the old, published `effect` and the freshly compiled one
 * compare on buff-lever extraction. The old records are being replaced piecemeal and are often
 * simply wrong (a dropped condition, a wrong target, a malformed gate) — see the 4 cases pipeline-
 * 8b's first cruncher gate flagged as "regressions" that turned out to be old-record bugs. Useful
 * for a reviewer to spot-check, not for gating.
 */
export type LeverDiff = {
  faction_id: string; ability_id: string;
  old_applied: number; new_applied: number;
  old_unsupported: number; new_unsupported: number;
};

export type CompileGateReport = {
  abilities_total: number;
  fully_tiled: number;
  compile_attempted: number;
  compile_ok: number;
  compile_errors: Record<string, number>;
  gated: number;
  no_data_entry: number;
  schema_pass: number;
  core_checks_pass: number;
  integrity_pass: number;
  describer_pass: number;
  describer_scores: number[];
  /** Every unsupported branch across gated compiles, classified by why it's unsupported. */
  cruncher_honest_unknown: number;
  cruncher_outside_damage_path: number;
  cruncher_unrecognized_shape: number;
  cruncher_shape_pass: number;
  all_gates_pass: number;
  failures: GateFailure[];
  lever_diffs: LeverDiff[];
  /** One row per fully tiled ability: what compiled and which gates it passed. */
  abilities: AbilityGateResult[];
};

export type AbilityGateResult = {
  ability_version_id: number; faction_id: string; ability_id: string;
  /** Leaves from machine rows or overlay proposals; any nonzero value makes the result a pilot result, never an approval. */
  machine_leaves: number;
  compile_errors: string[];
  gates: null | { status: "gated" | "no-data-entry"; schema: boolean; core_checks: boolean; integrity: boolean; describer: boolean; describer_score: number | null; crunch_shape: boolean; all: boolean };
};

/**
 * Cosine similarity of two texts under the same local embedder used for leaf proposals — the
 * "workbench's existing similarity measure" the round-trip gate is asked to reuse. Routed through
 * `cachedEmbeddings` (the same `text_embeddings` table `runLeafProposals` already populates, keyed
 * by model + sha256 of the text) so a re-gate of the same rendered/source text pair is a cache hit,
 * not a fresh embed.
 */
async function describerSimilarity(db: DatabaseSync, embedder: Embedder, rendered: string, sourceText: string): Promise<number> {
  const { vectors } = await cachedEmbeddings(db, embedder, [rendered, sourceText]);
  return dot(vectors[0]!, vectors[1]!);
}

const CRUNCHER_CONTEXT: EngineContext = { phase: "shooting", attackerStationary: false };

/**
 * `effectToBuffs`'s only "I genuinely cannot know this without live game state" signal: a
 * conditional whose condition type `evaluateCondition` has no case for (designated, strength,
 * and any other condition that depends on board/turn state the static context doesn't carry) —
 * see the single call site at from-dsl.ts's `translateConditional`.
 */
const HONEST_UNKNOWN_CONDITION = /^conditional: cannot evaluate condition /u;

/**
 * The cruncher estimates damage; healing, a Wounds-characteristic change, and any other roll or
 * stat that isn't part of the hit/wound/save/damage math are out of scope *by design*, not gaps.
 * `translateStatModifier` and `translateRollModifier` only ever reach their "outside the damage
 * path" default case for a stat/roll their own `switch` doesn't treat as damage-path (A/S/T/Sv for
 * stats; hit/wound/save/damage for rolls) — those two messages are unambiguous on their own.
 * `translateReroll`'s matching message is not: it fires both for a genuinely non-combat roll
 * (charge, advance, battle-shock, ...) *and* for a damage-path roll with an unparseable subset —
 * the latter is a real shape gap, so it's checked against the fragment's own `roll` field.
 */
const DAMAGE_ROLLS = new Set(["hit", "wound", "save", "damage"]);
const STAT_MODIFIER_OUTSIDE_DAMAGE_PATH = /^stat-modifier on ".*" is outside the damage path$/u;
const ROLL_MODIFIER_OUTSIDE_DAMAGE_PATH = /^roll-modifier on ".*" is outside the damage path$/u;
const REROLL_OUTSIDE_DAMAGE_PATH = /^re-roll on ".*" \(subset ".*"\) is outside the damage path$/u;
/** Top-level effect `type`s the walk() dispatch has no case for that are non-damage by design.
 * Extend this set as more are confirmed — an effect type not yet reviewed stays "unrecognized
 * shape" (the conservative default) rather than being assumed out of scope. */
const NON_DAMAGE_EFFECT_TYPES = new Set(["heal"]);
const UNMODELLED_EFFECT_TYPE = /^effect type "(.*)" is not modelled by the buff layer$/u;

function isOutsideDamagePath(item: EffectTranslation["unsupported"][number]): boolean {
  if (STAT_MODIFIER_OUTSIDE_DAMAGE_PATH.test(item.reason) || ROLL_MODIFIER_OUTSIDE_DAMAGE_PATH.test(item.reason)) return true;
  if (REROLL_OUTSIDE_DAMAGE_PATH.test(item.reason)) {
    const fragment = item.effectFragment as { modifier?: { roll?: unknown } } | undefined;
    const roll = fragment?.modifier?.roll;
    return typeof roll !== "string" || !DAMAGE_ROLLS.has(roll);
  }
  const unmodelled = UNMODELLED_EFFECT_TYPE.exec(item.reason);
  if (unmodelled) return NON_DAMAGE_EFFECT_TYPES.has(unmodelled[1]!);
  return false;
}

export function classifyUnsupported(unsupported: EffectTranslation["unsupported"]): { honestUnknown: number; outsideDamagePath: number; unrecognizedShape: number } {
  let honestUnknown = 0;
  let outsideDamagePath = 0;
  let unrecognizedShape = 0;
  for (const item of unsupported) {
    if (HONEST_UNKNOWN_CONDITION.test(item.reason)) honestUnknown += 1;
    else if (isOutsideDamagePath(item)) outsideDamagePath += 1;
    else unrecognizedShape += 1;
  }
  return { honestUnknown, outsideDamagePath, unrecognizedShape };
}

async function gateCompiledAbility(
  db: DatabaseSync, embedder: Embedder, dataRoot: string, factionId: string, abilityId: string, compiled: Extract<Compiled, { ok: true }>, sourceText: string, floor: number,
): Promise<
  | { status: "no-data-entry" }
  | { status: "gated"; schema: boolean; coreChecks: boolean; integrity: boolean; describer: boolean; describerScore: number | null; crunchShapeOk: boolean; honestUnknown: number; outsideDamagePath: number; unrecognizedShape: number; leverDiff: LeverDiff | null; failures: GateFailure[] }
> {
  const failures: GateFailure[] = [];
  let resolved;
  try {
    resolved = resolveAbilityEntity(dataRoot, factionId, abilityId);
  } catch {
    return { status: "no-data-entry" };
  }
  const entry = entryWithMechanics(resolved.entry, compiled.mechanics);
  const checked = checkEntry(entry);
  const coreErrors = coreCheckErrors(dataRoot, abilityId, compiled.checks);
  const schema = checked.errors.length === 0;
  const coreChecks = coreErrors.length === 0;
  if (!schema) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "schema", detail: checked.errors.join("; ").slice(0, 300) });
  if (!coreChecks) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "core-checks", detail: coreErrors.join("; ").slice(0, 300) });

  const diceErrors = diceTableInvariantErrors(compiled.mechanics.effect);
  const integrity = diceErrors.length === 0;
  if (!integrity) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "integrity", detail: diceErrors.join("; ").slice(0, 300) });

  let describerScore: number | null = null;
  let describer = false;
  if (checked.rendered_text) {
    describerScore = await describerSimilarity(db, embedder, checked.rendered_text, sourceText);
    describer = describerScore >= floor;
    if (!describer) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "describer-roundtrip", detail: `similarity ${describerScore.toFixed(3)} < ${floor}` });
  } else {
    failures.push({ faction_id: factionId, ability_id: abilityId, reason: "describer-roundtrip", detail: "describer produced no text" });
  }

  // The cruncher gate judges the new compile on its own merits — never against the old record.
  // The old records are being replaced piecemeal and are frequently just wrong (a dropped
  // condition, a wrong target/subset, a malformed combined gate); comparing against them turns
  // "the new DSL is now more faithful" into a false "regression". A compile passes this gate iff
  // every unsupported branch it yields is either an honest runtime unknown (a condition the
  // static cruncher genuinely can't evaluate without live game state) or outside the damage path
  // by design (heal, a non-combat stat/roll — the cruncher estimates damage, not everything a DSL
  // effect can express). "Unrecognized shape" is reserved for a damage-path effect the cruncher
  // should be able to model but can't parse — a real gap.
  const source: BuffSource = { kind: "ability", abilityId, abilityKind: "unit" };
  const newTranslation = effectToBuffs(compiled.mechanics.effect, source, CRUNCHER_CONTEXT);
  const { honestUnknown, outsideDamagePath, unrecognizedShape } = classifyUnsupported(newTranslation.unsupported);
  const crunchShapeOk = unrecognizedShape === 0;
  if (!crunchShapeOk) {
    const reasons = newTranslation.unsupported
      .filter((item) => !HONEST_UNKNOWN_CONDITION.test(item.reason) && !isOutsideDamagePath(item))
      .map((item) => item.reason);
    failures.push({ faction_id: factionId, ability_id: abilityId, reason: "cruncher-unrecognized-shape", detail: [...new Set(reasons)].join("; ").slice(0, 300) });
  }

  // Informational only: how this compares to the old record's own lever extraction, when there
  // was one (a mirror stub has no `effect` to compare against).
  const oldEffect = (resolved.entry as { effect?: unknown }).effect;
  const leverDiff: LeverDiff | null = oldEffect ? {
    faction_id: factionId, ability_id: abilityId,
    old_applied: effectToBuffs(oldEffect, source, CRUNCHER_CONTEXT).applied.length, new_applied: newTranslation.applied.length,
    old_unsupported: effectToBuffs(oldEffect, source, CRUNCHER_CONTEXT).unsupported.length, new_unsupported: newTranslation.unsupported.length,
  } : null;

  return { status: "gated", schema, coreChecks, integrity, describer, describerScore, crunchShapeOk, honestUnknown, outsideDamagePath, unrecognizedShape, leverDiff, failures };
}

/**
 * Compile and gate every fully tiled ability (or only `abilityVersionIds`) under a leaf view. The
 * default trusted view is what approval sees; pipelines that gate their own machine output pass
 * a machine view (see `tiledSources`), and their results carry `machine_leaves`.
 */
export async function runCompileGates(
  db: DatabaseSync, embedder: Embedder, floor: number, abilityVersionIds?: ReadonlySet<number>, view: CoverageView = {},
): Promise<CompileGateReport> {
  const dataRoot = round5cDataRoot();
  const tiled = new Map(tiledSources(db, { ...view, abilityVersionIds }).map((source) => [source.id, source]));
  const abilitiesTotal = abilityVersionIds
    ? abilityVersionIds.size
    : (db.prepare("SELECT COUNT(*) AS n FROM abilities WHERE current = 1").get() as { n: number }).n;
  const report: CompileGateReport = {
    abilities_total: abilitiesTotal, fully_tiled: tiled.size, compile_attempted: 0, compile_ok: 0, compile_errors: {},
    gated: 0, no_data_entry: 0, schema_pass: 0, core_checks_pass: 0, integrity_pass: 0, describer_pass: 0, describer_scores: [],
    cruncher_honest_unknown: 0, cruncher_outside_damage_path: 0, cruncher_unrecognized_shape: 0, cruncher_shape_pass: 0, all_gates_pass: 0, failures: [], lever_diffs: [], abilities: [],
  };
  for (const [, ability] of tiled) {
    report.compile_attempted += 1;
    const row: AbilityGateResult = { ability_version_id: ability.id, faction_id: ability.faction_id, ability_id: ability.ability_id, machine_leaves: ability.machine_leaves, compile_errors: [], gates: null };
    report.abilities.push(row);
    const compiled = compileLeaves(ability.leaves, ability.source_text);
    if (!compiled.ok) {
      const reason = compiled.errors[0] ?? "unknown";
      report.compile_errors[reason] = (report.compile_errors[reason] ?? 0) + 1;
      row.compile_errors = compiled.errors;
      continue;
    }
    report.compile_ok += 1;
    const gate = await gateCompiledAbility(db, embedder, dataRoot, ability.faction_id, ability.ability_id, compiled, ability.source_text, floor);
    if (gate.status === "no-data-entry") {
      row.gates = { status: "no-data-entry", schema: false, core_checks: false, integrity: false, describer: false, describer_score: null, crunch_shape: false, all: false };
      report.no_data_entry += 1;
      continue;
    }
    row.gates = {
      status: "gated", schema: gate.schema, core_checks: gate.coreChecks, integrity: gate.integrity, describer: gate.describer,
      describer_score: gate.describerScore, crunch_shape: gate.crunchShapeOk,
      all: gate.schema && gate.coreChecks && gate.integrity && gate.describer && gate.crunchShapeOk,
    };
    report.gated += 1;
    if (gate.schema) report.schema_pass += 1;
    if (gate.coreChecks) report.core_checks_pass += 1;
    if (gate.integrity) report.integrity_pass += 1;
    if (gate.describer) report.describer_pass += 1;
    if (gate.describerScore !== null) report.describer_scores.push(Math.round(gate.describerScore * 1000) / 1000);
    report.cruncher_honest_unknown += gate.honestUnknown;
    report.cruncher_outside_damage_path += gate.outsideDamagePath;
    report.cruncher_unrecognized_shape += gate.unrecognizedShape;
    if (gate.crunchShapeOk) report.cruncher_shape_pass += 1;
    if (gate.leverDiff) report.lever_diffs.push(gate.leverDiff);
    if (gate.schema && gate.coreChecks && gate.integrity && gate.describer && gate.crunchShapeOk) report.all_gates_pass += 1;
    report.failures.push(...gate.failures);
  }
  return report;
}
