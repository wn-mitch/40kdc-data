import type { BuffSource, EngineContext } from "../cruncher/index.js";
import { POST_ATTACK_MOMENT, type EffectTranslation, type UnsupportedFragment } from "../cruncher/from-dsl.js";
import type { EligibleAbility } from "../abilities-resolver/index.js";
import type { AbilityView } from "../data/entities.js";
import { canTakeEnhancement, grantedRecordIds, grantedRecordLevers } from "../data/lever-providers.js";
import type { DamageScoringSession } from "./scoring.js";
import type { StackResult } from "./model.js";

/**
 * What became of one provider in a cell's winning stack:
 * - `applied`: a lever it provides is selected (or, for the target, its buffs apply);
 * - `rejected`: it is eligible but adds nothing to this attack (`reasons` say why);
 * - `unresolved`: part of it cannot be evaluated. `relevant` marks whether that part could
 *   change the current attack's damage; an encounter-layer effect (deaths, explosions, reactive
 *   attacks, restoration, designations and moments after the unit's own attacks) cannot, and is never scored.
 */
export type LedgerStatus = "applied" | "rejected" | "unresolved";

export type LedgerSourceKind = EligibleAbility["source"]["kind"] | "enhancement" | "granted";

export interface LedgerEntry {
  side: "attacker" | "target";
  abilityId: string;
  sourceKind: LedgerSourceKind;
  /** The supporting unit, attached unit or Enhancement bearer that provides it. */
  sourceUnitId?: string;
  /** For a granted record, the ability that grants it. */
  grantedBy?: string;
  status: LedgerStatus;
  relevant: boolean;
  reasons: string[];
}

type FragmentClass = "out-of-scope" | "encounter-layer" | "unresolved";

/** Effects that never act on the current attack: movement, set-up, CP, objectives, roster and targeting rules, reminder tokens. */
const OUT_OF_ATTACK_EFFECTS = new Set([
  "no-effect", "permission", "set-up", "test", "test-exemption", "move", "move-modifier", "cp-gain",
  "cost-modifier", "objective-sticky", "transport-capacity", "split-unit", "add-unit", "army-rule",
  "targeting", "marker",
]);

/**
 * Core abilities (`data/core/unit-keywords.json`) whose grant cannot change attack resolution:
 * deployment, movement, targeting restrictions and fight sequencing. Stealth and Feel No Pain do,
 * so their grants stay unresolved; Deadly Demise acts on death.
 */
const NON_ATTACK_CORE_ABILITIES = new Set([
  "deep-strike", "infiltrators", "scouts", "leader", "support", "lone-operative", "hover",
  "firing-deck", "super-heavy-walker", "fights-first",
]);

/** Effects that act through events outside the current attack. */
const ENCOUNTER_EFFECTS = new Set(["mortal-wounds", "act-on-death", "designate", "heal"]);

/** Trigger events that fire on a death or on damage the unit takes, never during its own attack. */
const ENCOUNTER_EVENTS = new Set(["destroyed", "model-destroyed", "damage-allocated"]);

function fragmentClass(fragment: UnsupportedFragment, ownId: string): FragmentClass {
  if (fragment.reason.endsWith("is outside the damage path")) return "out-of-scope";
  if (fragment.reason.startsWith("model-scoped effect from an attached model")) return "out-of-scope";
  if (fragment.reason === POST_ATTACK_MOMENT) return "encounter-layer";
  const node = fragment.effectFragment as { type?: unknown; modifier?: { ability?: unknown } } | null;
  const type = node && typeof node === "object" ? node.type : undefined;
  if (type === "ability-grant") {
    const granted = node?.modifier?.ability;
    // A core record granting its own id marks the rule; it carries no mechanic.
    if (granted === ownId || (typeof granted === "string" && NON_ATTACK_CORE_ABILITIES.has(granted))) return "out-of-scope";
    if (granted === "deadly-demise") return "encounter-layer";
  }
  if (typeof type === "string" && OUT_OF_ATTACK_EFFECTS.has(type)) return "out-of-scope";
  if (typeof type === "string" && ENCOUNTER_EFFECTS.has(type)) return "encounter-layer";
  return "unresolved";
}

/**
 * Whether the ability's trigger lies outside the attack being scored. On the attacker side a
 * trigger whose subject is an enemy reacts to the opponent's action; on the target side the
 * enemy is the attacker, so only death and damage events qualify.
 */
function encounterTrigger(ability: AbilityView, side: LedgerEntry["side"]): boolean {
  const trigger = ability.raw.trigger as { event?: string; subject?: unknown } | null | undefined;
  if (!trigger) return false;
  if (trigger.event && ENCOUNTER_EVENTS.has(trigger.event)) return true;
  const subject = trigger.subject as { owner?: unknown } | undefined;
  return side === "attacker" && typeof subject === "object" && subject !== null && subject.owner === "enemy";
}

function sourceOf(entry: EligibleAbility): BuffSource {
  const { ability, source } = entry;
  switch (source.kind) {
    case "attached":
      return { kind: "ability", abilityId: ability.id, abilityKind: "attached", sourceUnitId: source.unitId };
    case "support":
      return { kind: "ability", abilityId: ability.id, abilityKind: "support", sourceUnitId: source.sourceUnitId };
    default:
      return { kind: "ability", abilityId: ability.id, abilityKind: source.kind };
  }
}

/** Classify one provider from its translations (one per stack member it reaches). */
function classify(
  ability: AbilityView,
  side: LedgerEntry["side"],
  translations: readonly EffectTranslation[],
  applied: boolean,
): Pick<LedgerEntry, "status" | "relevant" | "reasons"> {
  const encounter = encounterTrigger(ability, side);
  const fragments = new Map<string, FragmentClass>();
  for (const translation of translations) {
    for (const fragment of translation.unsupported) {
      const kind = fragmentClass(fragment, ability.id);
      fragments.set(fragment.reason, encounter && kind === "unresolved" ? "encounter-layer" : kind);
    }
  }
  const of = (kind: FragmentClass) => [...fragments].filter(([, value]) => value === kind).map(([reason]) => reason).sort();
  const unresolved = of("unresolved");
  const encounterReasons = of("encounter-layer");
  const outOfScope = of("out-of-scope");
  if (unresolved.length > 0) {
    return { status: "unresolved", relevant: true, reasons: [...(applied ? ["applied in part"] : []), ...unresolved] };
  }
  if (applied) return { status: "applied", relevant: false, reasons: [] };
  if (encounter || encounterReasons.length > 0) {
    return { status: "unresolved", relevant: false, reasons: ["encounter-layer", ...encounterReasons] };
  }
  const offers = translations.some((translation) => translation.applied.length > 0 || translation.activatable.length > 0);
  if (offers) return { status: "rejected", relevant: false, reasons: ["not selected by the optimiser"] };
  return { status: "rejected", relevant: false, reasons: ["no current-attack effect", ...outOfScope] };
}

const entryKey = (entry: Pick<LedgerEntry, "side" | "abilityId" | "sourceKind" | "sourceUnitId" | "grantedBy">) =>
  [entry.side, entry.abilityId, entry.sourceKind, entry.sourceUnitId ?? "", entry.grantedBy ?? ""].join("|");

/**
 * Every provider eligible for the winning stack and the target, with what became of it. Enumerates
 * providers directly (eligible abilities per member and detachment, offered Enhancements, granted
 * records), so a provider whose translation yields no lever still has an entry.
 */
export function buildLedger(session: DamageScoringSession, result: StackResult): LedgerEntry[] {
  const { dataset, config, state } = session;
  const spec = result.spec;
  const selected = session.selectedPoolLevers(result);
  const selectedIds = new Set(selected.map((lever) => lever.id));
  const selectedSources = new Set(selected.flatMap((lever) => lever.source.kind === "ability"
    ? [`${lever.source.abilityId}|${lever.source.sourceUnitId ?? ""}`]
    : []));

  const gathered = new Map<string, { entry: Omit<LedgerEntry, "status" | "relevant" | "reasons">; ability: AbilityView; translations: EffectTranslation[]; applied: boolean; dropped: boolean }>();
  const gather = (
    entry: Omit<LedgerEntry, "status" | "relevant" | "reasons">,
    ability: AbilityView,
    translation: EffectTranslation,
    applied: boolean,
  ) => {
    const key = entryKey(entry);
    const current = gathered.get(key) ?? { entry, ability, translations: [], applied: false, dropped: config.droppedArmyRules.includes(ability.id) };
    current.translations.push(translation);
    current.applied ||= applied;
    gathered.set(key, current);
  };

  for (const member of spec.members) {
    const context = state.contextFor(spec, member);
    for (const detachmentId of spec.detachmentIds.length > 0 ? spec.detachmentIds : [undefined]) {
      const input = session.eligibilityInput(spec, member, detachmentId);
      for (const eligible of dataset.eligibleAbilities(input, context.phase)) {
        const source = sourceOf(eligible);
        const translation = eligible.ability.describeBuffs(source, context, "attacker", eligible.rating);
        const sourceUnitId = eligible.source.kind === "support" ? eligible.source.sourceUnitId
          : eligible.source.kind === "attached" ? eligible.source.unitId : undefined;
        gather(
          { side: "attacker", abilityId: eligible.ability.id, sourceKind: eligible.source.kind, ...(sourceUnitId ? { sourceUnitId } : {}) },
          eligible.ability,
          translation,
          selectedSources.has(`${eligible.ability.id}|${source.kind === "ability" ? source.sourceUnitId ?? "" : ""}`),
        );
        for (const { abilityId } of grantedRecordIds(translation)) {
          const record = dataset.abilities.getInFaction(abilityId, spec.factionId) ?? dataset.abilities.getAny(abilityId);
          if (!record) continue;
          const levers = grantedRecordLevers(dataset, abilityId, spec.factionId, { abilityId: eligible.ability.id, source, enabled: false }, context);
          gather(
            { side: "attacker", abilityId, sourceKind: "granted", grantedBy: eligible.ability.id },
            record,
            record.describeBuffs({ kind: "ability", abilityId: record.id, abilityKind: "unit" }, context, "attacker"),
            (levers?.buffs ?? []).some((lever) => selectedIds.has(lever.id)),
          );
        }
      }
    }
    for (const detachmentId of spec.detachmentIds) {
      for (const enhancement of dataset.enhancements) {
        if (enhancement.detachment_id !== detachmentId || !enhancement.ability_id) continue;
        if (!canTakeEnhancement(dataset, enhancement, member.unit)) continue;
        const ability = dataset.abilities.getInFaction(enhancement.ability_id, member.unit.factionId) ?? dataset.abilities.getAny(enhancement.ability_id);
        if (!ability) continue;
        const source: BuffSource = { kind: "ability", abilityId: ability.id, abilityKind: "unit" };
        gather(
          { side: "attacker", abilityId: ability.id, sourceKind: "enhancement", sourceUnitId: member.unit.id },
          ability,
          ability.describeBuffs(source, context, "attacker"),
          selectedIds.has(`enhancement:${enhancement.id}@${member.unit.id}`),
        );
      }
    }
  }

  const target = state.target.unitRaw;
  const targetContext: EngineContext = state.contextFor({ ...spec, members: [], selectedLeverIds: [], detachmentIssues: [], detachmentIds: [] });
  for (const eligible of dataset.eligibleAbilities({ unitId: target.id, factionId: target.faction_id }, targetContext.phase)) {
    const translation = eligible.ability.describeBuffs(sourceOf(eligible), targetContext, "target", eligible.rating);
    const choice = translation.activatable.length > 0
      ? { ...translation, unsupported: [...translation.unsupported, { reason: "defensive activatable choice is not selected by the attacker benchmark", effectFragment: null }] }
      : translation;
    gather({ side: "target", abilityId: eligible.ability.id, sourceKind: eligible.source.kind }, eligible.ability, choice, translation.applied.length > 0);
  }

  return [...gathered.values()]
    .map(({ entry, ability, translations, applied, dropped }) => ({
      ...entry,
      ...(dropped
        ? { status: "rejected" as const, relevant: false, reasons: ["dropped by configuration"] }
        : classify(ability, entry.side, translations, applied)),
    }))
    .sort((left, right) => entryKey(left).localeCompare(entryKey(right)));
}
