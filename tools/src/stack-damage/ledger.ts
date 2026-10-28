import type { BuffSource, EngineContext } from "../cruncher/index.js";
import { effectToBuffs, POST_ATTACK_MOMENT, type EffectTranslation, type UnsupportedFragment } from "../cruncher/from-dsl.js";
import type { EligibleAbility } from "../abilities-resolver/index.js";
import type { AbilityView } from "../data/entities.js";
import { canTakeEnhancement, grantedRecordIds, grantedRecordLevers } from "../data/lever-providers.js";
import type { DamageScoringSession } from "./scoring.js";
import type { StackMemberResult, StackResult } from "./model.js";
import { printedWargear, WEAPON_GRANT_REASON } from "./weapon-grants.js";

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

const CLASS_RANK: Record<FragmentClass, number> = { "out-of-scope": 0, "encounter-layer": 1, unresolved: 2 };

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

/** One translation of a provider, with what it was translated against. */
interface Reading {
  translation: EffectTranslation;
  source: BuffSource;
  context: EngineContext;
  perspective: "attacker" | "target";
  /** What the loadout scoring made of each weapon grant, by `abilityId|weaponId`. */
  grantNotes?: ReadonlyMap<string, string>;
}

/** The loadout-scoring note for a weapon-grant fragment, if the member's loadout scored it. */
function grantNote(fragment: UnsupportedFragment, reading: Reading): string | undefined {
  const node = fragment.effectFragment as { modifier?: { weapon_id?: unknown } } | null;
  if (fragment.reason !== WEAPON_GRANT_REASON || reading.source.kind !== "ability") return undefined;
  return reading.grantNotes?.get(`${reading.source.abilityId}|${String(node?.modifier?.weapon_id)}`);
}

/**
 * Notes for every weapon grant a member's loadout scored, and the abilities whose granted
 * weapons it fired.
 */
function memberGrants(session: DamageScoringSession, result: StackResult, scored: StackMemberResult): { notes: Map<string, string>; fired: Set<string> } {
  const { member, loadout } = scored;
  const grants = session.weaponGrants(member.unit, loadout.counts, session.state.contextFor(result.spec, member));
  const notes = new Map<string, string>();
  const fired = new Set<string>();
  for (const grant of grants.grants) {
    const carriers = loadout.counts.get(grant.wargearId) ?? 0;
    const shot = loadout.selectedWeapons.some((weapon) => weapon.weaponId === grant.weaponId && weapon.count > 0 && weapon.damage > 0);
    if (carriers > 0 && shot) fired.add(grant.abilityId);
    notes.set(`${grant.abilityId}|${grant.weaponId}`, carriers === 0
      ? `weapon-grant: ${grant.weaponId} needs ${grant.wargearId}, which the chosen loadout does not include`
      : shot
        ? `weapon-grant: ${grant.weaponId} is scored on the ${carriers} ${grant.wargearId} carrier(s)`
        : `weapon-grant: ${grant.weaponId} on the ${grant.wargearId} carrier(s) adds no damage`);
  }
  for (const duplicate of grants.duplicates) {
    notes.set(`${duplicate.abilityId}|${duplicate.weaponId}`,
      `weapon-grant: ${duplicate.weaponId} duplicates the ${duplicate.wargearId} grant of ${duplicate.ownerAbilityId}`);
  }
  return { notes, fired };
}

const UNKNOWN_CONDITION = /^conditional: cannot evaluate condition /u;

/**
 * An unevaluable condition matters only as much as what it gates: its body is translated as if
 * the condition held, and a body that yields no buff or lever and whose own fragments are all out
 * of scope (or all encounter-layer) takes that class. A body that could change the attack keeps
 * the condition unresolved.
 */
function gatedBodyClass(fragment: UnsupportedFragment, ownId: string, reading: Reading, depth: number): FragmentClass {
  const node = fragment.effectFragment as { type?: unknown; effect?: unknown } | null;
  if (depth >= 4 || !node || node.type !== "conditional" || node.effect === undefined) return "unresolved";
  const body = effectToBuffs(node.effect, reading.source, reading.context, reading.perspective);
  if (body.applied.length > 0 || body.activatable.length > 0) return "unresolved";
  const classes = body.unsupported.map((inner) => fragmentClass(inner, ownId, reading, depth + 1));
  if (classes.includes("unresolved")) return "unresolved";
  return classes.includes("encounter-layer") ? "encounter-layer" : "out-of-scope";
}

function fragmentClass(fragment: UnsupportedFragment, ownId: string, reading: Reading, depth = 0): FragmentClass {
  if (UNKNOWN_CONDITION.test(fragment.reason)) return gatedBodyClass(fragment, ownId, reading, depth);
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
  readings: readonly Reading[],
  applied: boolean,
): Pick<LedgerEntry, "status" | "relevant" | "reasons"> {
  const encounter = encounterTrigger(ability, side);
  const fragments = new Map<string, FragmentClass>();
  for (const reading of readings) {
    for (const fragment of reading.translation.unsupported) {
      // A weapon grant the loadout scored is resolved there, whether or not it fired.
      const note = grantNote(fragment, reading);
      const kind = note ? "out-of-scope" : fragmentClass(fragment, ability.id, reading);
      const settled = encounter && kind === "unresolved" ? "encounter-layer" : kind;
      const reason = note ?? fragment.reason;
      // One reason can arise from several fragments; the most consequential class wins.
      const previous = fragments.get(reason);
      if (previous === undefined || CLASS_RANK[settled] > CLASS_RANK[previous]) fragments.set(reason, settled);
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
  const offers = readings.some(({ translation }) => translation.applied.length > 0 || translation.activatable.length > 0);
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

  const gathered = new Map<string, { entry: Omit<LedgerEntry, "status" | "relevant" | "reasons">; ability: AbilityView; readings: Reading[]; applied: boolean; dropped: boolean; unequipped?: string | null }>();
  /** `unequipped` names the wargear a member's printed rule needs and its loadout lacks; null when it has it. */
  const gather = (
    entry: Omit<LedgerEntry, "status" | "relevant" | "reasons">,
    ability: AbilityView,
    reading: Reading,
    applied: boolean,
    unequipped?: string | null,
  ) => {
    const key = entryKey(entry);
    const current = gathered.get(key) ?? { entry, ability, readings: [], applied: false, dropped: config.droppedArmyRules.includes(ability.id) };
    current.readings.push(reading);
    current.applied ||= applied;
    // A rule is unequipped only when no member that prints it carries its wargear.
    if (unequipped !== undefined) current.unequipped = current.unequipped === null || unequipped === null ? null : unequipped;
    gathered.set(key, current);
  };

  // A rule a selected detachment's Combat Patrol army rule replaces is not eligible in any pass.
  const replaced = session.replacedArmyRules(spec);
  const scoredBy = new Map(result.members.map((scored) => [scored.member.unit.id, scored]));
  /** The wargear `unitId`'s winning loadout lacks for its printed rule `abilityId`; null when carried, undefined when no item prints it. */
  const unequippedOf = (abilityId: string, unitId: string | undefined): string | null | undefined => {
    const owner = unitId === undefined ? undefined : scoredBy.get(unitId);
    const wargear = owner && printedWargear(owner.member.unit.raw).get(abilityId);
    if (!owner || !wargear) return undefined;
    return (owner.loadout.counts.get(wargear) ?? 0) > 0 ? null : wargear;
  };
  for (const scored of result.members) {
    const { member } = scored;
    // Conditions read the winning loadout's wargear; its weapon grants were scored with it.
    const context = session.loadoutContext(member.unit, scored.loadout.counts, state.contextFor(spec, member));
    const grants = memberGrants(session, result, scored);
    for (const detachmentId of spec.detachmentIds.length > 0 ? spec.detachmentIds : [undefined]) {
      const input = session.eligibilityInput(spec, member, detachmentId);
      for (const eligible of dataset.eligibleAbilities(input, context.phase)) {
        if (eligible.source.kind === "army" && replaced.has(eligible.ability.id)) continue;
        const source = sourceOf(eligible);
        const translation = eligible.ability.describeBuffs(source, context, "attacker", eligible.rating);
        const sourceUnitId = eligible.source.kind === "support" ? eligible.source.sourceUnitId
          : eligible.source.kind === "attached" ? eligible.source.unitId : undefined;
        gather(
          { side: "attacker", abilityId: eligible.ability.id, sourceKind: eligible.source.kind, ...(sourceUnitId ? { sourceUnitId } : {}) },
          eligible.ability,
          { translation, source, context, perspective: "attacker", grantNotes: grants.notes },
          selectedSources.has(`${eligible.ability.id}|${source.kind === "ability" ? source.sourceUnitId ?? "" : ""}`)
            || (sourceUnitId === undefined && grants.fired.has(eligible.ability.id)),
          // A rule reaching through an attachment needs the wargear of the member that prints it.
          eligible.source.kind === "unit" ? unequippedOf(eligible.ability.id, member.unit.id)
            : eligible.source.kind === "attached" ? unequippedOf(eligible.ability.id, sourceUnitId)
            : undefined,
        );
        for (const { abilityId } of grantedRecordIds(translation)) {
          const record = dataset.abilities.getInFaction(abilityId, spec.factionId) ?? dataset.abilities.getAny(abilityId);
          if (!record) continue;
          const levers = grantedRecordLevers(dataset, abilityId, spec.factionId, { abilityId: eligible.ability.id, source, enabled: false }, context);
          const grantedSource: BuffSource = { kind: "ability", abilityId: record.id, abilityKind: "unit" };
          gather(
            { side: "attacker", abilityId, sourceKind: "granted", grantedBy: eligible.ability.id },
            record,
            { translation: record.describeBuffs(grantedSource, context, "attacker"), source: grantedSource, context, perspective: "attacker" },
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
          { translation: ability.describeBuffs(source, context, "attacker"), source, context, perspective: "attacker" },
          selectedIds.has(`enhancement:${enhancement.id}@${member.unit.id}`),
        );
      }
    }
  }

  const target = state.target.unitRaw;
  const targetContext: EngineContext = state.contextFor({ ...spec, members: [], selectedLeverIds: [], detachmentIssues: [], detachmentIds: [] });
  for (const eligible of dataset.eligibleAbilities({ unitId: target.id, factionId: target.faction_id }, targetContext.phase)) {
    const targetSource = sourceOf(eligible);
    const translation = eligible.ability.describeBuffs(targetSource, targetContext, "target", eligible.rating);
    const choice = translation.activatable.length > 0
      ? { ...translation, unsupported: [...translation.unsupported, { reason: "defensive activatable choice is not selected by the attacker benchmark", effectFragment: null }] }
      : translation;
    gather(
      { side: "target", abilityId: eligible.ability.id, sourceKind: eligible.source.kind },
      eligible.ability,
      { translation: choice, source: targetSource, context: targetContext, perspective: "target" },
      translation.applied.length > 0,
    );
  }

  return [...gathered.values()]
    .map(({ entry, ability, readings, applied, dropped, unequipped }) => ({
      ...entry,
      ...(dropped
        ? { status: "rejected" as const, relevant: false, reasons: ["dropped by configuration"] }
        // Its buffs and grants were not scored, so a selected lever of it added nothing.
        : unequipped
          ? { status: "rejected" as const, relevant: false, reasons: [`the chosen loadout does not include ${unequipped}, whose rule this is`] }
          : classify(ability, entry.side, readings, applied)),
    }))
    .sort((left, right) => entryKey(left).localeCompare(entryKey(right)));
}
