/**
 * Walks the dataset for every ability that could apply to a chosen unit in a
 * chosen phase. The SPA passes the result through to the buff layer (each
 * {@link EligibleAbility} carries `.getBuffs()`, the source is pre-tagged).
 *
 * Resolution order — stable for snapshot tests:
 *
 * 1. **army** — faction-scoped abilities whose `ability_type` is `"faction"`
 *    and whose `faction_id` matches the input. One with a `detachment_id` (a
 *    Combat Patrol's own army rule) applies only in that detachment, and there
 *    drops each army rule it `replaces` (`interactions`). In a Combat Patrol
 *    detachment only the army rules its `detachment_rule_ids` list apply.
 * 2. **detachment** — abilities authored against the detachment
 *    (`ability_type` is `"detachment"`, `detachment_id` matches).
 * 3. **detachment-stratagem** — stratagems on the detachment, each yielding
 *    the ability referenced by `stratagem.ability_id` (if any), when the
 *    combined unit can be the stratagem's friendly target (its keywords).
 * 4. **unit** — abilities listed in `unit.ability_ids`.
 * 5. **attached** — abilities of each attached member. A leader + bodyguard
 *    (and, in 11th, support) form one combined unit, so every member's
 *    abilities apply to the whole unit — pulled in full (not aura-filtered),
 *    whichever member is the selected/firing unit.
 * 6. **support** — abilities on supporting units whose effects can reach
 *    another unit (auras, unit selections, or friendly/enemy target filters).
 *
 * Each step phase-filters via the existing `Dataset.phasesFor` index. The
 * resolver collects abilities first, *then* filters by phase, so the SPA can
 * also ask "what abilities are eligible across all phases?" by passing every
 * phase (today the API requires a single phase; if the SPA wants the wide
 * view it can call the resolver once per phase).
 */
import type { Phase, Stratagem } from "../generated.js";
import type { Dataset } from "../data/dataset.js";
import type { AbilityView } from "../data/entities.js";
import { abilityRefId, abilityRefValue, abilityRefWargear } from "../data/ability-refs.js";
import { normalizeName } from "../data/normalize.js";

export type EligibleAbilitySource =
  | { kind: "army" }
  | { kind: "detachment"; detachmentId: string }
  /** `selectsModel`: the Stratagem targets one model of the unit (`target_restrictions.selects: "model"`). */
  | { kind: "detachment-stratagem"; stratagemId: string; cpCost: number; selectsModel?: true }
  | { kind: "unit"; unitId: string; wargearId?: string }
  | { kind: "attached"; unitId: string; wargearId?: string }
  | { kind: "support"; sourceUnitId: string };

export type EligibilityInput = {
  unitId: string;
  /** Overrides the unit's own `faction_id` when given (for inheritance cases). */
  factionId?: string;
  detachmentId?: string;
  /**
   * Other members of the combined ("attached") unit — the attached leader, its
   * bodyguard, or (11th) support attachments — whichever is *not* the selected
   * `unitId`. Their abilities are pooled onto the combined unit. A list so
   * multi-member attachments need no shape change; order is preserved.
   */
  attachedUnitIds?: string[];
  /** Actual roles within this attached unit, keyed by unit id; never inferred from datasheet abilities. */
  attachmentRoles?: Readonly<Record<string, "leader" | "bodyguard">>;
  /** Friendly units whose auras could apply (M2 walks only their aura-ranged abilities). */
  supportingUnitIds?: string[];
};

export type EligibleAbility = {
  ability: AbilityView;
  source: EligibleAbilitySource;
  /** The subset of `ability.phases` that intersect the requested phase. */
  phases: Phase[];
  /** The rating the owning unit prints for a rated rule (Feel No Pain 5+ → 5). */
  rating?: string | number;
};

/** Compute the sorted-by-source eligible-ability list for one (unit, phase). */
export function resolveEligibleAbilities(
  dataset: Dataset,
  input: EligibilityInput,
  phase: Phase,
): EligibleAbility[] {
  const { entries, suppressed } = resolveWithSuppressions(dataset, input, phase);
  return suppressed.size === 0 ? entries : entries.filter((entry) => !suppressed.has(entry.ability.id));
}

/**
 * The ability ids the unit's standing rules suppress for `input` (see
 * {@link resolveEligibleAbilities}, which already drops them). A caller that pools several
 * detachments' passes drops each pass's suppressions from all of them.
 */
export function suppressedAbilities(dataset: Dataset, input: EligibilityInput, phase: Phase): ReadonlySet<string> {
  return resolveWithSuppressions(dataset, input, phase).suppressed;
}

function resolveWithSuppressions(
  dataset: Dataset,
  input: EligibilityInput,
  phase: Phase,
): { entries: EligibleAbility[]; suppressed: Set<string> } {
  // Resolve units within the faction when one is known. Unit ids are shared
  // across factions (a shared chassis like `chaos-land-raider` lives under
  // several Chaos factions), so a faction-blind `get` can return the wrong
  // faction's copy — and with it the wrong intrinsic abilities/keywords.
  const resolveUnit = (id: string, fid: string | undefined) =>
    (fid ? dataset.units.getInFaction(id, fid) : undefined) ?? dataset.units.getAny(id);

  const unit = resolveUnit(input.unitId, input.factionId);
  if (!unit) return { entries: [], suppressed: new Set() };
  const factionId = input.factionId ?? unit.raw.faction_id;
  const seen = new Set<string>();
  const out: EligibleAbility[] = [];

  // 1. Army — faction-scoped abilities (faction rule + any other faction-typed). An army rule
  // with a `detachment_id` is a Combat Patrol box's own army rule: it applies only in that
  // detachment, and there it replaces each army rule it names with `interactions` `replaces`.
  // A Combat Patrol detachment's `detachment_rule_ids` are its complete army-rule set.
  const replaced = replacedArmyRuleIds(dataset, factionId, [input.detachmentId]);
  // Each member's keywords (lower-cased); a unit target reads them as one combined unit.
  const members = [unit, ...(input.attachedUnitIds ?? []).map((id) => resolveUnit(id, factionId))]
    .map((member) => memberKeywords(member, input.detachmentId));
  const printed = printedKeyword(dataset);
  const applies = (ability: AbilityView) => appliesToUnit(ability.raw.applies_to, members, printed);
  for (const ability of dataset.abilities.byFaction(factionId)) {
    if (ability.raw.ability_type !== "faction") continue;
    if (ability.raw.detachment_id != null && ability.raw.detachment_id !== input.detachmentId) continue;
    if (replaced.has(ability.id)) continue;
    if (!phaseMatches(ability, phase)) continue;
    if (!applies(ability)) continue;
    pushUnique(out, seen, { ability, source: { kind: "army" }, phases: intersect(ability.phases, phase) });
  }

  // 2. Detachment abilities — abilities whose detachment_id matches.
  if (input.detachmentId) {
    for (const ability of dataset.abilities) {
      if (ability.raw.ability_type !== "detachment") continue;
      if (ability.raw.detachment_id !== input.detachmentId) continue;
      if (!phaseMatches(ability, phase)) continue;
      if (!applies(ability)) continue;
      pushUnique(out, seen, {
        ability,
        source: { kind: "detachment", detachmentId: input.detachmentId },
        phases: intersect(ability.phases, phase),
      });
    }

    // 3. Detachment stratagems. A generic Codex detachment id is shared across
    // every faction's view, so prefer the copy in the resolving faction (its
    // stratagem list is identical across copies, but this keeps lookups
    // faction-correct); fall back to the first registered copy.
    const detachment =
      dataset.detachments.getInFaction(input.detachmentId, factionId) ??
      dataset.detachments.getAny(input.detachmentId);
    if (detachment) {
      for (const stratId of detachment.stratagem_ids ?? []) {
        const stratagem = dataset.stratagems.get(stratId);
        if (!stratagem) continue;
        if (!stratagemPhaseMatches(stratagem, phase)) continue;
        const ability =
          stratagem.ability_id !== null && stratagem.ability_id !== undefined
            ? // Ability ids are unique: one record per stratagem, wherever its detachment is replicated.
              dataset.abilities.get(stratagem.ability_id)
            : undefined;
        if (!ability) continue;
        const trigger = ability.raw.trigger as { subject?: unknown } | null | undefined;
        if (!stratagemCanTargetUnit(stratagem, members, trigger?.subject, printed)) continue;
        // A Stratagem with no friendly target restriction keeps its unit requirement in its rule's `applies_to`.
        if (!hasFriendlyTarget(stratagem) && !applies(ability)) continue;
        pushUnique(out, seen, {
          ability,
          source: {
            kind: "detachment-stratagem",
            stratagemId: stratagem.id,
            cpCost: stratagem.cp_cost,
            ...(stratagemSelectsModel(stratagem) ? { selectsModel: true as const } : {}),
          },
          phases: [phase], // the stratagem's printed phase governs eligibility.
        });
      }
    }
  }

  // 4. Unit's own abilities. A unit lists the army rules its datasheet prints, but an army rule is
  // the army's (step 1, which also applies a Combat Patrol's replacements), never the unit's own.
  for (const ref of unit.raw.ability_ids ?? []) {
    const ability = dataset.abilities.get(abilityRefId(ref));
    if (!ability || ability.raw.ability_type === "faction" || !phaseMatches(ability, phase)) continue;
    const wargearId = abilityRefWargear(ref);
    pushUnique(out, seen, {
      ability,
      source: { kind: "unit", unitId: input.unitId, ...(wargearId ? { wargearId } : {}) },
      phases: intersect(ability.phases, phase),
      ...rated(abilityRefValue(ref)),
    });
  }

  // 5. Attached members — the combined unit pools every member's abilities,
  // pulled in full (not aura-filtered like step 6), regardless of which member
  // is the selected/firing unit.
  for (const memberId of input.attachedUnitIds ?? []) {
    const member = resolveUnit(memberId, factionId);
    if (!member) continue;
    for (const ref of member.raw.ability_ids ?? []) {
      const ability = dataset.abilities.get(abilityRefId(ref));
      if (!ability || ability.raw.ability_type === "faction" || !phaseMatches(ability, phase)) continue;
      const wargearId = abilityRefWargear(ref);
      pushUnique(out, seen, {
        ability,
        source: { kind: "attached", unitId: memberId, ...(wargearId ? { wargearId } : {}) },
        phases: intersect(ability.phases, phase),
        ...rated(abilityRefValue(ref)),
      });
    }
  }

  // 6. Supporting units — only abilities that can reach another unit (an aura,
  // a friendly or enemy unit filter, a unit selection); an ability that only
  // names its own unit describes a buff that never reaches the input unit.
  for (const supportId of input.supportingUnitIds ?? []) {
    const supporter = resolveUnit(supportId, factionId);
    if (!supporter) continue;
    for (const ability of supporter.abilities) {
      if (ability.raw.ability_type === "faction") continue;
      if (!phaseMatches(ability, phase)) continue;
      if (!reachesOtherUnits(ability.raw.effect)) continue;
      pushUnique(out, seen, {
        ability,
        source: { kind: "support", sourceUnitId: supportId },
        phases: intersect(ability.phases, phase),
        ...rated(supporter.ratingOf(ability.id)),
      });
    }
  }

  return { entries: out, suppressed: suppressedAbilityIds(out, members, printed) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rated = (rating: string | number | undefined): { rating?: string | number } => (rating === undefined ? {} : { rating });

/**
 * The army rules of `factionId` that the selected detachments' own army rules replace: a
 * faction-typed record with a `detachment_id` among `detachmentIds` (a Combat Patrol box's army
 * rule) drops each record its `interactions` name with type `replaces`. A selected Combat Patrol
 * detachment (`game_modes` includes `combat-patrol`) lists its complete army-rule set in
 * `detachment_rule_ids`, so it also drops every faction-typed record it does not list. Callers
 * that combine several detachments pass all of them, so a rule replaced in one is not restored by
 * another.
 */
export function replacedArmyRuleIds(dataset: Dataset, factionId: string, detachmentIds: readonly (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  const army = dataset.abilities.byFaction(factionId).filter((ability) => ability.raw.ability_type === "faction");
  for (const ability of army) {
    if (ability.raw.detachment_id == null) continue;
    if (!detachmentIds.includes(ability.raw.detachment_id)) continue;
    for (const entry of ability.raw.interactions ?? []) if (entry.type === "replaces") out.add(entry.ability_ref);
  }
  for (const detachmentId of detachmentIds) {
    if (detachmentId === undefined) continue;
    const detachment = dataset.detachments.getInFaction(detachmentId, factionId) ?? dataset.detachments.getAny(detachmentId);
    if (!detachment || !isCombatPatrolDetachment(detachment)) continue;
    const listed = new Set(detachment.detachment_rule_ids ?? []);
    for (const ability of army) if (!listed.has(ability.id)) out.add(ability.id);
  }
  return out;
}

/** True when a detachment is a Combat Patrol box's (`game_modes` includes `combat-patrol`). */
export function isCombatPatrolDetachment(detachment: { game_modes?: readonly string[] | null }): boolean {
  return (detachment.game_modes ?? []).includes("combat-patrol");
}

function phaseMatches(ability: AbilityView, phase: Phase): boolean {
  const phases = ability.phases;
  // An ability with no phase-mapping is permissive — surface it everywhere so
  // the SPA can decide. M2's translator already gates conditional-on-phase
  // effects internally, so this stays generous on purpose.
  if (phases.length === 0) return true;
  return phases.includes(phase);
}

function stratagemPhaseMatches(stratagem: Stratagem, phase: Phase): boolean {
  if (!stratagem.phases || stratagem.phases.length === 0) return false;
  return (stratagem.phases as Phase[]).includes(phase);
}

type TargetRestriction = {
  name?: string; side?: string; selects?: string; bound_to?: string; warlord?: true;
  required_keywords?: string[]; required_keywords_any?: string[]; excluded_keywords?: string[];
  eligibility?: unknown;
};
type TriggerSubject = { owner?: string; all_of?: string[]; any_of?: string[]; none_of?: string[] };

/**
 * Whether a unit with `keywords` (lower-cased) can be a stratagem's friendly target. A stratagem
 * with no friendly target (none printed, or only enemy targets) does not restrict its user here;
 * with several friendly targets, matching any one is enough. The resolver does not know which
 * model is the Warlord, so a Warlord target only needs a unit that could contain it: one with
 * CHARACTER, the keyword every Warlord carries.
 */
export function stratagemCanTarget(stratagem: Stratagem, keywords: ReadonlySet<string>): boolean {
  return stratagemCanTargetUnit(stratagem, [keywords]);
}

/**
 * Whether a unit of `members` (each member's keywords: a unit and the units attached to it) can
 * be a stratagem's friendly target, as `stratagemCanTarget`. A target that selects a model needs
 * one member that meets it alone; a unit target reads every member as one combined unit. A target
 * bound to the triggering unit is also held to the keyword lists of the `triggerSubject` (the
 * stratagem's WHEN, its ability's `trigger.subject`), which say which friendly units can trigger
 * it. A keyword the WHEN requires that no datasheet prints (`printed` says which do) is one the
 * army gains in play, such as a detachment's designation, so it is not held against a unit.
 * Keywords compare by `normalizeName` (case, diacritics and apostrophe variants aside).
 */
export function stratagemCanTargetUnit(
  stratagem: Stratagem,
  members: readonly ReadonlySet<string>[],
  triggerSubject?: unknown,
  printed: (keyword: string) => boolean = () => true,
): boolean {
  const raw = stratagem.target_restrictions as TargetRestriction | TargetRestriction[] | null | undefined;
  if (!raw) return true;
  const friendly = (Array.isArray(raw) ? raw : [raw]).filter((target) => target.side !== "enemy");
  if (friendly.length === 0) return true;
  const holds = targetHolds(members, triggerSubject, printed);
  return friendly.some(holds);
}

/**
 * For a Stratagem with several targets (an array-form `target_restrictions`), whether a unit of
 * `members` can be each named friendly target, read as {@link stratagemCanTargetUnit} reads each
 * target: what `{stratagem_target: name}` resolves to when the Stratagem is used on that unit.
 * Enemy targets are not listed; a Stratagem with no named targets gives an empty record.
 */
export function stratagemTargetNames(
  stratagem: Stratagem,
  members: readonly ReadonlySet<string>[],
  triggerSubject?: unknown,
  printed: (keyword: string) => boolean = () => true,
): Record<string, boolean> {
  const raw = stratagem.target_restrictions as TargetRestriction | TargetRestriction[] | null | undefined;
  if (!Array.isArray(raw)) return {};
  const holds = targetHolds(members, triggerSubject, printed);
  return Object.fromEntries(raw
    .filter((target): target is TargetRestriction & { name: string } => target.side !== "enemy" && typeof target.name === "string")
    .map((target) => [target.name, holds(target)]));
}

/** Whether a unit of `members` meets one friendly Stratagem target (see {@link stratagemCanTargetUnit}). */
function targetHolds(members: readonly ReadonlySet<string>[], triggerSubject: unknown, printed: (keyword: string) => boolean): (target: TargetRestriction) => boolean {
  const normalized = members.map((member) => new Set([...member].map(normalizeName)));
  const combined = new Set(normalized.flatMap((member) => [...member]));
  const subject = friendlySubject(triggerSubject);
  return (target) => (target.selects === "model" ? normalized : [combined]).some((keywords) => {
    const has = (keyword: string) => keywords.has(normalizeName(keyword));
    const gained = (keyword: string) => has(keyword) || !printed(keyword);
    return (target.warlord !== true || has("character"))
      && keywordListsHold(target, has, has)
      && eligibilityKeywords(target.eligibility, (keyword) => has(keyword) || !printed(keyword), has) !== false
      && (target.bound_to !== "triggering-unit" || subject === null || keywordListsHold(subject, gained, has));
  });
}

/**
 * Whether some datasheet prints a keyword (unit or faction keyword), memoised per lookup.
 * Counts every game mode's datasheets: a keyword printed only on a Combat Patrol unit is
 * still printed, whatever view the caller's dataset lists.
 */
export function printedKeyword(dataset: Dataset): (keyword: string) => boolean {
  const seen = new Map<string, boolean>();
  const every = dataset.forGameMode("all");
  return (keyword) => {
    const key = normalizeName(keyword);
    let found = seen.get(key);
    if (found === undefined) {
      found = [...every.units].some((unit) => [...(unit.keywords ?? []), ...(unit.factionKeywords ?? []),
        ...(unit.raw.conditional_keywords ?? []).map((entry) => entry.keyword)].some((own) => normalizeName(own) === key));
      seen.set(key, found);
    }
    return found;
  };
}

/** A trigger subject's keyword lists when it names a friendly unit, else null. */
function friendlySubject(subject: unknown): TargetRestriction | null {
  if (subject === null || typeof subject !== "object" || Array.isArray(subject)) return null;
  const { owner, all_of: all, any_of: any, none_of: none } = subject as TriggerSubject;
  if (owner !== undefined && owner !== "friendly") return null;
  return { required_keywords: all ?? [], required_keywords_any: any ?? [], excluded_keywords: none ?? [] };
}

/** Whether the required lists hold by `required` and no excluded keyword holds by `excluded`. */
function keywordListsHold(target: TargetRestriction, required: (keyword: string) => boolean, excluded: (keyword: string) => boolean): boolean {
  return (target.required_keywords ?? []).every(required)
    && ((target.required_keywords_any ?? []).length === 0 || target.required_keywords_any!.some(required))
    && !(target.excluded_keywords ?? []).some(excluded);
}

/**
 * A member's keywords, lower-cased: its datasheet and faction keywords, plus each conditional
 * keyword whose detachment is the one selected.
 */
function memberKeywords(member: { keywords?: readonly string[]; factionKeywords?: readonly string[]; raw: { conditional_keywords?: readonly { keyword: string; required_detachment_id?: string | null }[] | null } } | undefined, detachmentId: string | undefined): Set<string> {
  if (!member) return new Set();
  const conditional = (member.raw.conditional_keywords ?? [])
    .filter((entry) => entry.required_detachment_id == null || entry.required_detachment_id === detachmentId)
    .map((entry) => entry.keyword);
  return new Set([...(member.keywords ?? []), ...(member.factionKeywords ?? []), ...conditional].map((keyword) => keyword.toLowerCase()));
}

/**
 * Whether a rule's `applies_to` admits a unit of `members`, read as one combined unit. An absent
 * filter admits every unit. A required keyword no datasheet prints is one the army gains in play,
 * so it is not held against the unit, as for a Stratagem's WHEN.
 */
function appliesToUnit(filter: unknown, members: readonly ReadonlySet<string>[], printed: (keyword: string) => boolean): boolean {
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) return true;
  const combined = new Set(members.flatMap((member) => [...member].map(normalizeName)));
  const has = (keyword: string) => combined.has(normalizeName(keyword));
  return keywordPredicateHolds(filter as Record<string, unknown>, (keyword) => has(keyword) || !printed(keyword), has) !== false;
}

/** A static keyword predicate's verdict, or undefined when it names anything but keyword lists. */
function keywordPredicateHolds(filter: Record<string, unknown>, required: (keyword: string) => boolean, excluded: (keyword: string) => boolean): boolean | undefined {
  const lists = (key: string) => (Array.isArray(filter[key]) ? (filter[key] as unknown[]).filter((item): item is string => typeof item === "string") : []);
  if (Object.keys(filter).some((key) => !["all_of", "any_of", "none_of", "not_all_of", "owner"].includes(key))) return undefined;
  if (filter.owner !== undefined && filter.owner !== "friendly") return undefined;
  const anyOf = lists("any_of");
  const notAllOf = lists("not_all_of");
  return lists("all_of").every(required)
    && (anyOf.length === 0 || anyOf.some(required))
    && !lists("none_of").some(excluded)
    && (notAllOf.length === 0 || !notAllOf.every(excluded));
}

/**
 * The verdict of a Stratagem target's `eligibility` on the target's own keywords: each `matches`
 * on the target unit whose filter is only keyword lists is decided, and/or/not combine them, and
 * anything else (battlefield state, history) is undefined. Undefined never refuses the target.
 */
function eligibilityKeywords(condition: unknown, required: (keyword: string) => boolean, excluded: (keyword: string) => boolean): boolean | undefined {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) return undefined;
  const node = condition as Record<string, unknown>;
  if (typeof node.operator === "string" && Array.isArray(node.operands)) {
    const values = node.operands.map((operand) => eligibilityKeywords(operand, required, excluded));
    if (node.operator === "and") return values.includes(false) ? false : values.every((value) => value === true) ? true : undefined;
    if (node.operator === "or") return values.includes(true) ? true : values.every((value) => value === false) ? false : undefined;
    if (node.operator === "not" && values.length === 1) return values[0] === undefined ? undefined : !values[0];
    return undefined;
  }
  if (node.type !== "matches" || node.parameters === null || typeof node.parameters !== "object") return undefined;
  const params = node.parameters as Record<string, unknown>;
  if (params.subject !== undefined && params.subject !== "this-unit") return undefined;
  if (params.filter === null || typeof params.filter !== "object" || Array.isArray(params.filter)) return undefined;
  return keywordPredicateHolds(params.filter as Record<string, unknown>, required, excluded);
}

/** Source kinds whose rules hold for the unit without a player choosing them in play. */
const STANDING_SOURCES: ReadonlySet<string> = new Set(["army", "detachment", "unit", "attached"]);

/**
 * The abilities the unit's standing rules suppress: a `rule-state` that suppresses an ability
 * (named by id) for this unit, or for friendly units whose keywords the unit has, under
 * conditions that are only keyword checks on the unit that hold. A Stratagem's, a supporting
 * unit's, or a triggered or battlefield-conditioned suppression is left to play.
 */
function suppressedAbilityIds(entries: readonly EligibleAbility[], members: readonly ReadonlySet<string>[], printed: (keyword: string) => boolean): Set<string> {
  const combined = new Set(members.flatMap((member) => [...member].map(normalizeName)));
  const has = (keyword: string) => combined.has(normalizeName(keyword));
  const required = (keyword: string) => has(keyword) || !printed(keyword);
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node === null || typeof node !== "object") return;
    const effect = node as Record<string, unknown>;
    if (effect.type === "conditional") {
      if (eligibilityKeywords(effect.condition, required, has) === true) walk(effect.effect);
      return;
    }
    if (effect.type === "sequence" || effect.type === "rules-bundle") { walk(effect.steps); return; }
    if (effect.type !== "rule-state" || effect.modifier === null || typeof effect.modifier !== "object") return;
    const modifier = effect.modifier as Record<string, unknown>;
    if (modifier.direction !== "suppressed" || modifier.rule_kind !== "ability" || typeof modifier.rule !== "string") return;
    const target = effect.target;
    const reaches = target === "this-unit" || (target !== null && typeof target === "object" && !Array.isArray(target) &&
      keywordPredicateHolds(target as Record<string, unknown>, required, has) === true);
    if (reaches) out.add(modifier.rule);
  };
  for (const entry of entries) if (STANDING_SOURCES.has(entry.source.kind)) walk(entry.ability.raw.effect);
  return out;
}

/** Whether a Stratagem names a friendly target in `target_restrictions`. */
function hasFriendlyTarget(stratagem: Stratagem): boolean {
  const raw = stratagem.target_restrictions as TargetRestriction | TargetRestriction[] | null | undefined;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).some((target) => target.side !== "enemy");
}

/** Whether a Stratagem's friendly target is one model rather than a unit. */
function stratagemSelectsModel(stratagem: Stratagem): boolean {
  const raw = stratagem.target_restrictions as TargetRestriction | TargetRestriction[] | null | undefined;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).some((target) => target.side !== "enemy" && target.selects === "model");
}

function intersect(phases: Phase[], phase: Phase): Phase[] {
  return phases.includes(phase) ? [phase] : phases;
}

/**
 * Whether an effect can reach a unit other than its own: an aura, a unit-filter target (friendly
 * or enemy), or a unit selection. The translator decides what of it reaches the input unit.
 */
export function reachesOtherUnits(effect: unknown): boolean {
  if (Array.isArray(effect)) return effect.some(reachesOtherUnits);
  if (effect === null || typeof effect !== "object") return false;
  const node = effect as Record<string, unknown>;
  if (node.type === "aura" || node.type === "select-units") return true;
  const target = node.target;
  if (target !== null && typeof target === "object" && !Array.isArray(target) && "owner" in target) {
    if (target.owner === "friendly" || target.owner === "enemy") return true;
  }
  // A model-only grant's definition cannot become an aura from the whole unit.
  if (node.type === "ability-grant" && (target === "this-model" || target === "model-in-this-unit"
    || (target !== null && typeof target === "object" && "level" in target && target.level === "model"))) return false;
  return Object.values(node).some(reachesOtherUnits);
}

function pushUnique(
  out: EligibleAbility[],
  seen: Set<string>,
  entry: EligibleAbility,
): void {
  const key = `${entry.source.kind}::${entry.ability.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(entry);
}
