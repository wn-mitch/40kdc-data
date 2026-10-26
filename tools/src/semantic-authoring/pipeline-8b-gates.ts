import type { DatabaseSync } from "node:sqlite";
import type Ajv from "ajv";

import { createValidator } from "../schema-loader.js";
import { effectToBuffs, POST_ATTACK_MOMENT, type EffectTranslation } from "../cruncher/from-dsl.js";
import { assumeEventSubjectMatches } from "../cruncher/from-dsl-selection.js";
import { grantedRecordIds } from "../data/lever-providers.js";
import type { ProjectionChecker } from "../mfm/apply.js";
import type { BuffSource, EngineContext } from "../cruncher/buffs.js";
import { tiledSources, type TiledSourceOptions } from "./leaf-view.js";
import { ownAbilityIds } from "./own-abilities.js";
import { cachedEmbeddings, type Embedder } from "./embeddings.js";
import { dot } from "./leaf-knn.js";
import { compileLeaves, type CompileLeaf, type Compiled } from "./compile.js";
import { coreCheckErrors } from "./core-checks.js";
import { checkEntry, entryWithMechanics, resolveCheckedEntity, semanticAuthoringDataRoot } from "./entries.js";
import { approvedCompanions, compiledPublicationErrors, openPublicationChecker, type CompiledRecord, type FactionRecord } from "./publication-projection.js";

/**
 * The compile+gate half of pipeline-8b: for every ability whose source is fully tiled by leaves,
 * compile it and check schema, core-record checks, publication integrity (the schema and
 * referential-integrity checks publishing that record alone would run), describer round-trip
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

export type CompileGateView = TiledSourceOptions & {
  /** Explicit reviewed publication identity for a pinned historical source with a retired source ID. */
  historicalEntityIds?: ReadonlyMap<number, string>;
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
const RUNTIME_CONTEXT_UNKNOWN: Readonly<Record<string, true>> = {
  "unit-filter target: identity, state or model membership is unresolved": true,
  "select-units: candidate identity or state is unavailable": true,
  "select-units: enemy candidate identity or state is unavailable": true,
  "selection/history/model/attack predicates are not resolved by the buff engine": true,
  "activation condition cannot be evaluated against current context": true,
  "persistent-designation: retained selection state is not resolved by the buff engine": true,
  "aura emitter filter requires the source unit's keywords": true,
};
let effectValidator: Ajv | undefined;
function validEffect(fragment: unknown): boolean {
  effectValidator ??= createValidator({ allErrors: false });
  return effectValidator.validate("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node", fragment) === true;
}

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
// Leaf effect types that change no attack's damage: healing, moving, placement, eligibility permissions,
// how many times a stance may be selected, list-building rules, unit keywords, tests, tags, resources,
// unit composition, and mortal wounds or the extra fight of a dying model (attack sequences of their
// own, which the attack-buff layer does not model by design). A type not reviewed stays a gap.
const NON_DAMAGE_EFFECT_TYPES = new Set([
  "heal", "move", "mortal-wounds", "set-up", "permission", "cost-modifier", "stance-selection-capacity",
  "move-modifier", "army-rule", "keyword-grant", "act-on-death", "cp-gain", "resource-gain", "add-unit", "split-unit",
  "transport-capacity", "destroy-models", "designate", "test", "targeting", "state-change", "no-effect",
  "oath-modifier", "objective-sticky", "counts-as", "marker",
]);
// Core abilities (and Reanimation Protocols) that decide deployment, movement, fight order, attachment or
// resurrection; none changes a hit, wound, save or damage roll.
const NON_DAMAGE_ABILITIES = new Set([
  "deadly-demise", "deep-strike", "fights-first", "hover", "infiltrators", "leader", "lone-operative", "scouts",
  "support", "super-heavy-walker", "mobile", "reanimation-protocols", // mfm:mirror keep — core and named ability slugs, not record ids
]);
const DAMAGE_STATS = new Set(["A", "S", "T", "Sv", "AP", "D", "WS", "BS"]);
// Which objective an ability picks decides control, never an attack's damage.
const OBJECTIVE_SELECTION = /^select-objective: /u;
const UNMODELLED_EFFECT_TYPE = /^effect type "(.*)" is not modelled by the buff layer$/u;
/**
 * Effects marked as not damage-affecting for the cruncher. Each can change an attack in play, but the
 * single-attack expected-value engine does not model it; it reports the effect as unsupported at
 * runtime and the record publishes from its leaves. Marking is deliberate, one reason per entry; an
 * unlisted shape stays a gap.
 */
const OUTSIDE_CRUNCHER_SCOPE: ReadonlyArray<{ reason: RegExp; why: string }> = [
  { reason: /^effect type "rule-state" is not modelled by the buff layer$/u, why: "a named rule's state (an active doctrine) is a scenario choice, not a buff" },
  { reason: /^rule-state: persistent ability ownership and suppression are not resolved by the buff engine$/u, why: "a named rule made active for a unit, or taken from it, resolves through that rule" },
  { reason: /^effect type "ability-activate" is not modelled by the buff layer$/u, why: "activating another ability resolves that ability, not a buff of this one" },
  { reason: /^effect type "resource-(spend|die)" is not modelled by the buff layer$/u, why: "spending a banked resource (miracle dice) is a player decision per roll" },
  { reason: /^effect type "weapon-grant" is not modelled by the buff layer$/u, why: "a granted weapon is a loadout change, not a modifier to the crunched weapon" },
  { reason: /^effect type "ability-modifier" is not modelled by the buff layer$/u, why: "a change to another ability's numbers resolves through that ability" },
  { reason: /^effect type "dice-table" is not modelled by the buff layer$/u, why: "a rolled outcome table is not a fixed buff" },
  { reason: /^effect type "test-exemption" is not modelled by the buff layer$/u, why: "a test exemption changes no attack" },
  { reason: /^ignore-modifiers: only hit and wound rolls and WS\/BS are modelled$/u, why: "ignoring modifiers to other rolls or characteristics is not modelled" },
  { reason: /^stat-modifier: operation "set" not supported$/u, why: "setting a characteristic has no single delta" },
  { reason: /^roll-result on "(hit|wound|save)": only a critical threshold on hit or wound rolls is modelled$/u, why: "fixed roll outcomes beyond a critical threshold are not modelled" },
  { reason: /^target "event-subject" is not resolved by the buff engine$/u, why: "the triggering unit is bound only at runtime" },
  { reason: /^target "event-object" is not resolved by the buff engine$/u, why: "the unit the triggering action aimed at is bound only at runtime" },
  { reason: /^select-weapon: a bound weapon is not resolved by the buff engine$/u, why: "a chosen weapon is bound only at runtime" },
  { reason: /^(?:stat-modifier|roll-modifier|re-roll|roll-result): narrows by "weapons\.ref" which the cruncher can't resolve here$/u, why: "a weapon an earlier selection binds is bound only at runtime" },
  { reason: /^trigger-time recipient snapshot is unavailable; current membership cannot establish historical recipients$/u, why: "the units an ability reached when it triggered are bound only at runtime" },
  { reason: /^re-roll: its count is set by the number of models-equipped-with; not resolved by the buff engine$/u, why: "a re-roll count set by how many models carry an item depends on the fielded loadout" },
];

/** Whether an unsupported item is marked as outside the cruncher's scope. */
export function isOutsideCruncherScope(item: EffectTranslation["unsupported"][number]): boolean {
  return OUTSIDE_CRUNCHER_SCOPE.some((entry) => entry.reason.test(item.reason));
}
// translateStatModifier's note for a defender stat seen from the attacker; the target perspective models it.
const DEFENDER_SIDE_STAT = /: defender-side stat; applies when the buffed unit is the target$/u;

/**
 * Whether every leaf of an effect subtree is off the damage path, so a container the buff layer
 * stops at (a selection with a predicate, a dice gate, a dice table) hides no damage effect. Any
 * leaf or container not recognised here counts as damage-path, the conservative default.
 */
export function isNonDamageEffect(node: unknown): boolean {
  if (node === null) return true;
  if (typeof node !== "object" || Array.isArray(node)) return false;
  const effect = node as Record<string, unknown>;
  const modifier = (typeof effect.modifier === "object" && effect.modifier !== null ? effect.modifier : {}) as Record<string, unknown>;
  const all = (children: unknown): boolean => Array.isArray(children) && children.every(isNonDamageEffect);
  switch (effect.type) {
    case "sequence":
    case "rules-bundle":
      return all(effect.steps);
    case "conditional":
      return isNonDamageEffect(effect.effect) && (effect.else === undefined || isNonDamageEffect(effect.else));
    case "select-units":
    case "for-each-unit":
    case "ability-part":
      return isNonDamageEffect(effect.effect);
    case "dice-gated":
      return isNonDamageEffect(effect.on_success ?? null) && isNonDamageEffect(effect.on_fail ?? null);
    case "dice-table":
      return Array.isArray(effect.outcomes) && effect.outcomes.every((outcome) => isNonDamageEffect((outcome as { effect?: unknown }).effect ?? null));
    case "roll-result":
    case "roll-modifier":
    case "re-roll":
      return typeof modifier.roll === "string" && !DAMAGE_ROLLS.has(modifier.roll);
    case "stat-modifier":
      return typeof modifier.stat === "string" && !DAMAGE_STATS.has(modifier.stat);
    case "ability-grant":
      // A printed grant is judged by the body it carries.
      if (modifier.definition !== undefined) return isNonDamageEffect(modifier.definition);
      return typeof modifier.ability === "string" && NON_DAMAGE_ABILITIES.has(modifier.ability);
    case "ability-activate":
      return typeof modifier.ability === "string" && NON_DAMAGE_ABILITIES.has(modifier.ability);
    case "rule-state":
      return (modifier.rule_kind === "ability" && typeof modifier.rule === "string" && NON_DAMAGE_ABILITIES.has(modifier.rule))
        || (modifier.rule_kind === "core-rule" && modifier.rule === "attacking-ends-hidden" && validEffect(effect));
    // An aura's range only decides which units are in it, and the cruncher's range gates are permissive;
    // a use count never changes an attack.
    case "ability-modifier":
      return modifier.aspect === "uses" || modifier.aspect === "range";
    default:
      return typeof effect.type === "string" && NON_DAMAGE_EFFECT_TYPES.has(effect.type);
  }
}

export function isOutsideDamagePath(item: EffectTranslation["unsupported"][number]): boolean {
  // The translator's own label is trusted only for a stat or roll this gate also counts as off the
  // damage path: a damage stat the translator cannot place is a gap, not an exemption.
  const fragmentModifier = (item.effectFragment as { modifier?: { stat?: unknown; roll?: unknown } } | undefined)?.modifier;
  if (STAT_MODIFIER_OUTSIDE_DAMAGE_PATH.test(item.reason)) return typeof fragmentModifier?.stat !== "string" || !DAMAGE_STATS.has(fragmentModifier.stat);
  if (ROLL_MODIFIER_OUTSIDE_DAMAGE_PATH.test(item.reason)) return typeof fragmentModifier?.roll !== "string" || !DAMAGE_ROLLS.has(fragmentModifier.roll);
  if (REROLL_OUTSIDE_DAMAGE_PATH.test(item.reason)) {
    const fragment = item.effectFragment as { modifier?: { roll?: unknown } } | undefined;
    const roll = fragment?.modifier?.roll;
    return typeof roll !== "string" || !DAMAGE_ROLLS.has(roll);
  }
  if (OBJECTIVE_SELECTION.test(item.reason)) return true;
  // A moment after the unit's own attacks acts only on later attacks, never the one being crunched.
  if (item.reason === POST_ATTACK_MOMENT) return true;
  return isNonDamageEffect(item.effectFragment);
}

const DEFENDER_CHECK_SOURCE: BuffSource = { kind: "ability", abilityId: "defender-check", abilityKind: "unit" };

/** The effect of the ability record a grant names, or undefined when no record of the faction has that id. */
export type GrantedRecordEffect = (abilityId: string) => unknown;

type GateCounts = { honestUnknown: number; outsideDamagePath: number; unrecognizedShape: number };

/**
 * How a grant of an ability record counts, or undefined when the item is not such a grant or the
 * record does not resolve. A record that changes no attack puts the grant off the damage path. A
 * grant reaching the crunched unit (its own unit, the aura recipient, a friendly filter) is pulled
 * onto the unit as levers by `stackableBuffsFor`, so its buffs are covered and only what the record
 * itself leaves unmodelled counts. A record with damage effects granted elsewhere stays a gap.
 */
function recordGrantCounts(item: EffectTranslation["unsupported"][number], recordEffect: GrantedRecordEffect | undefined, depth: number): GateCounts | undefined {
  if (recordEffect === undefined || depth >= 4 || !UNMODELLED_EFFECT_TYPE.test(item.reason)) return undefined;
  const fragment = item.effectFragment as { type?: unknown; modifier?: { ability?: unknown; definition?: unknown } } | undefined;
  const ability = fragment?.type === "ability-grant" && fragment.modifier?.definition === undefined ? fragment.modifier?.ability : undefined;
  if (typeof ability !== "string") return undefined;
  const effect = recordEffect(ability);
  if (effect === undefined) return undefined;
  const translation = effectToBuffs(effect, DEFENDER_CHECK_SOURCE, CRUNCHER_CONTEXT);
  const residual = classifyUnsupported(translation.unsupported, recordEffect, depth + 1);
  const clean = residual.unrecognizedShape === 0 && residual.honestUnknown === 0;
  if (translation.applied.length === 0 && translation.activatable.length === 0) {
    return clean ? { honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 } : undefined;
  }
  return grantedRecordIds({ applied: [], unsupported: [item], activatable: [] }).length > 0 ? residual : undefined;
}

/** Granted records resolve the way the gated ability itself does: in its faction, then its parent's. */
function grantedRecordEffect(dataRoot: string, factionId: string): GrantedRecordEffect {
  return (abilityId) => {
    try {
      return (resolveCheckedEntity(dataRoot, factionId, abilityId).entry as { effect?: unknown }).effect;
    } catch {
      return undefined;
    }
  };
}

export function classifyUnsupported(
  unsupported: EffectTranslation["unsupported"], recordEffect?: GrantedRecordEffect, depth = 0,
): GateCounts {
  let honestUnknown = 0;
  let outsideDamagePath = 0;
  let unrecognizedShape = 0;
  for (const item of unsupported) {
    if (DEFENDER_SIDE_STAT.test(item.reason)) {
      // Counted only as whatever the target perspective still cannot model.
      const asTarget = classifyUnsupported(effectToBuffs(item.effectFragment, DEFENDER_CHECK_SOURCE, CRUNCHER_CONTEXT, "target").unsupported, recordEffect, depth);
      honestUnknown += asTarget.honestUnknown;
      outsideDamagePath += asTarget.outsideDamagePath;
      unrecognizedShape += asTarget.unrecognizedShape;
    } else if (HONEST_UNKNOWN_CONDITION.test(item.reason)
      || (RUNTIME_CONTEXT_UNKNOWN[item.reason] === true && validEffect(item.effectFragment))) honestUnknown += 1;
    else if (isOutsideDamagePath(item)) outsideDamagePath += 1;
    else {
      const granted = recordGrantCounts(item, recordEffect, depth);
      if (granted === undefined && isOutsideCruncherScope(item)) outsideDamagePath += 1;
      else if (granted === undefined) unrecognizedShape += 1;
      else {
        honestUnknown += granted.honestUnknown;
        outsideDamagePath += granted.outsideDamagePath;
        unrecognizedShape += granted.unrecognizedShape;
      }
    }
  }
  return { honestUnknown, outsideDamagePath, unrecognizedShape };
}

async function gateCompiledAbility(
  db: DatabaseSync, embedder: Embedder, publication: () => ProjectionChecker, dataRoot: string, factionId: string, abilityId: string, compiled: Extract<Compiled, { ok: true }>, sourceText: string, floor: number,
  companions: readonly CompiledRecord[],
): Promise<
  | { status: "no-data-entry" }
  | { status: "gated"; schema: boolean; coreChecks: boolean; integrity: boolean; describer: boolean; describerScore: number | null; crunchShapeOk: boolean; honestUnknown: number; outsideDamagePath: number; unrecognizedShape: number; leverDiff: LeverDiff | null; failures: GateFailure[] }
> {
  const failures: GateFailure[] = [];
  let resolved;
  try {
    resolved = resolveCheckedEntity(dataRoot, factionId, abilityId);
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

  // Publication's own checks on this record, alone or published with its companions: the
  // projected abilities.json (and core stratagems.json for a stratagem target) through schema
  // and referential integrity.
  const integrityErrors = await compiledPublicationErrors(publication(), factionId, { ability_id: abilityId, mechanics: compiled.mechanics, core: compiled.core ?? null, source_text: sourceText }, companions);
  const integrity = integrityErrors.length === 0;
  if (!integrity) failures.push({ faction_id: factionId, ability_id: abilityId, reason: "integrity", detail: integrityErrors.join("; ").slice(0, 600) });

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
  // The record's own trigger binds `event-subject` at runtime; judge the effect as a matching unit sees it.
  const bound = assumeEventSubjectMatches(compiled.mechanics.trigger, compiled.mechanics.effect);
  const newTranslation = effectToBuffs(bound.effect, source, CRUNCHER_CONTEXT, bound.perspective);
  const recordEffect = grantedRecordEffect(dataRoot, factionId);
  const { honestUnknown, outsideDamagePath, unrecognizedShape } = classifyUnsupported(newTranslation.unsupported, recordEffect);
  const crunchShapeOk = unrecognizedShape === 0;
  if (!crunchShapeOk) {
    const reasons = newTranslation.unsupported
      .filter((item) => classifyUnsupported([item], recordEffect).unrecognizedShape > 0)
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
  db: DatabaseSync, embedder: Embedder, floor: number, abilityVersionIds?: ReadonlySet<number>, view: CompileGateView = {},
): Promise<CompileGateReport> {
  for (const id of view.historicalEntityIds?.keys() ?? []) {
    if (!view.historicalSourceHashes?.has(id)) throw new Error(`Historical publication identity ${id} requires a pinned source hash.`);
  }
  const dataRoot = semanticAuthoringDataRoot();
  const tiled = new Map(tiledSources(db, { ...view, abilityVersionIds }).map((source) => [source.id, source]));
  const own = ownAbilityIds(db, dataRoot);
  const abilitiesTotal = abilityVersionIds
    ? abilityVersionIds.size
    : (db.prepare("SELECT COUNT(*) AS n FROM abilities WHERE current = 1").get() as { n: number }).n;
  const report: CompileGateReport = {
    abilities_total: abilitiesTotal, fully_tiled: tiled.size, compile_attempted: 0, compile_ok: 0, compile_errors: {},
    gated: 0, no_data_entry: 0, schema_pass: 0, core_checks_pass: 0, integrity_pass: 0, describer_pass: 0, describer_scores: [],
    cruncher_honest_unknown: 0, cruncher_outside_damage_path: 0, cruncher_unrecognized_shape: 0, cruncher_shape_pass: 0, all_gates_pass: 0, failures: [], lever_diffs: [], abilities: [],
  };
  // One snapshot of the data root serves every record's publication projection.
  let checker: ProjectionChecker | undefined;
  const publication = () => (checker ??= openPublicationChecker());
  try {
    await gateTiled(db, embedder, floor, view, dataRoot, tiled, own, report, publication);
  } finally {
    checker?.close();
  }
  return report;
}

async function gateTiled(
  db: DatabaseSync, embedder: Embedder, floor: number, view: CompileGateView, dataRoot: string,
  tiled: ReadonlyMap<number, ReturnType<typeof tiledSources>[number]>, own: ReadonlyMap<number, string>,
  report: CompileGateReport, publication: () => ProjectionChecker,
): Promise<void> {
  const compiledById = new Map<number, Compiled>();
  // Records gated together may only pass integrity as one publication (a stance and the rules
  // naming its options), so each record's companions are the faction's approved entries plus the
  // other records of this run.
  const runRecords: FactionRecord[] = [];
  for (const [, ability] of tiled) {
    const entityId = view.historicalEntityIds?.get(ability.id) ?? ability.ability_id;
    const abilityId = own.get(ability.id) ?? (view.historicalSourceHashes?.has(ability.id) ? entityId : undefined);
    const compiled = compileLeaves(ability.leaves, ability.source_text, {
      abilityId,
      name: ability.name ?? undefined,
      weapons: { faction_id: ability.faction_id, source_type: ability.source_type ?? "" },
      units: { faction_id: ability.faction_id },
    });
    compiledById.set(ability.id, compiled);
    if (compiled.ok) runRecords.push({ faction_id: ability.faction_id, ability_id: entityId, mechanics: compiled.mechanics, core: compiled.core ?? null, source_text: ability.source_text });
  }
  const approved = new Map<string, CompiledRecord[]>();
  const companionsOf = (factionId: string): CompiledRecord[] => {
    if (!approved.has(factionId)) approved.set(factionId, approvedCompanions(db, factionId));
    return [...approved.get(factionId)!, ...runRecords.filter((record) => record.faction_id === factionId)];
  };
  for (const [, ability] of tiled) {
    report.compile_attempted += 1;
    const entityId = view.historicalEntityIds?.get(ability.id) ?? ability.ability_id;
    const row: AbilityGateResult = { ability_version_id: ability.id, faction_id: ability.faction_id, ability_id: entityId, machine_leaves: ability.machine_leaves, compile_errors: [], gates: null };
    report.abilities.push(row);
    const compiled = compiledById.get(ability.id)!;
    if (!compiled.ok) {
      const reason = compiled.errors[0] ?? "unknown";
      report.compile_errors[reason] = (report.compile_errors[reason] ?? 0) + 1;
      row.compile_errors = compiled.errors;
      continue;
    }
    report.compile_ok += 1;
    const gate = await gateCompiledAbility(db, embedder, publication, dataRoot, ability.faction_id, entityId, compiled, ability.source_text, floor, companionsOf(ability.faction_id));
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
}
