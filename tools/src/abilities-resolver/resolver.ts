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
import { normalizeName } from "../data/normalize.js";

export type EligibleAbilitySource =
  | { kind: "army" }
  | { kind: "detachment"; detachmentId: string }
  /** `selectsModel`: the Stratagem targets one model of the unit (`target_restrictions.selects: "model"`). */
  | { kind: "detachment-stratagem"; stratagemId: string; cpCost: number; selectsModel?: true }
  | { kind: "unit"; unitId: string }
  | { kind: "attached"; unitId: string }
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
  // Resolve units within the faction when one is known. Unit ids are shared
  // across factions (a shared chassis like `chaos-land-raider` lives under
  // several Chaos factions), so a faction-blind `get` can return the wrong
  // faction's copy — and with it the wrong intrinsic abilities/keywords.
  const resolveUnit = (id: string, fid: string | undefined) =>
    (fid ? dataset.units.getInFaction(id, fid) : undefined) ?? dataset.units.getAny(id);

  const unit = resolveUnit(input.unitId, input.factionId);
  if (!unit) return [];
  const factionId = input.factionId ?? unit.raw.faction_id;
  const seen = new Set<string>();
  const out: EligibleAbility[] = [];

  // 1. Army — faction-scoped abilities (faction rule + any other faction-typed). An army rule
  // with a `detachment_id` is a Combat Patrol box's own army rule: it applies only in that
  // detachment, and there it replaces each army rule it names with `interactions` `replaces`.
  // A Combat Patrol detachment's `detachment_rule_ids` are its complete army-rule set.
  const replaced = replacedArmyRuleIds(dataset, factionId, [input.detachmentId]);
  for (const ability of dataset.abilities.byFaction(factionId)) {
    if (ability.raw.ability_type !== "faction") continue;
    if (ability.raw.detachment_id != null && ability.raw.detachment_id !== input.detachmentId) continue;
    if (replaced.has(ability.id)) continue;
    if (!phaseMatches(ability, phase)) continue;
    pushUnique(out, seen, { ability, source: { kind: "army" }, phases: intersect(ability.phases, phase) });
  }

  // 2. Detachment abilities — abilities whose detachment_id matches.
  if (input.detachmentId) {
    for (const ability of dataset.abilities) {
      if (ability.raw.ability_type !== "detachment") continue;
      if (ability.raw.detachment_id !== input.detachmentId) continue;
      if (!phaseMatches(ability, phase)) continue;
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
      // Each member's keywords (lower-cased); a unit target reads them as one combined unit.
      const members = [unit, ...(input.attachedUnitIds ?? []).map((id) => resolveUnit(id, factionId))]
        .map((member) => new Set([...(member?.keywords ?? []), ...(member?.factionKeywords ?? [])].map((keyword) => keyword.toLowerCase())));
      const printed = printedKeyword(dataset);
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

  // 4. Unit's own abilities.
  for (const ability of unit.abilities) {
    if (!phaseMatches(ability, phase)) continue;
    pushUnique(out, seen, {
      ability,
      source: { kind: "unit", unitId: input.unitId },
      phases: intersect(ability.phases, phase),
      ...rated(unit.ratingOf(ability.id)),
    });
  }

  // 5. Attached members — the combined unit pools every member's abilities,
  // pulled in full (not aura-filtered like step 6), regardless of which member
  // is the selected/firing unit.
  for (const memberId of input.attachedUnitIds ?? []) {
    const member = resolveUnit(memberId, factionId);
    if (!member) continue;
    for (const ability of member.abilities) {
      if (!phaseMatches(ability, phase)) continue;
      pushUnique(out, seen, {
        ability,
        source: { kind: "attached", unitId: memberId },
        phases: intersect(ability.phases, phase),
        ...rated(member.ratingOf(ability.id)),
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

  return out;
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
  side?: string; selects?: string; bound_to?: string; warlord?: true;
  required_keywords?: string[]; required_keywords_any?: string[]; excluded_keywords?: string[];
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
  const normalized = members.map((member) => new Set([...member].map(normalizeName)));
  const combined = new Set(normalized.flatMap((member) => [...member]));
  const subject = friendlySubject(triggerSubject);
  return friendly.some((target) => (target.selects === "model" ? normalized : [combined]).some((keywords) => {
    const has = (keyword: string) => keywords.has(normalizeName(keyword));
    const gained = (keyword: string) => has(keyword) || !printed(keyword);
    return (target.warlord !== true || has("character"))
      && keywordListsHold(target, has, has)
      && (target.bound_to !== "triggering-unit" || subject === null || keywordListsHold(subject, gained, has));
  }));
}

/**
 * Whether some datasheet prints a keyword (unit or faction keyword), memoised per lookup.
 * Counts every game mode's datasheets: a keyword printed only on a Combat Patrol unit is
 * still printed, whatever view the caller's dataset lists.
 */
function printedKeyword(dataset: Dataset): (keyword: string) => boolean {
  const seen = new Map<string, boolean>();
  const every = dataset.forGameMode("all");
  return (keyword) => {
    const key = normalizeName(keyword);
    let found = seen.get(key);
    if (found === undefined) {
      found = [...every.units].some((unit) => [...(unit.keywords ?? []), ...(unit.factionKeywords ?? [])].some((own) => normalizeName(own) === key));
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
