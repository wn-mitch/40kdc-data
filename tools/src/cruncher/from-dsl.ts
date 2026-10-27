/**
 * Translate an Ability DSL `effect` tree into the {@link Buff} stack it
 * contributes (for an attacker-perspective crunch) along with a list of
 * effect fragments the translator could not auto-apply.
 *
 * The buff layer is intentionally a subset of the DSL: it covers the math the
 * cruncher's expected-value engine reads (rerolls, die-roll modifiers, S/A/T
 * stat shifts, FNP, granted weapon keywords, cover) and reports everything
 * else — choice nodes (player decisions), dice-gated effects (stochastic),
 * defender-side bs-modifier, attack-restrictions, unsupported ability grants,
 * mortal wound triggers — as `unsupported` so the SPA can surface "this
 * ability has effects we can't auto-apply" rather than silently dropping them.
 *
 * The walker classifies an effect's `target` unit-ref against the attacker
 * perspective: `this-unit`, `this-model`, `selected-unit`, `recipient`,
 * `attacker`, and a `{owner: "friendly"}` unit filter are all treated as
 * "applies to my unit" (an `aura` container's `friendly-within-aura` likewise).
 * `defender`, a `{owner: "enemy"}` filter, and `enemy-within-aura` are dropped
 * without being marked unsupported — those are defender-side mods and surface
 * from the target's perspective, not the attacker's. An `event-subject` under a
 * trigger naming who acts is bound to the buffed unit or to another unit (see
 * `bindEventSubject`); any binding still unknown (`event-subject`,
 * `event-object`, `stratagem-target`, `bearer-transport`) is reported as
 * unsupported rather than silently dropped.
 *
 * The one exception is core rule 19.04: `this-model` names a single *model*,
 * so when such an effect is pooled in from another member of a combined unit
 * (`source.abilityKind === "attached"`) it stays on that model and is reported
 * as `unsupported` rather than buffing the whole unit.
 *
 * @packageDocumentation
 */
import type {
  AttackComparison,
  Buff,
  BuffApplicability,
  BuffContribution,
  BuffSource,
  EngineContext,
  WeaponKeywordRef,
} from "./buffs.js";
import type { Phase } from "../generated.js";
import { bindEachRecipient, bindEventSubject, planSelection } from "./from-dsl-selection.js";
import { matchesUnitFilter } from "./unit-filter.js";
import { attachmentFromMembers, evaluateControls, evaluateInRegion, evaluateRuleActive } from "./scenario-conditions.js";
import { RECIPIENT_SNAPSHOT_UNAVAILABLE, resolveRecipientSnapshots } from "./recipient-snapshots.js";
import { resolveNamedWeaponBindings } from "./weapon-bindings.js";

/** A fragment we couldn't translate. The SPA can render these as warnings. */
export type UnsupportedFragment = {
  reason: string;
  effectFragment: unknown;
};

const stochasticDiceGatedReason = "dice-gated effect: stochastic; not expressible as a buff";

/**
 * A mutually-limited pool of {@link ActivatableBuff} levers. Dice-pool
 * allocations cap how many options fire at once (`max_activations`); a `choice`
 * lets the player pick exactly one. Levers sharing a `group.id` are subject to
 * that cap — the SPA greys out further checkboxes once it's reached, and an
 * optimizer enumerates subsets within it.
 */
export type ActivatableGroupRef = {
  id: string;
  maxActivations: number;
};

/**
 * A buff-bearing *player decision* the cruncher can't make on its own: a
 * dice-pool option, a `choice` branch, or an activation gated on a timing the
 * player controls (e.g. "start of phase"). It is not auto-applied — the
 * consumer opts in (a checkbox, or an optimizer's search) and then folds
 * {@link buffs} into the crunch. Conditions the activation still carries (a
 * target keyword, a phase) ride on each buff's `applicableWhen`, so the
 * resolver gates them per-target rather than the lever vanishing.
 */
export type ActivatableBuff = {
  /** Stable toggle id, e.g. `"blessings-of-khorne#Warp Blades"`. */
  id: string;
  /** Human label for the lever (option name, or a summary of its buffs). */
  label: string;
  /** Contributions this activation adds when the player opts in (≥1, or none for a {@link capRaise} lever). */
  buffs: Buff[];
  /** Set when the lever belongs to a mutually-limited pool. */
  group?: ActivatableGroupRef;
  /**
   * The lever raises the cap of another ability's lever pool instead of adding buffs ("select one
   * more augmentation"): `ability` names that ability as the DSL does, `by` the extra activations.
   */
  capRaise?: { ability: string; by: number; allocation: "choose-one-option" | "fixed-option"; option?: { ability_id: string; option_id: string }; options?: { ability_id: string; option_id: string }[] };
  /** All enclosing activation pools apply, in addition to the option's own group. */
  groups?: ActivatableGroupRef[];
  /**
   * DSL fragments the player vouches for when opting in, in the order they apply: a unit
   * selection (its range, visibility and eligibility), a gating roll, a model count. Absent when
   * the lever assumes nothing beyond the choice itself.
   */
  requires?: unknown[];
  /**
   * The stance option the lever applies under: a `rule-active` gate on an option the context's
   * `activeRules` does not declare. The lever pool binds it to that option's own lever.
   */
  requiresOption?: StanceOptionRef;
  /** The stance option the lever does not apply under: a negated `rule-active` gate on it. */
  excludesOption?: StanceOptionRef;
};

/** One option of a `stance-select` rule, as a `rule-active` condition names it. */
export type StanceOptionRef = { ability_id: string; option_id: string };

/** A gate on a stance option: it holds while the option is picked, or, `negated`, while it is not. */
type StanceGate = { option: StanceOptionRef; negated: boolean };

/** The lever fields that carry `gate`. */
function stanceGateFields(gate: StanceGate | undefined): Pick<ActivatableBuff, "requiresOption" | "excludesOption"> {
  if (!gate) return {};
  return gate.negated ? { excludesOption: gate.option } : { requiresOption: gate.option };
}

export type EffectTranslation = {
  applied: Buff[];
  unsupported: UnsupportedFragment[];
  /** Buffs sitting behind a player decision — see {@link ActivatableBuff}. */
  activatable: ActivatableBuff[];
};

/**
 * Whose perspective the translation runs from.
 *
 * - `"attacker"`: the buffed unit is *firing*. `target: "this-unit"/"this-model"` etc.
 *   become attacker-side mods (re-rolls, hit/wound mods, A/S shifts, granted
 *   keywords). `target: "defender"` is silently dropped — that's incoming
 *   penalty math relevant when the buffed unit is the *target*, surfaced via
 *   the `"target"` perspective instead.
 *
 * - `"target"`: the buffed unit is *being shot at*. Defensive mods on the
 *   buffed unit (`stat-modifier T`, `stat-modifier Sv`, `feel-no-pain`,
 *   `roll-modifier save`) become defender-side buffs. Conversely, attacker-
 *   only mods (re-rolls, hit/wound mods, A/S shifts) drop silently because
 *   they describe what the buffed unit does when *attacking*.
 *
 * A Ballistic Skill stat-modifier on the attacker (a -1 to incoming hit rolls,
 * e.g. Benefit of Cover) becomes a `hit-mod` buff under target perspective so
 * it stacks correctly with attacker-side modifiers in the resolver's ±1 cap.
 */
export type TranslationPerspective = "attacker" | "target";

/** Targets that resolve to the buffed unit itself. */
const SELF_TARGETS = new Set(["this-unit", "ability-unit", "this-model", "selected-unit", "recipient"]);

/**
 * The subset of {@link SELF_TARGETS} that names a single *model* — the ability's
 * bearer — rather than its unit. Core rule 19.04: a rule affecting one specified
 * model applies only to that model, even while it is part of an attached unit.
 * So when such an effect arrives from an attached member (a leader pooled onto
 * its bodyguard, or vice-versa), it is not a buff on the combined unit — see
 * {@link isModelScopedFromAttachedMember}.
 */
const MODEL_TARGETS = new Set(["this-model", "model-in-this-unit"]);

/** Diagnostic emitted for a model-scoped effect pooled in from an attached member. */
const MODEL_SCOPED_REASON =
  "model-scoped effect from an attached model: applies to that model only (core rule 19.04)";

/**
 * Is this node a model-scoped effect reaching the buffed unit from *another*
 * member of the combined unit? Those are the ones core rule 19.04 keeps on their
 * own model: an attached Librarian's personal 4+ invulnerable save is not a 4+
 * invulnerable save for the ten Intercessors it joined.
 *
 * Keyed on the buff *source*, not on the DSL condition: the leak is not limited
 * to abilities gated on the attachment predicate. A personal model grant stays
 * isolated, and the resolver already tags pooled member abilities as
 * `abilityKind: "attached"`. An ability read as the chosen unit's own
 * (`abilityKind: "unit"`) is unaffected, so crunching the leader itself still
 * sees its personal buffs.
 */
function isModelScopedFromAttachedMember(
  node: Record<string, unknown>,
  source: BuffSource,
): boolean {
  if (source.kind !== "ability" || source.abilityKind !== "attached") return false;
  return typeof node.target === "string" && MODEL_TARGETS.has(node.target);
}

/** Unit-refs that name a unit the buff layer cannot identify with the buffed unit. */
const UNRESOLVED_TARGETS = new Set(["event-subject", "event-object", "stratagem-target", "bearer-transport"]);

/** Aliases the DSL uses when a node specifically calls out "the attacker". */
const ATTACKER_TARGET = "attacker";
/** The unit-ref that names the other side of an attack from the attacker's view. */
const DEFENDER_TARGETS = new Set(["defender"]);

/**
 * Walk an ability DSL `effect` tree and produce the buff stack it contributes
 * against `context` from the given `perspective`, plus an `unsupported` list
 * naming any branches the buff layer can't express today.
 */
export function effectToBuffs(
  effect: unknown,
  source: BuffSource,
  context: EngineContext,
  perspective: TranslationPerspective = "attacker",
  activation?: { usage?: unknown; cost?: unknown; optional?: boolean; duration?: unknown },
): EffectTranslation {
  const out: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
  if (recipientSnapshotReason(undefined, effect)) {
    const snapshot = resolveRecipientSnapshots(undefined, effect, source, isAttackStep, context, perspective, momentGate);
    if (snapshot.reason) {
      out.unsupported.push({ reason: snapshot.reason, effectFragment: effect });
      return out;
    }
    effect = snapshot.effect;
  }
  // A moment gate the data layer registered keeps its activation when the rewrite copies it.
  effect = resolveNamedWeaponBindings(effect, (from, to) => {
    const activation = activationSources.get(from);
    if (activation) activationSources.set(to, activation);
  });
  const abilityId = source.kind === "ability" ? source.abilityId : "effect";
  walk(effect, source, { context, perspective, abilityId, duration: activation?.duration }, out);
  if (activation?.usage != null || activation?.cost != null || activation?.optional === true) {
    const { duration: _duration, ...requirement } = activation;
    const requires = [requirement];
    const limits = (Array.isArray(activation.usage) ? activation.usage : [activation.usage]).filter(isObject);
    const counts = limits.filter((limit) => limit.per !== "model").map((limit) =>
      typeof limit.count === "number" ? limit.count : limit.frequency === "n-per-battle" ? undefined : 1).filter((count): count is number => count !== undefined);
    const group = counts.length > 0 ? { id: `${abilityId}?usage`, maxActivations: Math.min(...counts) } : undefined;
    if (out.applied.length > 0) out.activatable.push({ id: `${abilityId}#activate`, label: labelForBuffs(out.applied), buffs: out.applied.splice(0), group });
    for (const lever of out.activatable) {
      if (group && lever.group?.id !== group.id) {
        if (lever.group) lever.groups = [...(lever.groups ?? []), group];
        else lever.group = group;
      }
      lever.requires = [...requires, ...(lever.requires ?? [])];
    }
  }
  return out;
}

type WalkOpts = {
  context: EngineContext;
  perspective: TranslationPerspective;
  /** Owning ability id — seeds the stable ids of activatable levers. */
  abilityId: string;
  /** Inside a granted definition, self refs name its holder rather than its external provider. */
  grantedHolder?: boolean;
  /** Lifetime inherited from the owning ability or nearest ability part. */
  duration?: unknown;
};

function walk(
  node: unknown,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  if (!isObject(node)) return;
  const currentNode = node;
  // Core rule 19.04 gate, applied before any leaf translation and under both
  // perspectives. Container nodes cannot carry a self/bearer target, so this
  // cannot swallow a subtree containing unit-scoped effects.
  if (isModelScopedFromAttachedMember(currentNode, source)) {
    out.unsupported.push({ reason: MODEL_SCOPED_REASON, effectFragment: currentNode });
    return;
  }
  if (currentNode.target === "model-in-this-unit") {
    out.unsupported.push({ reason: "model-in-this-unit: individual model identity is unresolved", effectFragment: currentNode });
    return;
  }
  // An ability grant reports its own unresolved holders.
  if (typeof currentNode.target === "string" && UNRESOLVED_TARGETS.has(currentNode.target) && currentNode.type !== "ability-grant") {
    out.unsupported.push({ reason: `target "${currentNode.target}" is not resolved by the buff engine`, effectFragment: currentNode });
    return;
  }
  // A unit selection reaching the selected unit is a player lever; its eligibility is what the
  // player vouches for, so it is planned before the fidelity check below.
  if (currentNode.type === "select-units") {
    const plan = planSelection(currentNode, source, opts.perspective, opts.context);
    if (plan.kind !== "none") {
      translateSelection(plan, currentNode, source, opts, out);
      return;
    }
  }
  if (currentNode.type === "for-each-unit") {
    const bound = bindEachRecipient(currentNode);
    if (bound !== undefined) {
      walk(bound, source, opts, out);
      return;
    }
  }
  // These typed predicates require a selected model/history/visibility binding.
  // Keep the source representation intact rather than silently widening its buff.
  if (hasUnresolvedFidelityBinding(currentNode)) {
    out.unsupported.push({ reason: FIDELITY_BINDING_REASON, effectFragment: currentNode });
    return;
  }
  // A scaled or bound value (a count on the board, the battle size, a bound roll) has no fixed size here:
  // applying the printed value would over- or under-state it.
  const unsized = unsizedValueReason(currentNode);
  if (unsized != null) {
    // A capped scaling ("+2 A per embarked model, to a maximum of +22") is a lever at its cap; the
    // player vouches for the count that reaches it.
    const atCap = scaledToCap(currentNode);
    if (atCap) {
      offerLever(atCap, source, opts, out, { id: `${opts.abilityId}#at-cap`, label: "At its maximum", requires: [currentNode.scaling] });
      return;
    }
    out.unsupported.push({ reason: unsized, effectFragment: currentNode });
    return;
  }
  // An ability another unit provides reaches the crunched unit only through a friendly filter, an
  // aura's recipient or a selection; its own unit and model are the provider, not the crunched unit.
  if (!opts.grantedHolder && isProvidedByAnotherUnit(source) && typeof currentNode.target === "string" && PROVIDER_TARGETS.has(currentNode.target)) return;
  if (isObject(currentNode.target)) {
    const side = currentNode.target.member_of === "attacker" ? "attacker" :
      currentNode.target.member_of === "defender" || currentNode.target.owner === "enemy" ? "target" :
        opts.perspective === "attacker" ? "attacker" : "target";
    const verdict = matchesUnitFilter(currentNode.target, opts.context, side, currentNode.target.owner === "enemy" ? "enemy" : "friendly");
    if (verdict === false) return;
    if (verdict === "unknown") {
      out.unsupported.push({ reason: "unit-filter target: identity, state or model membership is unresolved", effectFragment: currentNode });
      return;
    }
  }
  // An `incoming` change modifies attacks made against its target. On the buffed unit it is the
  // attacker's side of those attacks, which the `target: "attacker"` form already models; it never
  // modifies the buffed unit's own attacks.
  // On the defender it changes every friendly attack against that unit, the buffed unit's among
  // them, so the attacker perspective reads it as a change for friendly units; the target
  // perspective has no such attack.
  if (isObject(currentNode.modifier) && currentNode.modifier.incoming === true && classifyTarget(currentNode) === "defender") {
    if (opts.perspective !== "attacker") return;
    const { incoming: _incoming, ...modifier } = currentNode.modifier;
    walk({ ...currentNode, target: { owner: "friendly" }, modifier }, source, opts, out);
    return;
  }
  const incoming = isObject(currentNode.modifier) && currentNode.modifier.incoming === true && classifyTarget(currentNode) === "self";
  if (incoming) {
    if (opts.perspective === "attacker") return;
    if (currentNode.type === "roll-modifier" || currentNode.type === "stat-modifier") {
      const { incoming: _incoming, ...modifier } = currentNode.modifier as Record<string, unknown>;
      walk({ ...currentNode, target: ATTACKER_TARGET, modifier }, source, opts, out);
    } else {
      out.unsupported.push({ reason: `${String(currentNode.type)}: an incoming change to attacks against the unit is not modelled`, effectFragment: currentNode });
    }
    return;
  }
  const type = currentNode.type;
  switch (type) {
    case "re-roll":
      translateReroll(currentNode, source, opts, out);
      return;
    case "roll-modifier":
      translateRollModifier(currentNode, source, opts, out);
      return;
    case "stat-modifier":
      translateStatModifier(currentNode, source, opts, out);
      return;
    case "feel-no-pain":
      translateFeelNoPain(currentNode, source, opts, out);
      return;
    case "weapon-ability-grant":
      translateKeywordGrant(currentNode, source, opts, out);
      return;
    case "damage-reduction":
      translateDamageReduction(currentNode, source, opts, out);
      return;
    case "invulnerable-save":
      translateInvulnerableSave(currentNode, source, opts, out);
      return;
    case "named-region-state":
      translateNamedRegionState(currentNode, source, opts, out);
      return;
    case "conditional":
      translateConditional(currentNode, source, opts, out);
      return;
    case "rules-bundle":
    case "sequence":
      for (const step of (currentNode.steps as unknown[]) ?? []) walk(step, source, opts, out);
      return;
    case "ability-part": {
      const partOpts = currentNode.duration === undefined ? opts : { ...opts, duration: currentNode.duration };
      // Orders are issued at their own moment and last for the part's duration: each Order is a
      // lever for the attacks made while it lasts, as a stance option is.
      if ((currentNode.effect as { type?: unknown } | undefined)?.type === "issue-orders") {
        walk(currentNode.effect, source, partOpts, out);
        return;
      }
      if (currentNode.trigger != null) {
        const bound = bindEventSubject(currentNode.trigger, currentNode.effect, opts.context, opts.perspective);
        if (bound !== currentNode.effect) {
          walk({ ...currentNode, effect: bound }, source, opts, out);
          return;
        }
      }
      if (currentNode.optional === true || currentNode.cost != null || currentNode.usage != null) {
        translateNamedEffect(currentNode, source, partOpts, out);
      } else {
        walk(momentGate(currentNode.trigger, currentNode.effect, currentNode), source, partOpts, out);
      }
      return;
    }
    case "choice":
      enumerateChoice(currentNode, source, opts, out);
      return;
    case "dice-gated":
      out.unsupported.push({
        reason: stochasticDiceGatedReason,
        effectFragment: currentNode,
      });
      return;
    case "dice-pool-allocation":
      enumerateDicePool(currentNode, source, opts, out);
      return;
    case "roll":
      // A pool roll whose dice are allocated to named options (Blessings of Khorne) is the same
      // lever set dice-pool-allocation produced; any other bound roll only scopes its nested effect.
      if (!enumerateRollAllocation(currentNode, source, opts, out)) walk(currentNode.effect, source, opts, out);
      return;
    case "select-objective":
      out.unsupported.push({ reason: "select-objective: the bound objective marker is not resolved by the buff engine", effectFragment: currentNode });
      return;
    case "characteristic-resolution":
      out.unsupported.push({ reason: "characteristic-resolution: which models' characteristic applies depends on the unit's model mix; not resolved by the buff engine", effectFragment: currentNode });
      return;
    case "borrow-weapons":
      out.unsupported.push({ reason: "borrow-weapons: the passengers' weapons are not added to the Transport's profile by the buff engine", effectFragment: currentNode });
      return;
    case "select-weapon":
      out.unsupported.push({ reason: "select-weapon: a bound weapon is not resolved by the buff engine", effectFragment: currentNode });
      return;
    case "select-units":
      walk(currentNode.effect, source, opts, out);
      return;
    case "aura": {
      const modifier = isObject(currentNode.modifier) ? currentNode.modifier : undefined;
      // An aura's own target names the side it reaches, not a unit-ref: friendly recipients are the
      // buffed side, enemy ones the other.
      const side = currentNode.target === "friendly-within-aura" ? "self" : currentNode.target === "enemy-within-aura" ? "defender" : "unknown";
      if (side === "unknown" || (side === "defender" && opts.perspective !== "target")) return;
      if (modifier?.recipient_filter !== undefined) {
        const matches = matchesUnitFilter(modifier.recipient_filter, opts.context, opts.perspective === "attacker" ? "attacker" : "target");
        if (matches === false) return;
        if (matches === "unknown") {
          out.unsupported.push({ reason: "aura recipient keywords are unavailable or its filter is malformed", effectFragment: currentNode });
          return;
        }
      }
      if (modifier?.emitter_filter !== undefined && matchesUnitFilter(modifier.emitter_filter, { phase: opts.context.phase }, "attacker") !== true) {
        out.unsupported.push({ reason: "aura emitter filter requires the source unit's keywords", effectFragment: currentNode });
        return;
      }
      if (modifier && isObject(modifier.effect)) {
        walk(modifier.effect, source, opts, out);
      } else {
        out.unsupported.push({
          reason: "aura without nested effect: not a combat buff",
          effectFragment: currentNode,
        });
      }
      return;
    }
    case "persistent-designation":
      out.unsupported.push({
        reason: "persistent-designation: retained selection state is not resolved by the buff engine",
        effectFragment: currentNode,
      });
      return;
    case "designate-target": {
      const applies = isObject(currentNode.applies) ? currentNode.applies : {};
      if (applies.to === "attackers-of-target" || applies.to === "bearer-attacks-target") {
        for (const filter of [applies.attacker_filter, applies.attacker_unit_filter]) {
          if (filter === undefined) continue;
          const verdict = matchesUnitFilter(filter, opts.context, "attacker");
          if (verdict === false) return;
          if (verdict === "unknown") {
            out.unsupported.push({ reason: "designate-target attacker filter is unresolved", effectFragment: currentNode });
            return;
          }
        }
        // A designation restricted to units the target is not (e.g. an enemy VEHICLE) never marks it.
        const selector = isObject(currentNode.select) && currentNode.select.kind === "unit" && isObject(currentNode.select.selector)
          ? currentNode.select.selector
          : undefined;
        if (selector?.filter !== undefined && matchesUnitFilter(selector.filter, opts.context, "target", "enemy") === false) return;
        // Which enemy unit is designated is the player's pick, so its buffs are one opt-in lever
        // ("this defender is the designated unit"); the player vouches for the selection's
        // eligibility (range, visibility, "hit by those attacks").
        const sub: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
        walk(applies.effect, source, opts, sub);
        out.unsupported.push(...sub.unsupported);
        const requirement = { select: currentNode.select, duration: currentNode.duration };
        out.activatable.push(...sub.activatable.map((lever) => ({ ...lever, requires: [requirement, ...(lever.requires ?? [])] })));
        if (sub.applied.length > 0) {
          const designation = typeof currentNode.designation === "string" ? currentNode.designation : "designated";
          out.activatable.push({ id: `${opts.abilityId}#${designation}`, label: `Designated target: ${labelForBuffs(sub.applied)}`, buffs: sub.applied, requires: [requirement] });
        }
      } else {
        out.unsupported.push({
          reason: "designate-target debuff on the marked unit: not a buff on the bearer",
          effectFragment: currentNode,
        });
      }
      return;
    }
    case "risk-reward":
      walk(currentNode.reward, source, opts, out);
      return;
    case "stance-select":
      enumerateNamedOptions(currentNode, source, opts, out, `${opts.abilityId}?stance`, typeof currentNode.max_choices === "number" ? currentNode.max_choices : 1);
      return;
    case "issue-orders":
      enumerateNamedOptions(currentNode, source, opts, out, `${opts.abilityId}?order`, 1);
      return;
    case "resource-action-menu":
      enumerateMenuActions(currentNode, source, opts, out);
      return;
    case "roll-result":
      translateRollResult(currentNode, source, opts, out);
      return;
    case "ignore-modifiers":
      translateIgnoreModifiers(currentNode, source, opts, out);
      return;
    case "ability-grant":
      translateAbilityGrant(currentNode, source, opts, out);
      return;
    case "rule-state":
      out.unsupported.push({
        reason: isObject(currentNode.modifier) && (isObject(currentNode.modifier.rule) || currentNode.modifier.direction === "exchanged" || currentNode.modifier.except_from !== undefined)
          ? "rule-state: persistent ability ownership and suppression are not resolved by the buff engine"
          : 'effect type "rule-state" is not modelled by the buff layer',
        effectFragment: currentNode,
      });
      return;
    case "stance-selection-capacity":
      translateStanceCapacity(currentNode, source, opts, out);
      return;
    default:
      out.unsupported.push({
        reason: `effect type "${String(type)}" is not modelled by the buff layer`,
        effectFragment: currentNode,
      });
  }
}

/**
 * Offer a planned unit selection as one lever: the buffs its effect gives the crunched unit, gated
 * on the selected unit's keywords, with the selection (and any roll) in `requires`. Levers nested
 * in the effect keep their own choice and add the selection to what they require.
 */
function translateSelection(
  plan: ReturnType<typeof planSelection>,
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  if (plan.kind === "skip" || plan.kind === "none") return;
  if (plan.kind === "unsupported") {
    out.unsupported.push({ reason: plan.reason, effectFragment: node });
    return;
  }
  offerLever(plan.effect, source, opts, out, { id: `${opts.abilityId}#selected`, label: plan.label, requires: plan.requires, applicability: plan.applicability });
}

/**
 * Translate `effect` and offer what it gives the crunched unit as one opt-in lever that requires
 * `lever.requires`. Levers nested in the effect keep their own choice and add those requirements
 * to theirs; `applicability` gates every buff.
 */
function offerLever(
  effect: unknown,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
  lever: { id: string; label: string; requires: unknown[]; applicability?: BuffApplicability },
): void {
  const sub: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
  walk(effect, source, opts, sub);
  const gate = (buff: Buff): Buff => (lever.applicability ? applyApplicability(buff, lever.applicability) : buff);
  out.unsupported.push(...sub.unsupported);
  for (const nested of sub.activatable) {
    out.activatable.push({ ...nested, buffs: nested.buffs.map(gate), requires: [...lever.requires, ...(nested.requires ?? [])] });
  }
  if (sub.applied.length > 0) {
    const buffs = sub.applied.map(gate);
    out.activatable.push({ id: lever.id, label: `${lever.label}: ${labelForBuffs(buffs)}`, buffs, requires: lever.requires });
  }
}

// ---------------------------------------------------------------------------
// Leaf translators
// ---------------------------------------------------------------------------

/**
 * Classify a node's `target` field against the perspective we're translating
 * for. Returns:
 *  - `"self"`: the node targets the buffed unit (apply attacker-side or
 *    defender-side translation, depending on perspective + stat).
 *  - `"attacker"` / `"defender"`: the node targets the other party explicitly.
 *  - `"unknown"`: missing/malformed target.
 */
function classifyTarget(
  node: Record<string, unknown>,
): "self" | "attacker" | "defender" | "unknown" {
  const target = node.target;
  // A unit filter reaches every unit it matches: friendly ones are the buffed side, enemy ones the other.
  if (isObject(target) && !("event_var" in target) && !("selection_var" in target)) {
    if (target.member_of === "attacker" || target.member_of === "defender") return target.member_of;
    if (Array.isArray(target.unit_ids) && (target.owner === undefined || target.owner === "any")) return "self";
    if (target.owner === "friendly" || (target.owner === undefined && target.member_of === "this-unit")) return "self";
    if (target.owner === "enemy") return "defender";
    return "unknown";
  }
  if (typeof target !== "string") return "unknown";
  if (target === ATTACKER_TARGET) return "attacker";
  if (DEFENDER_TARGETS.has(target)) return "defender";
  if (SELF_TARGETS.has(target)) return "self";
  return "unknown";
}

/**
 * Does this node's target match the buffed unit under the current
 * perspective? Used for symmetric roll/keyword translations where the same
 * effect is "self" in either direction.
 */
function appliesToBuffedUnit(
  node: Record<string, unknown>,
  perspective: TranslationPerspective,
): boolean {
  const cls = classifyTarget(node);
  if (cls === "self") return true;
  if (cls === "attacker") return perspective === "attacker";
  if (cls === "defender") return perspective === "target";
  return false;
}

function translateReroll(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  // Rerolls are inherently attacker-side (you re-roll your own hit/wound/
  // damage; save rerolls fire when *you* are the target). Apply only under
  // the matching perspective so a target-perspective walk doesn't grab the
  // attacker's reroll-failed-hits buff.
  if (opts.perspective === "attacker" && !appliesToBuffedUnit(node, "attacker")) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({ reason: "re-roll: missing modifier object", effectFragment: node });
    return;
  }
  const narrowed = unhonorableNarrowing(modifier);
  if (narrowed) {
    out.unsupported.push({ reason: `re-roll: narrows by "${narrowed}" which the cruncher can't resolve here`, effectFragment: node });
    return;
  }
  const roll = modifier.roll;
  // A `value: 1` on a re-roll modifier unambiguously means "re-roll rolls of 1".
  // A historical migration (2026-weapon-keywords) mis-defaulted such nodes to
  // `subset: "all-failures"`; honor the value as the source of truth so any
  // stray data of that shape can't silently over-apply the reroll.
  //
  // `result_scope: "any-result"` (no `subset`) is the DSL's shape for an unrestricted, optional
  // re-roll ("you can re-roll the Wound roll", no "of 1"/"failed" qualifier) — see
  // compile-fragments.ts and named-region-family.ts. It resolves to the same buff contribution as
  // "all-failures": a rational player holding an *optional* reroll always exercises it on a fail
  // (strictly improves the outcome) and never on an already-passing roll (rerolling a pass can
  // only convert some of those passes to fails; there's no scenario where an expected-value-
  // maximizing player takes that trade for a plain "re-roll" grant with no crit-fishing framing).
  // So the two subsets are behaviorally identical to the pass/crit optimizer in engine.ts, and no
  // new probability modelling is needed — only recognizing the shape.
  const subset = modifier.value === 1 ? "ones" : modifier.subset === undefined && modifier.result_scope === "any-result" ? "all-failures" : modifier.subset;
  // Under target perspective, only "save" rerolls fire on the buffed unit.
  if (opts.perspective === "target" && roll !== "save") return;
  const damagePath = roll === "hit" || roll === "wound" || roll === "save" || roll === "damage";
  // "Re-roll one Hit roll": one die across the pool, which the engine prices (engine.ts oneRerollDice).
  // A larger finite permission is non-linear in a way the engine does not model; applying it as an
  // uncapped reroll would silently overstate the effect.
  if (modifier.count !== undefined && damagePath) {
    if (modifier.count === 1 && subset === "all-failures") {
      out.applied.push(withApplicability({ source, contribution: { type: "reroll-one", roll } }, combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier))));
      return;
    }
    out.unsupported.push({
      reason: "re-roll: a count-capped permission other than one die of any result is not modelled by the expected-value engine",
      effectFragment: node,
    });
    return;
  }
  if (damagePath && (subset === "ones" || subset === "all-failures")) {
    out.applied.push(withApplicability({ source, contribution: { type: "reroll", roll, subset } }, combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier))));
    return;
  }
  out.unsupported.push({
    reason: `re-roll on "${rollLabel(roll)}" (subset "${String(subset)}") is outside the damage path`,
    effectFragment: node,
  });
}

function translateRollModifier(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "roll-modifier: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const narrowed = unhonorableNarrowing(modifier);
  if (narrowed) {
    out.unsupported.push({ reason: `roll-modifier: narrows by "${narrowed}" which the cruncher can't resolve here`, effectFragment: node });
    return;
  }
  const value = signedValue(modifier);
  if (value === null) {
    out.unsupported.push({
      reason: `roll-modifier: operation "${String(modifier.operation)}" not supported`,
      effectFragment: node,
    });
    return;
  }
  const roll = modifier.roll;
  // A change to the attacker's roll belongs to the side it favours: one that helps the attacker is
  // the attacking side's own rule, one that hinders it defends the unit being attacked.
  const attackerChange = classifyTarget(node) === "attacker";
  // Each roll type is intrinsically on one side. Hit / wound / damage are
  // attacker-side; save is defender-side. The perspective decides whether the
  // buffed unit's `target` is the right party for that roll type.
  if (opts.perspective === "attacker") {
    if (attackerChange && value < 0) return;
    if (!appliesToBuffedUnit(node, "attacker")) return;
    if (roll === "save") return; // saves apply to the defender, not the attacker.
  } else {
    // Target perspective accepts two shapes:
    //  - `target: "self"/"unit"/...` + `roll: "save"` — the buffed unit's
    //    own save rolls (mirrors the attacker path's reroll/stat handling).
    //  - `target: "attacker"` + `roll: "hit"/"wound"` — a defender-side
    //    rule that penalises the *incoming* attacker's hit/wound rolls (e.g.
    //    "subtract 1 from hit rolls targeting this unit"). Functionally
    //    identical to a `bs-modifier {target:"attacker"}` but with the
    //    canonical `roll-modifier` shape; the data uses both forms.
    const cls = classifyTarget(node);
    if (cls === "attacker") {
      if (roll !== "hit" && roll !== "wound") return; // damage/save against the attacker make no sense here.
      if (attackerChange && value > 0) return;
    } else if (cls === "self") {
      if (roll !== "save") return;
    } else {
      return;
    }
  }
  const named = combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier));
  switch (roll) {
    case "hit":
      out.applied.push(withApplicability({ source, contribution: { type: "hit-mod", value } }, named));
      return;
    case "wound":
      out.applied.push(withApplicability({ source, contribution: { type: "wound-mod", value } }, named));
      return;
    case "save":
      out.applied.push(withApplicability({ source, contribution: { type: "save-mod", value } }, named));
      return;
    case "damage":
      out.applied.push(withApplicability({ source, contribution: { type: "damage-mod", value } }, named));
      return;
    default:
      out.unsupported.push({
        reason: `roll-modifier on "${rollLabel(roll)}" is outside the damage path`,
        effectFragment: node,
      });
  }
}

function translateStatModifier(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "stat-modifier: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const narrowed = unhonorableNarrowing(modifier);
  if (narrowed) {
    out.unsupported.push({ reason: `stat-modifier: narrows by "${narrowed}" which the cruncher can't resolve here`, effectFragment: node });
    return;
  }
  const stat = modifier.stat;
  const isOnBuffedUnit = appliesToBuffedUnit(node, opts.perspective);
  // Weapon type gates the attack phase; name and keyword predicates stay on each buff.
  const applicability = combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier));
  const emit = (contribution: BuffContribution): void => {
    out.applied.push(withApplicability({ source, contribution }, applicability));
  };

  // AP has an inverted sign convention (stored negative; more negative = more
  // piercing) and offensive/defensive variants, so it computes its own delta
  // and routes by attacker/defender rather than going through `signedValue`.
  if (stat === "AP") {
    translateApModifier(node, modifier, opts, out, emit);
    return;
  }

  // WS/BS on the attacker is a defender-side rule: it penalises incoming hit rolls of that attack
  // type (e.g. Benefit of Cover), so it is a `hit-mod` under target perspective. On the buffed unit
  // it changes the characteristic its own attacks hit on.
  if (stat === "BS" || stat === "WS") {
    const phases: Phase[] = [stat === "BS" ? "shooting" : "fight"];
    if (classifyTarget(node) === "attacker") {
      if (opts.perspective !== "target") return;
      const skill = signedValue(modifier);
      if (skill !== null) out.applied.push({ source, applicableWhen: { phases }, contribution: { type: "hit-mod", value: skill } });
      return;
    }
    if (opts.perspective !== "attacker" || !isOnBuffedUnit) return;
    const amount = typeof modifier.value === "number" ? modifier.value : NaN;
    const improvement = modifier.operation === "improve" ? amount : modifier.operation === "worsen" ? -amount : NaN;
    if (!Number.isFinite(improvement)) {
      out.unsupported.push({ reason: `stat-modifier ${stat}: operation "${String(modifier.operation)}" not supported`, effectFragment: node });
      return;
    }
    emit({ type: "skill-mod", stat, value: improvement });
    return;
  }

  // Setting the Save characteristic is defender-side. A set A, S or D on the buffed unit replaces
  // its weapons' characteristic before modifiers; other set stats are off the damage path.
  if (modifier.operation === "set") {
    if (stat === "Sv") {
      if (opts.perspective !== "target") {
        out.unsupported.push({ reason: "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target", effectFragment: node });
        return;
      }
      const saveValue = typeof modifier.value === "number" ? modifier.value : NaN;
      if (!isOnBuffedUnit) return;
      if (Number.isInteger(saveValue) && saveValue >= 2 && saveValue <= 6) emit({ type: "save-characteristic", value: saveValue });
      else if (Number.isNaN(saveValue)) out.unsupported.push({ reason: "stat-modifier Sv: set has no numeric value", effectFragment: node });
      else out.unsupported.push({ reason: `stat-modifier Sv: set value "${saveValue}" is not a save characteristic`, effectFragment: node });
      return;
    }
    if (stat !== "A" && stat !== "S" && stat !== "T" && stat !== "D") {
      out.unsupported.push({ reason: `stat-modifier on "${String(stat)}" is outside the damage path`, effectFragment: node });
      return;
    }
    if (stat === "T") {
      out.unsupported.push({ reason: "stat-modifier T: setting the Toughness characteristic is not modelled", effectFragment: node });
      return;
    }
    if (stat === "D" && classifyTarget(node) === "attacker") {
      if (opts.perspective === "target") out.unsupported.push({ reason: "stat-modifier D: setting the Damage of incoming attacks is not modelled", effectFragment: node });
      return;
    }
    if (opts.perspective !== "attacker" || !isOnBuffedUnit) return;
    const setValue = typeof modifier.value === "number" ? modifier.value : NaN;
    if (!Number.isInteger(setValue) || setValue < 0) {
      out.unsupported.push({ reason: `stat-modifier ${stat}: set value "${String(modifier.value)}" is not a characteristic`, effectFragment: node });
      return;
    }
    emit({ type: "stat-set", stat, value: setValue });
    return;
  }

  const value = signedValue(modifier);
  if (value === null) {
    out.unsupported.push({
      reason: `stat-modifier: operation "${String(modifier.operation)}" not supported`,
      effectFragment: node,
    });
    return;
  }
  switch (stat) {
    case "A":
      if (opts.perspective !== "attacker" || !isOnBuffedUnit) return;
      emit({ type: "attacks-mod", value });
      return;
    case "S":
      if (opts.perspective !== "attacker" || !isOnBuffedUnit) return;
      emit({ type: "strength-mod", value });
      return;
    case "T":
      // Defender stat. Only relevant under target perspective.
      if (opts.perspective !== "target") {
        out.unsupported.push({
          reason: "stat-modifier T: defender-side stat; applies when the buffed unit is the target",
          effectFragment: node,
        });
        return;
      }
      if (!isOnBuffedUnit) return;
      emit({ type: "toughness-mod", value });
      return;
    case "D":
      // The Damage of attacks against the buffed unit is defender-side: a reduction (Necrodermis)
      // under target perspective. On the buffed unit it changes the Damage of its own attacks.
      if (classifyTarget(node) === "attacker") {
        if (opts.perspective !== "target") return;
        if (value < 0) emit({ type: "damage-reduction", value: -value });
        else out.unsupported.push({ reason: "stat-modifier D: raising the Damage of incoming attacks is not modelled", effectFragment: node });
        return;
      }
      if (opts.perspective !== "attacker" || !isOnBuffedUnit) return;
      emit({ type: "damage-mod", value });
      return;
    case "Sv":
      // Improvement is a save-roll bonus. Literal addition to the Save characteristic
      // instead raises the needed roll, so add/subtract use the opposite sign.
      if (opts.perspective !== "target") {
        out.unsupported.push({
          reason: "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target",
          effectFragment: node,
        });
        return;
      }
      if (!isOnBuffedUnit) return;
      // A capped improvement ("cannot improve a Save to better than N+") changes the Save
      // characteristic itself, not the save roll.
      if (modifier.operation === "improve" && typeof modifier.minimum === "number") {
        emit({ type: "save-improve", value, best: modifier.minimum });
        return;
      }
      emit({ type: "save-mod", value: modifier.operation === "improve" || modifier.operation === "worsen" ? value : -value });
      return;
    default:
      out.unsupported.push({
        reason: `stat-modifier on "${String(stat)}" is outside the damage path`,
        effectFragment: node,
      });
  }
}

/**
 * Translate an `AP` stat-modifier. AP rides on the attacker's weapon profile and
 * is stored as a negative number (e.g. AP -1); more negative = more piercing.
 *
 * Two variants exist in the data:
 *  - **offensive** (`target` self/unit): the buffed unit's own weapons gain AP —
 *    an attacker-side `ap-mod`. `improve N` → `-N` (more piercing), `worsen N` →
 *    `+N`, and the legacy `add`/`subtract` forms (which already pass a signed,
 *    usually negative, value) flow through `apDelta` unchanged.
 *  - **defensive** (`target: "attacker"`): "enemy weapons targeting this unit
 *    have AP worsened". This applies when the buffed unit is the *target*; we do
 *    not model it as an attacker-side buff (that would wrongly weaken the buffed
 *    unit's own attacks), so it is surfaced as `unsupported`.
 */
function translateApModifier(
  node: Record<string, unknown>,
  modifier: Record<string, unknown>,
  opts: WalkOpts,
  out: EffectTranslation,
  emit: (contribution: BuffContribution) => void,
): void {
  if (classifyTarget(node) === "attacker") {
    // Worsening the AP of attacks against the buffed unit; the engine floors AP at 0.
    if (opts.perspective !== "target") {
      out.unsupported.push({ reason: "stat-modifier AP on the attacker: defender-side stat; applies when the buffed unit is the target", effectFragment: node });
      return;
    }
    if (modifier.operation === "set") {
      out.unsupported.push({ reason: "stat-modifier AP: setting the AP of incoming attacks is not modelled", effectFragment: node });
      return;
    }
    const incomingDelta = apDelta(modifier);
    if (incomingDelta === null) {
      out.unsupported.push({ reason: `stat-modifier AP: operation "${String(modifier.operation)}" not supported`, effectFragment: node });
      return;
    }
    emit({ type: "ap-mod", value: incomingDelta });
    return;
  }
  if (opts.perspective !== "attacker" || !appliesToBuffedUnit(node, "attacker")) return;
  if (modifier.operation === "set") {
    // The DSL carries the AP magnitude ("an AP of -2" is value 2); the profile stores it negative.
    const magnitude = typeof modifier.value === "number" ? modifier.value : NaN;
    if (!Number.isInteger(magnitude)) {
      out.unsupported.push({ reason: `stat-modifier AP: set value "${String(modifier.value)}" is not a characteristic`, effectFragment: node });
      return;
    }
    emit({ type: "stat-set", stat: "AP", value: -Math.abs(magnitude) });
    return;
  }
  const delta = apDelta(modifier);
  if (delta === null) {
    out.unsupported.push({
      reason: `stat-modifier AP: operation "${String(modifier.operation)}" not supported`,
      effectFragment: node,
    });
    return;
  }
  emit({ type: "ap-mod", value: delta });
}

function translateFeelNoPain(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  // FNP applies when the buffed unit is the *target* — it ablates incoming
  // damage. Under attacker perspective the FNP is irrelevant (the unit is
  // firing, not taking damage). Drop silently rather than as `unsupported`
  // so attacker-perspective walks don't surface a spurious diagnostic for
  // every unit that happens to have a FNP rule.
  if (opts.perspective !== "target") return;
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "feel-no-pain: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const threshold = Number(modifier.threshold);
  if (!Number.isFinite(threshold)) {
    out.unsupported.push({
      reason: "feel-no-pain: threshold not numeric",
      effectFragment: node,
    });
    return;
  }
  // `modifier.against` ∈ {"all", "mortal", "psychic", "psychic-and-mortal"}
  // (default "all"). Anything else routes to unsupported so a malformed value
  // can't silently masquerade as an all-FNP. `psychic-and-mortal` folds into
  // the mortal stream (its mortal-wound coverage is exact; the psychic-attack
  // half is invisible to the buff layer); bare `psychic` has no stream to
  // attach to, so it stays unsupported rather than overstating defence.
  const rawAgainst = modifier.against;
  let scope: "all" | "mortal" = "all";
  if (rawAgainst !== undefined) {
    if (rawAgainst === "all" || rawAgainst === "mortal") {
      scope = rawAgainst;
    } else if (rawAgainst === "psychic-and-mortal") {
      scope = "mortal";
    } else if (rawAgainst === "psychic") {
      out.unsupported.push({
        reason: 'feel-no-pain: against "psychic" (psychic attacks are not tracked by the buff layer)',
        effectFragment: node,
      });
      return;
    } else {
      out.unsupported.push({
        reason: `feel-no-pain: unrecognised against "${String(rawAgainst)}" (expected "all" or "mortal")`,
        effectFragment: node,
      });
      return;
    }
  }
  const contribution =
    scope === "mortal"
      ? ({ type: "feel-no-pain", threshold, scope: "mortal" } as const)
      : ({ type: "feel-no-pain", threshold } as const);
  out.applied.push({ source, contribution });
}

function translateKeywordGrant(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  // Weapon-keyword grants ride with the attacker's profile (e.g. "your
  // weapons gain [Sustained Hits 1]"). Defender-perspective walks ignore
  // them — the keyword applies when the buffed unit fires, not when it's
  // shot at.
  if (opts.perspective !== "attacker") return;
  if (!appliesToBuffedUnit(node, "attacker")) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) return;
  if (Array.isArray(modifier.removes)) {
    for (const ref of modifier.removes) {
      const label = isObject(ref) && typeof ref.keyword_id === "string"
        ? keywordLabel({ keyword_id: ref.keyword_id, ...(isObject(ref.parameters) ? { parameters: ref.parameters } : {}) })
        : "unresolved keyword";
      out.unsupported.push({
        reason: `weapon-ability-removal: the cruncher does not model removing a weapon ability ("${label}")`,
        effectFragment: { removes: [ref] },
      });
    }
  }
  if (modifier.if_present !== undefined) {
    out.unsupported.push({ reason: "weapon-ability-grant: incrementing an existing keyword rating is not modelled", effectFragment: node });
    return;
  }
  const narrowed = unhonorableNarrowing(modifier);
  if (narrowed) {
    out.unsupported.push({ reason: `weapon-ability-grant: unresolved ${narrowed}`, effectFragment: node });
    return;
  }
  const applicability = combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier));
  for (const ref of Array.isArray(modifier.keywords) ? modifier.keywords : []) {
    if (!isObject(ref) || typeof ref.keyword_id !== "string" || ref.keyword_id.length === 0 ||
      (ref.parameters !== undefined && !isObject(ref.parameters))) {
      out.unsupported.push({ reason: "weapon-ability-grant: invalid structured keyword reference", effectFragment: ref });
      continue;
    }
    if (isObject(ref.parameters) && ref.parameters.value !== undefined &&
        typeof ref.parameters.value !== "number" && typeof ref.parameters.value !== "string") {
      out.unsupported.push({ reason: "weapon-ability-grant: keyword rating quantity is unresolved", effectFragment: ref });
      continue;
    }
    const keywordRef: WeaponKeywordRef = { keyword_id: ref.keyword_id, ...(isObject(ref.parameters) ? { parameters: ref.parameters } : {}) };
    out.applied.push(withApplicability({ source, contribution: { type: "extra-keyword", keywordRef } }, applicability));
  }
}

/** Weapon type gates the phase; other scope predicates remain on the weapon. */
function attackTypeApplicability(modifier: Record<string, unknown>): BuffApplicability | undefined {
  const kind = isObject(modifier.weapons) ? modifier.weapons.type : undefined;
  if (kind === "melee") return { phases: ["fight"] };
  if (kind === "ranged") return { phases: ["shooting"] };
  return undefined;
}

function unhonorableNarrowing(modifier: Record<string, unknown>): string | undefined {
  if (modifier.weapons === undefined) return undefined;
  if (!isObject(modifier.weapons)) return "weapons";
  const scope = modifier.weapons;
  if (scope.ref !== undefined) return "weapons.ref";
  for (const field of ["keyword", "exclude_keyword"]) {
    const selection = scope[field];
    if (selection === undefined) continue;
    const refs = Array.isArray(selection) ? selection : [selection];
    if (refs.length === 0 || refs.some((ref) => !isObject(ref) || typeof ref.keyword_id !== "string" ||
      ref.keyword_id.length === 0 || (ref.parameters !== undefined && !isObject(ref.parameters)))) return `weapons.${field}`;
  }
  return undefined;
}

function weaponApplicability(modifier: Record<string, unknown>): BuffApplicability | undefined {
  if (!isObject(modifier.weapons)) return undefined;
  const scope = modifier.weapons;
  const out: BuffApplicability = {};
  if (typeof scope.name === "string") out.weaponName = scope.name.toLowerCase();
  if (typeof scope.exclude_name === "string") out.excludedWeaponName = scope.exclude_name.toLowerCase();
  const refs = (value: unknown): WeaponKeywordRef[] | undefined => {
    if (value === undefined) return undefined;
    return (Array.isArray(value) ? value : [value]).filter((ref): ref is WeaponKeywordRef =>
      isObject(ref) && typeof ref.keyword_id === "string" && (ref.parameters === undefined || isObject(ref.parameters)));
  };
  if (scope.keyword !== undefined) out.weaponKeywords = refs(scope.keyword);
  if (scope.exclude_keyword !== undefined) out.excludedWeaponKeywords = refs(scope.exclude_keyword);
  return Object.keys(out).length > 0 ? out : undefined;
}

function combineOptional(a: BuffApplicability | undefined, b: BuffApplicability | undefined): BuffApplicability | undefined {
  return a && b ? combineApplicability(a, b) : (a ?? b);
}

function withApplicability(buff: Buff, applicability: BuffApplicability | undefined): Buff {
  return applicability ? { ...buff, applicableWhen: applicability } : buff;
}

/**
 * A changed roll result. Only a critical threshold on the buffed unit's own hit or wound roll is in
 * the damage math; a fixed result for any other roll (advance, battle-shock, ...) is outside it.
 */
function translateRollResult(node: Record<string, unknown>, source: BuffSource, opts: WalkOpts, out: EffectTranslation): void {
  const modifier = isObject(node.modifier) ? node.modifier : {};
  const roll = modifier.roll;
  if (roll !== "hit" && roll !== "wound" && roll !== "save" && roll !== "damage") {
    out.unsupported.push({ reason: `roll-result on "${rollLabel(roll)}" is outside the damage path`, effectFragment: node });
    return;
  }
  const narrowed = unhonorableNarrowing(modifier);
  if (narrowed) {
    out.unsupported.push({ reason: `roll-result: narrows by "${narrowed}" which the cruncher can't resolve here`, effectFragment: node });
    return;
  }
  const critical = Number(modifier.critical_on);
  const onlyCritical = Object.keys(modifier).every((key) => ["roll", "critical_on", "weapons"].includes(key));
  if ((roll !== "hit" && roll !== "wound") || !onlyCritical || !Number.isInteger(critical) || critical < 2 || critical > 6) {
    out.unsupported.push({ reason: `roll-result on "${roll}": only a critical threshold on hit or wound rolls is modelled`, effectFragment: node });
    return;
  }
  if (opts.perspective !== "attacker" || !appliesToBuffedUnit(node, "attacker")) return;
  const applicability = combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier));
  out.applied.push(withApplicability({ source, contribution: { type: "crit-threshold", roll, value: critical } }, applicability));
}

/**
 * Ignoring modifiers to the buffed unit's own hit or wound rolls. Ignoring WS/BS modifiers is the
 * same lever here: the buff layer changes WS/BS for incoming attacks only through hit modifiers.
 */
function translateIgnoreModifiers(node: Record<string, unknown>, source: BuffSource, opts: WalkOpts, out: EffectTranslation): void {
  const modifier = isObject(node.modifier) ? node.modifier : {};
  const listed = modifier.what === "rolls" ? modifier.rolls : modifier.what === "characteristics" ? modifier.stats : undefined;
  const rolls = Array.isArray(listed) ? listed.map((item) => (item === "WS" || item === "BS" ? "hit" : item)) : [];
  if (rolls.length === 0 || rolls.some((roll) => roll !== "hit" && roll !== "wound")) {
    out.unsupported.push({ reason: "ignore-modifiers: only hit and wound rolls and WS/BS are modelled", effectFragment: node });
    return;
  }
  if (opts.perspective !== "attacker" || !appliesToBuffedUnit(node, "attacker")) return;
  for (const roll of new Set(rolls as ("hit" | "wound")[])) out.applied.push({ source, contribution: { type: "ignore-modifiers", roll } });
}

/**
 * A printed grant (`definition`) translates its body for the holders. Otherwise, the core abilities
 * the buff layer models on the unit being attacked: Stealth and the benefit of
 * cover (Stealth gives the benefit of cover) and Feel No Pain. Like the other defender-side leaves,
 * they contribute nothing to the buffed unit's own attacks.
 */
function translateAbilityGrant(node: Record<string, unknown>, source: BuffSource, opts: WalkOpts, out: EffectTranslation): void {
  const modifier = isObject(node.modifier) ? node.modifier : {};
  if (isObject(modifier.ability)) {
    out.unsupported.push({ reason: "ability-grant: named ability ownership is not resolved by the buff engine", effectFragment: node });
    return;
  }
  // A printed grant carries the granted ability's body: it is the holders' own ability, so it
  // reaches the buffed unit exactly when the grant does, and its "this unit" is the holder.
  if (isObject(modifier.definition)) {
    const holders = classifyTarget(node);
    if (holders === "self") {
      if (node.target === "this-model" || node.target === "model-in-this-unit" || (isObject(node.target) && node.target.level === "model")) {
        out.unsupported.push({ reason: "ability-grant: model-only definition cannot be applied to the entire unit", effectFragment: node });
      } else walk(modifier.definition, source, { ...opts, grantedHolder: true }, out);
    }
    else if (holders === "unknown") out.unsupported.push({ reason: "ability-grant: the units holding the granted ability are not resolved", effectFragment: node });
    return;
  }
  const ability = modifier.ability;
  const fnp = Number(modifier.value);
  const contribution: BuffContribution | null =
    ability === "stealth" || ability === "benefit-of-cover" ? { type: "cover" }
    : ability === "feel-no-pain" && Number.isInteger(fnp) && fnp >= 2 && fnp <= 6 ? { type: "feel-no-pain", threshold: fnp }
    : null;
  if (contribution === null) {
    out.unsupported.push({ reason: `effect type "ability-grant" is not modelled by the buff layer`, effectFragment: node });
    return;
  }
  if (opts.perspective !== "target" || classifyTarget(node) !== "self") return;
  out.applied.push({ source, contribution });
}

/**
 * Defender-side damage-reduction (`{type: "damage-reduction", modifier:
 * {reduction: N | "half" | "to-zero"}}`). The buff layer only models the
 * additive numeric form — `"half"` and `"to-zero"` are one-use ablation
 * effects that don't fold into a deterministic expected-value crunch, so
 * they surface as `unsupported`. Attacker-perspective walks drop silently
 * (this is a defender stat).
 */
/** Capacity references are immutable ability/option IDs, never display names. */
function translateStanceCapacity(node: Record<string, unknown>, _source: BuffSource, opts: WalkOpts, out: EffectTranslation): void {
  const modifier = isObject(node.modifier) ? node.modifier : undefined;
  const by = modifier?.additional_selections;
  const isRef = (value: unknown): value is { ability_id: string; option_id: string } =>
    isObject(value) && typeof value.ability_id === "string" && typeof value.option_id === "string";
  if (!modifier || typeof modifier.ability_id !== "string" || typeof by !== "number" ||
    (modifier.allocation !== "fixed-option" && modifier.allocation !== "choose-one-option") ||
    (modifier.allocation === "fixed-option" && !isRef(modifier.option)) ||
    (modifier.options !== undefined && (!Array.isArray(modifier.options) || !modifier.options.every(isRef)))) {
    out.unsupported.push({ reason: "stance-selection-capacity: unresolved option reference", effectFragment: node });
    return;
  }
  const capRaise: NonNullable<ActivatableBuff["capRaise"]> = {
    ability: modifier.ability_id, by, allocation: modifier.allocation,
    ...(isRef(modifier.option) ? { option: modifier.option } : {}),
    ...(Array.isArray(modifier.options) && modifier.options.every(isRef) ? { options: modifier.options } : {}),
  };
  out.activatable.push({ id: `${opts.abilityId}#cap`, label: `${by} more ${modifier.ability_id} selections`, buffs: [], capRaise });
}

function translateDamageReduction(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  if (opts.perspective !== "target") return;
  if (!appliesToBuffedUnit(node, "target")) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "damage-reduction: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const reduction = modifier.reduction;
  if (typeof reduction === "number" && Number.isFinite(reduction) && reduction > 0) {
    out.applied.push({ source, contribution: { type: "damage-reduction", value: reduction } });
    return;
  }
  if (reduction === "half" || reduction === "to-zero") {
    out.unsupported.push({
      reason: `damage-reduction: "${reduction}" is a one-use ablation effect, not modelled by the expected-value engine`,
      effectFragment: node,
    });
    return;
  }
  out.unsupported.push({
    reason: `damage-reduction: unrecognised reduction "${String(reduction)}"`,
    effectFragment: node,
  });
}

/**
 * Defender-side ability-granted invulnerable save (`{type: "invulnerable-save",
 * modifier: {invuln_sv: N}}`). Best (lowest threshold) wins, combined with the
 * unit's printed invuln by the engine. Attacker-perspective walks drop
 * silently (this is a defender stat).
 */
function translateInvulnerableSave(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  if (opts.perspective !== "target") return;
  if (!appliesToBuffedUnit(node, "target")) return;
  const modifier = node.modifier;
  if (!isObject(modifier)) {
    out.unsupported.push({
      reason: "invulnerable-save: missing modifier object",
      effectFragment: node,
    });
    return;
  }
  const threshold = Number(modifier.invuln_sv);
  if (!Number.isFinite(threshold) || threshold < 2 || threshold > 7) {
    out.unsupported.push({
      reason: `invulnerable-save: invuln_sv "${String(modifier.invuln_sv)}" is not a valid save threshold (2–7)`,
      effectFragment: node,
    });
    return;
  }
  out.applied.push({ source, contribution: { type: "invulnerable-save", threshold } });
}

function translateNamedRegionState(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  if (opts.perspective !== "attacker") return;
  const modifier = isObject(node.modifier) ? node.modifier : {};
  const consumer = isObject(modifier.consumer) ? modifier.consumer : {};
  const eligible = matchesUnitFilter(consumer.beneficiary_filter, opts.context, "attacker");
  if (eligible === "unknown") {
    out.unsupported.push({ reason: "named-region-state beneficiary filter cannot be evaluated against current attacker facts", effectFragment: node });
    return;
  }
  if (!eligible) return;
  const defaultBranch = isObject(consumer.default_branch) ? consumer.default_branch : undefined;
  if (!defaultBranch) {
    out.unsupported.push({
      reason: "named-region-state default branch is missing",
      effectFragment: node,
    });
    return;
  }
  walk(consumer.attack_condition === undefined ? defaultBranch.effect : { type: "conditional", condition: consumer.attack_condition, effect: defaultBranch.effect }, source, opts, out);
  const qualifiedBranch = isObject(consumer.qualified_branch) ? consumer.qualified_branch : undefined;
  if (qualifiedBranch) {
    out.unsupported.push({
      reason:
        "named-region-state qualified branch: region membership is unavailable in EngineContext; qualified replacement is unsupported",
      effectFragment: qualifiedBranch,
    });
  }
}

/** An `attack-is` naming weapons, or its negation: the resolver gates these per weapon. */
function isWeaponScopedCondition(condition: Record<string, unknown>): boolean {
  if (condition.operator === "not" && Array.isArray(condition.operands) && condition.operands.length === 1) {
    const operand = condition.operands[0];
    return isObject(operand) && isWeaponScopedCondition(operand) && operand.operator === undefined;
  }
  if (condition.type === "attack-compare") return true;
  return condition.type === "attack-is" && isObject(condition.parameters) && condition.parameters.weapons !== undefined;
}

/**
 * An `and` whose operands mix attack-scoped predicates (a weapon, the attack's Strength against
 * the target's Toughness) with predicates on the units: the attack-scoped operands as one buff
 * gate, and the rest to evaluate. Nested `and`s flatten. Undefined when no operand is
 * attack-scoped, when every operand is, or when an attack-scoped operand has no gate.
 */
function splitAttackScoped(
  condition: Record<string, unknown>,
  perspective: TranslationPerspective,
  ownToughness?: number,
): { applicability: BuffApplicability; rest: Record<string, unknown> } | undefined {
  if (condition.operator !== "and" || !Array.isArray(condition.operands)) return undefined;
  const operands: unknown[] = [];
  const flatten = (list: unknown[]): void => {
    for (const operand of list) {
      if (isObject(operand) && operand.operator === "and" && Array.isArray(operand.operands)) flatten(operand.operands);
      else operands.push(operand);
    }
  };
  flatten(condition.operands);
  let applicability: BuffApplicability = {};
  const rest: unknown[] = [];
  for (const operand of operands) {
    if (!isObject(operand) || !isWeaponScopedCondition(operand)) {
      rest.push(operand);
      continue;
    }
    const gate = conditionToApplicability(operand, perspective, ownToughness);
    if (typeof gate === "string") return undefined;
    applicability = combineApplicability(applicability, gate);
  }
  if (rest.length === 0 || rest.length === operands.length) return undefined;
  return { applicability, rest: rest.length === 1 && isObject(rest[0]) ? rest[0] : { operator: "and", operands: rest } };
}

function translateConditional(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const condition = node.condition;
  const effect = node.effect;
  if (!isObject(condition)) return;
  if (isWeaponScopedCondition(condition)) {
    const applicability = conditionToApplicability(condition, opts.perspective, opts.context.attackerToughness);
    if (typeof applicability !== "string") {
      const sub: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
      walk(effect, source, opts, sub);
      out.applied.push(...sub.applied.map((buff) => applyApplicability(buff, applicability)));
      out.activatable.push(...sub.activatable.map((lever) => ({ ...lever, buffs: lever.buffs.map((buff) => applyApplicability(buff, applicability)) })));
      out.unsupported.push(...sub.unsupported);
      return;
    }
  }
  const activation = activationSources.get(node);
  if (activation && isPostOwnAttackMoment(activation.trigger)) {
    out.unsupported.push({ reason: POST_ATTACK_MOMENT, effectFragment: activation.fragment });
    return;
  }
  const stance = opts.context.activeRules === undefined ? splitStanceOption(condition) : undefined;
  if (stance) {
    offerStanceGated(node, stance, source, opts, out);
    return;
  }
  const split = activation ? undefined : splitAttackScoped(condition, opts.perspective, opts.context.attackerToughness);
  const restVerdict = split ? evaluateCondition(split.rest, opts.context, opts.perspective, opts.grantedHolder ? undefined : source) : "unknown";
  if (split && restVerdict !== "unknown") {
    if (!restVerdict) return;
    const sub: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
    walk(effect, source, opts, sub);
    out.applied.push(...sub.applied.map((buff) => applyApplicability(buff, split.applicability)));
    out.activatable.push(...sub.activatable.map((lever) => ({ ...lever, buffs: lever.buffs.map((buff) => applyApplicability(buff, split.applicability)) })));
    out.unsupported.push(...sub.unsupported);
    return;
  }
  const evaluated = activation && opts.duration !== undefined
    ? momentCondition(activation.trigger, opts.duration) ?? condition
    : condition;
  const verdict = evaluateCondition(evaluated, opts.context, opts.perspective, opts.grantedHolder ? undefined : source);
  if (verdict === "unknown") {
    // A timing the player controls (e.g. "start of phase") isn't a wall — it's
    // an activation the player can opt into. Surface it as a lever rather than
    // dropping it. Other unevaluatable conditions stay unsupported.
    if (conditionMentionsTiming(condition)) {
      enumerateTimingGate(node, source, opts, out);
    } else {
      out.unsupported.push({
        reason: `conditional: cannot evaluate condition "${String(condition.type ?? condition.operator)}" against current context`,
        effectFragment: activationSources.get(node)?.fragment ?? node,
      });
    }
    return;
  }
  if (!verdict) return;
  walk(effect, source, opts, out);
}

/**
 * A condition that is, or is an `and` with exactly one top-level operand that is, `rule-active` on a
 * stance option or its single-operand `not`; `rest` holds the other operands.
 */
function splitStanceOption(condition: Record<string, unknown>): (StanceGate & { rest?: Record<string, unknown> }) | undefined {
  const optionOf = (operand: unknown): StanceOptionRef | undefined => {
    if (!isObject(operand) || operand.type !== "rule-active" || !isObject(operand.parameters)) return undefined;
    const rule = operand.parameters.rule;
    return isObject(rule) && typeof rule.ability_id === "string" && typeof rule.option_id === "string"
      ? { ability_id: rule.ability_id, option_id: rule.option_id }
      : undefined;
  };
  const gateOf = (operand: unknown): StanceGate | undefined => {
    const option = optionOf(operand);
    if (option) return { option, negated: false };
    if (!isObject(operand) || operand.operator !== "not" || !Array.isArray(operand.operands) || operand.operands.length !== 1) return undefined;
    const negated = optionOf(operand.operands[0]);
    return negated ? { option: negated, negated: true } : undefined;
  };
  const gate = gateOf(condition);
  if (gate) return gate;
  if (condition.operator !== "and" || !Array.isArray(condition.operands)) return undefined;
  const matches = condition.operands.filter((operand) => gateOf(operand) !== undefined);
  if (matches.length !== 1) return undefined;
  const rest = condition.operands.filter((operand) => operand !== matches[0]);
  return { ...gateOf(matches[0])!, rest: rest.length === 1 && isObject(rest[0]) ? rest[0] : { operator: "and", operands: rest } };
}

/**
 * A rule gated on a stance option the context does not declare follows the player's stance pick:
 * what the effect (under any remaining condition) gives becomes a lever requiring that option, or,
 * for a negated gate, excluding it. Buffs under the same gate within one ability share one lever.
 */
function offerStanceGated(
  node: Record<string, unknown>,
  stance: StanceGate & { rest?: Record<string, unknown> },
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const sub: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
  if (stance.rest) {
    const gated = { ...node, condition: stance.rest };
    const activation = activationSources.get(node);
    if (activation) activationSources.set(gated, activation);
    walk(gated, source, opts, sub);
  } else {
    walk(node.effect, source, opts, sub);
  }
  out.unsupported.push(...sub.unsupported);
  const fields = stanceGateFields(stance);
  out.activatable.push(...sub.activatable.map((lever) => ({ ...lever, ...fields })));
  if (sub.applied.length === 0) return;
  const name = stance.negated ? `not-${stance.option.option_id}` : stance.option.option_id;
  const id = `${opts.abilityId}#${name}`;
  const existing = out.activatable.find((lever) => lever.id === id);
  if (existing) {
    existing.buffs.push(...sub.applied);
    existing.label = `${name}: ${labelForBuffs(existing.buffs)}`;
    return;
  }
  out.activatable.push({ id, label: `${name}: ${labelForBuffs(sub.applied)}`, buffs: sub.applied, ...fields });
}

/** A named rule is transparent unless using it requires an activation. */
function translateNamedEffect(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const snapshotReason = recipientSnapshotReason(node.trigger, node.effect);
  if (snapshotReason) {
    out.unsupported.push({ reason: snapshotReason, effectFragment: node });
    return;
  }
  if (node.optional !== true && node.cost == null && node.trigger == null && node.usage == null) {
    walk(node.effect, source, opts, out);
    return;
  }
  const condition = momentCondition(node.trigger, opts.duration);
  let body = momentGate(node.trigger, node.effect, node);
  if (condition !== null) {
    const verdict = evaluateCondition(condition, opts.context, opts.perspective, opts.grantedHolder ? undefined : source);
    if (conditionMentionsTiming(condition) && verdict !== false) body = node.effect;
  }
  const sub: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
  walk(body, source, opts, sub);
  out.unsupported.push(...sub.unsupported);
  const { effect: _effect, ...requirement } = node;
  out.activatable.push(...sub.activatable.map((lever) => ({ ...lever, requires: [requirement, ...(lever.requires ?? [])] })));
  if (sub.applied.length > 0) {
    const name = typeof node.name === "string" ? node.name : labelForBuffs(sub.applied);
    out.activatable.push({ id: `${opts.abilityId}#${name}`, label: name, buffs: sub.applied, requires: [requirement] });
  }
}

// ---------------------------------------------------------------------------
// Activatable-lever enumeration
//
// Player-controlled gates — a `timing-is` the context can't pin down, each
// `dice-pool-allocation` option, each `choice` branch — aren't walls for a
// damage optimizer; they're the search space. Instead of dropping them to
// `unsupported`, we descend through them and surface every buff-bearing branch
// as an opt-in {@link ActivatableBuff}. The descent reuses the normal leaf
// translators (so a lever applies exactly what it advertises) and turns the
// conditions a branch still carries (target keyword, phase) into declarative
// `applicableWhen` so the resolver gates them per-target.
// ---------------------------------------------------------------------------

/** Rolls inside every attack: a trigger on one applies to each attack it modifies. */
const ATTACK_STEP_ROLLS: ReadonlySet<string> = new Set(["hit", "wound", "save", "damage"]);

/** A trigger on a step of every attack (a hit, wound, save or damage roll, or allocating damage). */
export function isAttackStep(trigger: unknown): boolean {
  if (!isObject(trigger)) return false;
  if (trigger.event === "damage-allocated") return true;
  const roll = isObject(trigger.filter) ? trigger.filter.roll : undefined;
  return (trigger.event === "before-roll" || trigger.event === "after-roll") && typeof roll === "string" && ATTACK_STEP_ROLLS.has(roll);
}

/** Reported for a moment after the triggering unit's own attacks: it acts only on later attacks. */
export const POST_ATTACK_MOMENT = "post-attack moment: applies only to attacks made after the triggering unit's";

/**
 * Whether every alternative trigger fires just after the ability's own side resolved its attacks
 * (`attacks-resolved` with no subject, `this-unit`, `this-model` or a friendly filter). The attacks
 * that fire it are already resolved, so nothing it grants changes them.
 */
export function isPostOwnAttackMoment(trigger: unknown): boolean {
  const triggers = (Array.isArray(trigger) ? trigger : [trigger]).filter(isObject);
  return triggers.length > 0 && triggers.every((item) => {
    if (item.event !== "attacks-resolved") return false;
    const subject = item.subject;
    return subject == null || subject === "this-unit" || subject === "this-model" || (isObject(subject) && subject.owner === "friendly");
  });
}

/** The lever key of a trigger: its event family and the filter value that tells moments apart. */
export function momentKey(trigger: Record<string, unknown>): string {
  const f = isObject(trigger.filter) ? trigger.filter : {};
  const detail = [f.to, f.kind, f.roll, Array.isArray(f.move_types) ? f.move_types.join("+") : undefined, f.from]
    .find((v): v is string => typeof v === "string" && v.length > 0);
  return detail ? `${String(trigger.event)}:${detail}` : String(trigger.event);
}

/** The unit's own move the engine context records: a Charge move is "charged this turn". */
function ownMoveFact(trigger: Record<string, unknown>): Record<string, unknown> | undefined {
  if (trigger.event !== "move-ended" || (trigger.subject != null && trigger.subject !== "this-unit")) return undefined;
  const types = isObject(trigger.filter) && Array.isArray(trigger.filter.move_types) ? trigger.filter.move_types : [];
  if (types.length !== 1 || (types[0] !== "charge" && types[0] !== "advance")) return undefined;
  return { type: "happened", parameters: { event: "move-ended", filter: { move_types: types }, window: "turn" } };
}

/** Trigger-time recipient sets cannot be reconstructed from current board facts. */
export function recipientSnapshotReason(trigger: unknown, effect: unknown): string | undefined {
  const check = (value: unknown, activeTrigger: unknown): boolean => {
    if (Array.isArray(value)) return value.some((child) => check(child, activeTrigger));
    if (!isObject(value)) return false;
    const inherited = value.type === "ability-part" && value.trigger !== undefined ? value.trigger : activeTrigger;
    const triggers = (Array.isArray(inherited) ? inherited : [inherited]).filter(isObject);
    if (value.type === "for-each-unit" && triggers.some((item) => typeof item.event === "string" && !isAttackStep(item))) return true;
    return Object.entries(value).some(([key, child]) => key !== "trigger" && check(child, inherited));
  };
  return check(effect, trigger) ? RECIPIENT_SNAPSHOT_UNAVAILABLE : undefined;
}
// Runtime timing gates are not DSL nodes. Diagnostics retain their canonical source.
const activationSources = new WeakMap<object, { trigger: unknown; fragment: unknown }>();

const ACTIVATION_CLOCK = { type: "timing-is", parameters: { timing: "activation" } };

/** A lasting activation's clock is historical; its other eligibility still applies. */
function activationCondition(condition: Record<string, unknown>, duration: unknown): Record<string, unknown> {
  const expiry = typeof duration === "string" ? duration : "";
  const spansPhases = expiry === "turn" || expiry === "battle-round" || expiry === "battle" ||
    expiry === "permanent" || expiry === "while-leading" || expiry === "one-use" ||
    expiry === "control-lost" || expiry.startsWith("until-");
  const clock = condition.type;
  if (spansPhases && (clock === "phase-is" ||
    (clock === "player-turn-is" && expiry !== "turn") ||
    (clock === "battle-round" && expiry !== "turn" && expiry !== "battle-round"))) return ACTIVATION_CLOCK;
  if (typeof condition.operator === "string" && Array.isArray(condition.operands)) {
    return { ...condition, operands: condition.operands.map((operand) =>
      isObject(operand) ? activationCondition(operand, duration) : operand) };
  }
  return condition;
}

/**
 * An effect gated on a trigger (one, or several alternatives) the way a `timing-is` condition
 * gates it, so the moment is a player-controlled gate and a buff behind it an opt-in lever
 * (`<ability>@<event>`). A trigger on an attack step is met by every attack: only its own
 * condition gates the effect.
 */
export function momentGate(trigger: unknown, effect: unknown, sourceFragment?: unknown): unknown {
  if (effect == null) return effect;
  const condition = momentCondition(trigger);
  if (condition == null) return effect;
  const gated = { type: "conditional", condition, effect };
  activationSources.set(gated, { trigger, fragment: sourceFragment ?? { type: "ability-part", trigger, effect } });
  return gated;
}

function momentCondition(trigger: unknown, duration?: unknown): Record<string, unknown> | null {
  const triggers = (Array.isArray(trigger) ? trigger : [trigger])
    .filter((item): item is Record<string, unknown> => isObject(item) && typeof item.event === "string");
  if (triggers.length === 0) return null;
  const gates = triggers.map((item) => {
    const own = isObject(item.condition) ? item.condition : null;
    if (isAttackStep(item)) return own;
    const moment = ownMoveFact(item) ?? { type: "timing-is", parameters: { timing: momentKey(item) } };
    return own ? { operator: "and", operands: [moment, activationCondition(own, duration)] } : moment;
  });
  if (gates.some((gate) => gate === null)) return null;
  return gates.length === 1 ? gates[0]! : { operator: "or", operands: gates };
}

/** Emit one lever per buff-bearing choice, retaining its shared selection cap. */
function enumerateChoice(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const options = Array.isArray(node.options) ? node.options : [];
  options.forEach((opt, i) => {
    const { buffs, gate } = collectOptionBuffs(opt, source, opts, out.unsupported);
    if (buffs.length === 0) return;
    out.activatable.push({
      id: `${opts.abilityId}?${i}`,
      label: labelForBuffs(buffs),
      buffs,
      ...stanceGateFields(gate),
      group: { id: `${opts.abilityId}?choice`, maxActivations: typeof node.max_choices === "number" ? node.max_choices : 1 },
    });
  });
}

/** Emit one lever per buff-bearing dice-pool option, capped by `max_activations`. */
function enumerateDicePool(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const options = Array.isArray(node.options) ? node.options : [];
  const maxActivations =
    typeof node.max_activations === "number" ? node.max_activations : options.length;
  for (const opt of options) {
    if (!isObject(opt)) continue;
    const { buffs, gate } = collectOptionBuffs(opt.effect, source, opts, out.unsupported);
    if (buffs.length === 0) continue;
    const name = typeof opt.name === "string" && opt.name ? opt.name : labelForBuffs(buffs);
    out.activatable.push({
      id: `${opts.abilityId}#${name}`,
      label: name,
      buffs,
      ...stanceGateFields(gate),
      group: { id: opts.abilityId, maxActivations },
    });
  }
}

/**
 * A `roll` whose nested effect is a choice of dice gates on that roll (`from` + `requirement`): the
 * general encoding of a dice-pool allocation. Emits the same levers `enumerateDicePool` does (ids
 * `<ability>#<option name>`, one group capped by the choice's max_choices). Returns false when the
 * roll is not such an allocation.
 */
function enumerateRollAllocation(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): boolean {
  const choice = node.effect;
  if (!isObject(choice) || choice.type !== "choice" || !Array.isArray(choice.options)) return false;
  const gates = choice.options.map((opt) => {
    const part = isObject(opt) && opt.type === "ability-part" ? opt : undefined;
    const gate = part ? part.effect : opt;
    return isObject(gate) && gate.type === "dice-gated" && gate.requirement != null && isObject(gate.from) && gate.from.roll_var === node.roll_var
      ? { name: part && typeof part.name === "string" ? part.name : undefined, effect: gate.on_success }
      : undefined;
  });
  if (gates.some((g) => g == null)) return false;
  const maxActivations = typeof choice.max_choices === "number" ? choice.max_choices : 1;
  for (const gate of gates) {
    const { buffs, gate: stanceGate } = collectOptionBuffs(gate!.effect, source, opts, out.unsupported);
    if (buffs.length === 0) continue;
    const name = gate!.name ?? labelForBuffs(buffs);
    out.activatable.push({ id: `${opts.abilityId}#${name}`, label: name, buffs, group: { id: opts.abilityId, maxActivations }, ...stanceGateFields(stanceGate) });
  }
  return true;
}

/** Emit one opt-in lever per buff-bearing named option (stance-select / issue-orders). */
function enumerateNamedOptions(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
  groupId: string,
  maxActivations: number,
): void {
  const options = Array.isArray(node.options) ? node.options : [];
  for (const opt of options) {
    if (!isObject(opt)) continue;
    const { buffs, gate } = collectOptionBuffs(opt.effect, source, opts, out.unsupported);
    if (buffs.length === 0) continue;
    const name = typeof opt.name === "string" && opt.name ? opt.name : labelForBuffs(buffs);
    out.activatable.push({
      id: `${opts.abilityId}#${node.type === "stance-select" ? String(opt.id) : name}`,
      label: name,
      buffs,
      ...stanceGateFields(gate),
      group: { id: groupId, maxActivations },
    });
  }
}

/** Each menu action retains its resource cost, eligibility, timing and shared allowance. */
function enumerateMenuActions(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const actions = Array.isArray(node.actions) ? node.actions : [];
  for (const action of actions) {
    if (!isObject(action)) continue;
    const eligibility = isObject(action.eligibility) ? action.eligibility : undefined;
    if (eligibility?.filter !== undefined) {
      const verdict = matchesUnitFilter(eligibility.filter, opts.context, opts.perspective === "attacker" ? "attacker" : "target");
      if (verdict === false) continue;
      if (verdict === "unknown") {
        out.unsupported.push({ reason: "resource-action-menu eligibility filter is unresolved", effectFragment: action });
        continue;
      }
    }
    if (Array.isArray(eligibility?.requires) && eligibility.requires.some((condition) =>
      isObject(condition) && evaluateCondition(condition, opts.context, opts.perspective, opts.grantedHolder ? undefined : source) === false)) continue;
    if (typeof action.id !== "string" || action.id.length === 0) {
      out.unsupported.push({ reason: "resource-action-menu action has no stable id", effectFragment: action });
      continue;
    }
    const { buffs, gate } = collectOptionBuffs(action.effect, source, opts, out.unsupported);
    if (buffs.length === 0) continue;
    const label = typeof action.label === "string" && action.label ? action.label : labelForBuffs(buffs);
    const { effect: _effect, ...requirement } = action;
    const sharedUsage = isObject(node.shared_usage) ? node.shared_usage : undefined;
    const cap = sharedUsage?.unit_max_manoeuvres_per_phase;
    out.activatable.push({
      id: `${opts.abilityId}#${action.id}`, label, buffs,
      ...(typeof cap === "number" ? { group: { id: `${opts.abilityId}?menu`, maxActivations: cap } } : {}),
      requires: [{ menu_id: node.menu_id, pool_id: node.pool_id, shared_usage: node.shared_usage, capacity: node.capacity, action: requirement }],
      ...stanceGateFields(gate),
    });
  }
}

/**
 * Surface a timing-gated activation. The timing itself is just "when" — opting
 * in satisfies it — so we descend into the body: an inner `dice-pool-allocation`
 * or `choice` surfaces its *own* option levers (e.g. Blessings of Khorne's
 * three keyword grants), while inner always-on buffs bundle into a single
 * timing lever. A body with no modelable combat buff (a `resurrection` or
 * `dice-gated`, like Berzerker Frenzy) yields nothing.
 */
function enumerateTimingGate(
  node: Record<string, unknown>,
  source: BuffSource,
  opts: WalkOpts,
  out: EffectTranslation,
): void {
  const condition = node.condition;
  if (!isObject(condition)) return;
  const activation = activationSources.get(node);
  let requirement: Record<string, unknown> | undefined;
  if (isObject(activation?.fragment)) {
    const { effect: _effect, ...metadata } = activation.fragment;
    requirement = metadata;
  }
  const buffs: Buff[] = [];
  collectGatedBuffs(node.effect, source, opts, {}, buffs);
  const sub: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
  walk(node.effect, source, opts, sub);
  // A stochastic branch contributes nothing to a timing activation. Preserve
  // every other unsupported diagnostic discovered while finding inner levers.
  out.unsupported.push(
    ...sub.unsupported.filter(
      ({ reason, effectFragment }) =>
        reason !== stochasticDiceGatedReason ||
        !isObject(effectFragment) ||
        effectFragment.type !== "dice-gated",
    ),
  );
  // Inner independent decisions (dice-pool options, choice branches) pass
  // straight through as their own levers.
  if (requirement) {
    for (const lever of sub.activatable) {
      lever.requires = [requirement, ...(lever.requires ?? [])];
    }
  }
  out.activatable.push(...sub.activatable);
  // Inner unconditional buffs become one lever gated only on the timing.
  if (buffs.length > 0) {
    const timing = extractTiming(condition) ?? "timing";
    out.activatable.push({
      id: `${opts.abilityId}@${timing}`,
      label: labelForBuffs(buffs),
      buffs,
      ...(requirement ? { requires: [requirement] } : {}),
    });
  }
}

/** Buffs an activation gives only under a stance gate, and the gates on them. */
type StanceGated = { buffs: Buff[]; gates: StanceGate[] };

/**
 * The buffs one activation gives, as {@link collectGatedBuffs} finds them. Buffs under a gate on a
 * stance option the context does not declare make the activation carry that gate when they are all
 * it gives; mixed with ungated buffs, or under different gates, they are reported and left out.
 */
function collectOptionBuffs(
  node: unknown,
  source: BuffSource,
  opts: WalkOpts,
  diagnostics: UnsupportedFragment[],
): { buffs: Buff[]; gate?: StanceGate } {
  const buffs: Buff[] = [];
  const stance: StanceGated = { buffs: [], gates: [] };
  collectGatedBuffs(node, source, opts, {}, buffs, diagnostics, stance);
  if (stance.buffs.length === 0) return { buffs };
  const [gate] = stance.gates;
  const single = stance.gates.every((other) =>
    other.negated === gate.negated && other.option.ability_id === gate.option.ability_id && other.option.option_id === gate.option.option_id);
  if (buffs.length === 0 && single) return { buffs: stance.buffs, gate };
  diagnostics.push({ reason: "activation mixes stance-gated buffs with other buffs", effectFragment: node });
  return { buffs };
}

/**
 * Walk the body of a player gate, collecting the buffs it would contribute.
 * Conditions are deferred to `applicableWhen` where expressible; nested
 * decisions and stochastic rolls inside an activation are not modelled.
 */
function collectGatedBuffs(
  node: unknown,
  source: BuffSource,
  opts: WalkOpts,
  applicability: BuffApplicability,
  outBuffs: Buff[],
  diagnostics?: UnsupportedFragment[],
  stance?: StanceGated,
): void {
  if (!isObject(node)) return;
  switch (node.type) {
    case "conditional": {
      const condition = node.condition;
      if (!isObject(condition)) return;
      const split = stance && opts.context.activeRules === undefined ? splitStanceOption(condition) : undefined;
      if (split) {
        stance!.gates.push({ option: split.option, negated: split.negated });
        const gated = split.rest ? { ...node, condition: split.rest } : node.effect;
        collectGatedBuffs(gated, source, opts, applicability, stance!.buffs, diagnostics, stance);
        return;
      }
      const app = conditionToApplicability(condition, opts.perspective, opts.context.attackerToughness);
      if (app === "gate") {
        // A nested timing gate: opting into the activation satisfies it, so
        // keep descending without adding a constraint.
        collectGatedBuffs(node.effect, source, opts, applicability, outBuffs, diagnostics, stance);
        return;
      }
      if (app === "context") {
        // Can't express as a buff gate — fall back to the current context and
        // only descend when the condition is definitely active.
        const verdict = evaluateCondition(condition, opts.context, opts.perspective, opts.grantedHolder ? undefined : source);
        if (verdict === true) {
          collectGatedBuffs(node.effect, source, opts, applicability, outBuffs, diagnostics, stance);
        } else if (verdict === "unknown") diagnostics?.push({ reason: "activation condition cannot be evaluated against current context", effectFragment: activationSources.get(node)?.fragment ?? node });
        return;
      }
      collectGatedBuffs(node.effect, source, opts, combineApplicability(applicability, app), outBuffs, diagnostics, stance);
      return;
    }
    case "rules-bundle":
    case "sequence":
      for (const step of (node.steps as unknown[]) ?? []) {
        collectGatedBuffs(step, source, opts, applicability, outBuffs, diagnostics, stance);
      }
      return;
    case "ability-part": {
      const partOpts = node.duration === undefined ? opts : { ...opts, duration: node.duration };
      if (node.trigger != null || (node.optional !== true && node.cost == null && node.usage == null)) {
        collectGatedBuffs(momentGate(node.trigger, node.effect, node), source, partOpts, applicability, outBuffs, diagnostics, stance);
      }
      return;
    }
    case "choice":
    case "dice-pool-allocation":
    case "dice-gated":
      // A decision (or stochastic roll) nested inside an activation. The outer
      // lever already stands for a player choice; we don't model the inner one.
      return;
    default: {
      // Leaf effect — run the normal leaf translators into a throwaway sink,
      // then attach the accumulated applicability so target/phase gating
      // defers to the resolver instead of vanishing the lever.
      const tmp: EffectTranslation = { applied: [], unsupported: [], activatable: [] };
      walk(node, source, opts, tmp);
      diagnostics?.push(...tmp.unsupported);
      for (const b of tmp.applied) outBuffs.push(applyApplicability(b, applicability));
      return;
    }
  }
}

/** Does this condition (or any operand) gate on a player-controlled timing? */
function conditionMentionsTiming(condition: Record<string, unknown>): boolean {
  if (condition.type === "timing-is") return true;
  if (typeof condition.operator === "string" && Array.isArray(condition.operands)) {
    return condition.operands.some((o) => isObject(o) && conditionMentionsTiming(o));
  }
  return false;
}

/** Pull the first `timing-is` timing value out of a (possibly compound) condition. */
function extractTiming(condition: Record<string, unknown>): string | undefined {
  if (condition.type === "timing-is") {
    const t = (condition.parameters as Record<string, unknown> | undefined)?.timing;
    return typeof t === "string" ? t : undefined;
  }
  if (Array.isArray(condition.operands)) {
    for (const o of condition.operands) {
      if (isObject(o)) {
        const t = extractTiming(o);
        if (t) return t;
      }
    }
  }
  return undefined;
}

/**
 * Translate a condition into a {@link BuffApplicability} the resolver can gate
 * on. Returns `"gate"` for a player-controlled timing (satisfied by opting in),
 * or `"context"` when the condition has no declarative buff representation and
 * must fall back to context evaluation.
 */
/**
 * `not attack-is {weapons: {keyword}}` as a weapon exclusion: the effect applies to attacks with
 * none of those weapon keywords. Any other negation needs the attack context.
 */
function negatedWeaponApplicability(operands: unknown[]): BuffApplicability | "context" {
  const operand = operands.length === 1 ? operands[0] : undefined;
  if (!isObject(operand) || operand.type !== "attack-is" || !isObject(operand.parameters)) return "context";
  const params = operand.parameters;
  if (Object.keys(params).some((key) => key !== "weapons") || !isObject(params.weapons) || unhonorableNarrowing(params)) return "context";
  if (Object.keys(params.weapons).some((key) => key !== "keyword")) return "context";
  const included = weaponApplicability(params)?.weaponKeywords;
  return included && included.length > 0 ? { excludedWeaponKeywords: included } : "context";
}

function conditionToApplicability(
  condition: Record<string, unknown>,
  perspective: TranslationPerspective,
  ownToughness?: number,
): BuffApplicability | "context" | "gate" {
  if (typeof condition.operator === "string" && Array.isArray(condition.operands)) {
    if (condition.operator === "not") return negatedWeaponApplicability(condition.operands);
    if (condition.operator !== "and") return "context";
    let merged: BuffApplicability = {};
    for (const operand of condition.operands) {
      if (!isObject(operand)) return "context";
      const a = conditionToApplicability(operand, perspective, ownToughness);
      if (a === "gate") continue; // timing operand: satisfied by opting in.
      if (a === "context") return "context";
      merged = combineApplicability(merged, a);
    }
    return merged;
  }
  const params = condition.parameters as Record<string, unknown> | undefined;
  switch (condition.type) {
    case "timing-is":
      return "gate";
    case "phase-is": {
      const phase = params?.phase;
      return typeof phase === "string" ? { phases: [phase as Phase] } : "context";
    }
    case "matches": {
      const filter = isObject(params?.filter) ? params.filter : undefined;
      if (!filter || Object.keys(filter).some((key) => key !== "all_of")) return "context";
      const kw = singleKeyword(filter);
      if (kw === undefined) return "context";
      if (params?.subject === "defender") return { requiresTargetKeyword: kw };
      if (params?.subject === "attacker") return { requiresAttackerKeyword: kw };
      return isBuffedUnit(params?.subject) ? perspective === "target" ? { requiresTargetKeyword: kw } : { requiresAttackerKeyword: kw } : "context";
    }
    case "attack-compare": {
      const comparison = attackComparison(params, perspective === "attacker" ? ownToughness : undefined);
      return comparison ? { attackComparisons: [comparison] } : "context";
    }
    case "attack-is": {
      if (params == null || Object.keys(params).some((key) => key !== "attack_type" && key !== "weapons") || unhonorableNarrowing(params)) return "context";
      const phase: BuffApplicability | undefined = params.attack_type === "melee" ? { phases: ["fight"] } : params.attack_type === "ranged" ? { phases: ["shooting"] } : undefined;
      return combineOptional(phase, combineOptional(attackTypeApplicability(params), weaponApplicability(params))) ?? "context";
    }
    default:
      return "context";
  }
}

/** A side of an attack comparison the engine supplies: the attack's S, or either unit's T. */
function attackOperand(value: unknown): AttackComparison["right"] | undefined {
  if (!isObject(value)) return undefined;
  if (Object.keys(value).length === 1 && typeof value.value === "number") return { value: value.value };
  const { of, stat, reduce } = value;
  if (Object.keys(value).some((key) => key !== "of" && key !== "stat" && key !== "reduce")) return undefined;
  if (reduce !== undefined && reduce !== "max" && reduce !== "min") return undefined;
  const supported = of === "attacker"
    ? (stat === "S" && reduce === undefined) || (stat === "T" && reduce !== "min")
    : of === "defender" && stat === "T";
  if (!supported || (of !== "attacker" && of !== "defender") || typeof stat !== "string") return undefined;
  return reduce === undefined ? { of, stat } : { of, stat, reduce };
}

/**
 * The canonical `attack-compare` parameters as a buff gate, or undefined when the engine cannot
 * evaluate them. `ownToughness` is the attacking unit's Toughness when the translation knows it
 * (the ability belongs to the attacker): the gate then carries it as a value, so it holds on any
 * crunch whatever context the caller passes.
 */
function attackComparison(params: Record<string, unknown> | undefined, ownToughness?: number): AttackComparison | undefined {
  if (!params || Object.keys(params).some((key) => key !== "left" && key !== "comparison" && key !== "right")) return undefined;
  const left = attackOperand(params.left);
  const right = attackOperand(params.right);
  const comparison = params.comparison;
  if (!left || "value" in left || !right) return undefined;
  if (comparison !== "gt" && comparison !== "gte" && comparison !== "lt" && comparison !== "lte" && comparison !== "eq") return undefined;
  const bind = (operand: AttackComparison["right"]): AttackComparison["right"] =>
    ownToughness !== undefined && !("value" in operand) && operand.of === "attacker" && operand.stat === "T" ? { value: ownToughness } : operand;
  return { left: bind(left), comparison, right: bind(right) };
}

/** Merge two applicabilities; `phases` intersect, the rest narrow. */
function combineApplicability(a: BuffApplicability, b: BuffApplicability): BuffApplicability {
  const out: BuffApplicability = { ...a, ...b };
  if (b.phases) {
    out.phases = a.phases ? a.phases.filter((p) => b.phases!.includes(p)) : b.phases;
  }
  if (b.rollType) out.rollType = b.rollType;
  if (b.requiresTargetKeyword) out.requiresTargetKeyword = b.requiresTargetKeyword;
  if (b.requiresAttackerKeyword) out.requiresAttackerKeyword = b.requiresAttackerKeyword;
  const weaponFields = ["weaponName", "excludedWeaponName", "weaponKeywords", "excludedWeaponKeywords", "weaponRequirements"];
  if (weaponFields.some((key) => key in a && key in b)) {
    out.weaponRequirements = [a, b];
  }
  if (a.attackComparisons && b.attackComparisons) out.attackComparisons = [...a.attackComparisons, ...b.attackComparisons];
  if (b.excludedTargetKeywords) out.excludedTargetKeywords = [...new Set([...(a.excludedTargetKeywords ?? []), ...b.excludedTargetKeywords])];
  return out;
}

/** Attach an accumulated applicability to a buff (no-op when empty). */
function applyApplicability(buff: Buff, applicability: BuffApplicability): Buff {
  if (Object.keys(applicability).length === 0) return buff;
  const merged = buff.applicableWhen
    ? combineApplicability(buff.applicableWhen, applicability)
    : applicability;
  return { ...buff, applicableWhen: merged };
}

/** A short, deduped human label summarising a lever's contributions. */
function labelForBuffs(buffs: Buff[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const b of buffs) {
    const p = describeContribution(b.contribution);
    if (!seen.has(p)) {
      seen.add(p);
      parts.push(p);
    }
  }
  return parts.join(", ") || "buff";
}

function describeContribution(c: BuffContribution): string {
  switch (c.type) {
    case "extra-keyword":
      return keywordLabel(c.keywordRef);
    case "hit-mod":
      return `${signed(c.value)} to hit`;
    case "wound-mod":
      return `${signed(c.value)} to wound`;
    case "save-mod":
      return `${signed(c.value)} to save`;
    case "damage-mod":
      return `${signed(c.value)} damage`;
    case "attacks-mod":
      return `${signed(c.value)} attacks`;
    case "strength-mod":
      return `${signed(c.value)} strength`;
    case "toughness-mod":
      return `${signed(c.value)} toughness`;
    case "ap-mod":
      return `AP ${c.value}`;
    case "reroll":
      return `re-roll ${c.roll}${c.subset === "ones" ? " 1s" : ""}`;
    case "reroll-one":
      return `re-roll one ${c.roll}`;
    case "feel-no-pain":
      return c.scope === "mortal"
        ? `feel no pain ${c.threshold}+ vs mortals`
        : `feel no pain ${c.threshold}+`;
    case "damage-reduction":
      return `-${c.value} damage`;
    case "invulnerable-save":
      return `${c.threshold}+ invuln`;
    case "cover":
      return "cover";
    case "crit-threshold":
      return `critical ${c.roll} on ${c.value}+`;
    case "ignore-modifiers":
      return `ignore ${c.roll} modifiers`;
    case "skill-mod":
      return `${c.stat} improved by ${c.value}`;
    case "save-characteristic":
      return `${c.value}+ save`;
    case "save-improve":
      return `Save improved by ${c.value} (no better than ${c.best}+)`;
    case "stat-set":
      return `${c.stat} ${c.value}`;
  }
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Render a weapon-keyword ref back to its printed form (best-effort). */
function keywordLabel(ref: WeaponKeywordRef): string {
  const params = ref.parameters ?? {};
  if (ref.keyword_id === "anti" && typeof params.target_keyword === "string") {
    const th = params.threshold;
    return `Anti-${params.target_keyword}${typeof th === "number" ? ` ${th}+` : ""}`;
  }
  const base = ref.keyword_id
    .split("-")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
  return typeof params.value === "number" ? `${base} ${params.value}` : base;
}

// ---------------------------------------------------------------------------
// Condition evaluator
// ---------------------------------------------------------------------------

/** The buffed unit: the ability's own unit (or model), or the unit an aura is applied to. */
function isBuffedUnit(subject: unknown): boolean {
  return subject == null || subject === "this-unit" || subject === "ability-unit" || subject === "this-model" || subject === "recipient";
}

/** Which unit of the attack a condition's subject names, or undefined for another unit. */
function conditionSide(subject: unknown, perspective: TranslationPerspective): "attacker" | "target" | undefined {
  if (subject === "defender") return "target";
  if (subject === "attacker") return "attacker";
  return isBuffedUnit(subject) ? perspective === "attacker" ? "attacker" : "target" : undefined;
}

/** The single required keyword in a canonical filter, else undefined. */
function singleKeyword(params: Record<string, unknown> | undefined): string | undefined {
  const all = Array.isArray(params?.all_of) ? params!.all_of : [];
  if (params?.any_of != null || all.length !== 1 || typeof all[0] !== "string") return undefined;
  return all[0];
}

function evaluateCondition(
  condition: Record<string, unknown>,
  ctx: EngineContext,
  perspective: TranslationPerspective = "attacker",
  source?: BuffSource,
): boolean | "unknown" {
  // Compound conditions use {operator, operands} rather than {type, parameters}.
  // The schema's `condition-node` oneOf doesn't guarantee discrimination by a
  // single field, so dispatch on shape: presence of `operator` + `operands`
  // wins over the simple-condition switch below.
  if (
    typeof condition.operator === "string" &&
    Array.isArray(condition.operands)
  ) {
    return evaluateCompound(condition.operator, condition.operands, ctx, perspective, source);
  }
  switch (condition.type) {
    case "phase-is": {
      const wanted = (condition.parameters as Record<string, unknown> | undefined)?.phase;
      if (typeof wanted !== "string") return "unknown";
      return ctx.phase === wanted;
    }
    case "attack-is": {
      const params = (condition.parameters ?? {}) as Record<string, unknown>;
      if (Object.keys(params).some((k) => k !== "attack_type")) return "unknown";
      if (params.attack_type === "melee") return ctx.phase === "fight";
      if (params.attack_type === "ranged") return ctx.phase === "shooting";
      return "unknown";
    }
    case "timing-is": {
      const wanted = (condition.parameters as Record<string, unknown> | undefined)?.timing;
      if (typeof wanted !== "string") return "unknown";
      if (ctx.timing === undefined) return "unknown";
      return ctx.timing === wanted;
    }
    case "happened": {
      const params = (condition.parameters ?? {}) as Record<string, unknown>;
      const types = isObject(params.filter) && Array.isArray(params.filter.move_types) ? params.filter.move_types : [];
      const own = params.subject == null && params.object == null && params.count == null && params.window === "turn";
      if (!own || params.event !== "move-ended" || types.length !== 1 || Object.keys(params.filter as object).length !== 1) return "unknown";
      // Player-controlled context flags for the buffed unit's own move this turn. An undefined
      // charge flag means the caller couldn't pin it down: stay "unknown" so the SPA surfaces it.
      if (types[0] === "remain-stationary") return ctx.attackerStationary === true;
      if (types[0] === "charge") return ctx.attackerCharged === undefined ? "unknown" : ctx.attackerCharged;
      return "unknown";
    }
    case "attachment": {
      const params = isObject(condition.parameters) ? condition.parameters : {};
      const subject = params.subject;
      const explicitSide = subject === "attacker" ? "attacker" : subject === "defender" ? "target" : undefined;
      if (!explicitSide && subject != null && subject !== "this-model" && subject !== "this-unit" && subject !== "ability-unit") return "unknown";
      const flags = attachmentFromFlags(params, ctx, perspective, source);
      if (flags === false) return false;
      const side = explicitSide ?? (perspective === "attacker" ? "attacker" : "target");
      const sourced = !explicitSide && source?.kind === "ability" && (source.abilityKind === "attached" || source.abilityKind === "support");
      const own = sourced ? source.sourceUnitId : side === "attacker" ? ctx.attackerUnitId : ctx.targetUnitId;
      const members = attachmentFromMembers(params.role, params.with, side === "attacker" ? ctx.attackerMembers : ctx.targetMembers, own);
      if (members !== "unknown") return members;
      return params.with === undefined ? flags : "unknown";
    }
    case "rule-active":
      return evaluateRuleActive(isObject(condition.parameters) ? condition.parameters : {}, ctx);
    case "in-region": {
      const params = isObject(condition.parameters) ? condition.parameters : {};
      const side = conditionSide(params.subject, perspective);
      return side ? evaluateInRegion(params, ctx, side, perspective === "attacker" ? "attacker" : "target") : "unknown";
    }
    case "controls":
      return evaluateControls(isObject(condition.parameters) ? condition.parameters : {}, ctx, perspective === "attacker" ? "attacker" : "target");
    case "matches": {
      const params = isObject(condition.parameters) ? condition.parameters : {};
      const side = conditionSide(params.subject, perspective);
      // Ownership is relative to the side whose ability it is.
      const owner = side === (perspective === "attacker" ? "attacker" : "target") ? "friendly" : "enemy";
      return side ? matchesUnitFilter(params.filter, ctx, side, owner) : "unknown";
    }
    case "army-faction": {
      // "Your Army Faction" is the army of the side whose ability it is.
      const faction = (condition.parameters as Record<string, unknown> | undefined)?.faction;
      const army = perspective === "target" ? ctx.targetArmyFaction : ctx.armyFaction;
      if (typeof faction !== "string" || army === undefined) return "unknown";
      return army === faction;
    }
    case "model-count": {
      // "contains N or more models": min and max are inclusive. A keyword-restricted count needs
      // per-keyword model counts the context does not carry.
      const params = isObject(condition.parameters) ? condition.parameters : {};
      if (params.keyword !== undefined) return "unknown";
      const side = conditionSide(params.subject, perspective);
      const count = side === "attacker" ? ctx.attackerModelCount : side === "target" ? ctx.targetModelCount : undefined;
      if (count === undefined) return "unknown";
      if (typeof params.min === "number" && count < params.min) return false;
      if (typeof params.max === "number" && count > params.max) return false;
      return true;
    }
    case "unit-wargear": {
      // Read from the side's chosen loadout. With `models`, the bounds count the models that
      // carry the item (state carry) or lack it (state lack, which needs the unit's model count).
      const params = isObject(condition.parameters) ? condition.parameters : {};
      const side = conditionSide(params.subject, perspective);
      const wargear = side === "attacker" ? ctx.attackerWargear : side === "target" ? ctx.targetWargear : undefined;
      if (typeof params.wargear !== "string" || wargear === undefined) return "unknown";
      const carried = wargear[params.wargear] ?? 0;
      if (params.models === undefined) return carried > 0;
      const models = isObject(params.models) ? params.models : {};
      const bounds = isObject(models.count) ? models.count : {};
      const modelCount = side === "attacker" ? ctx.attackerModelCount : ctx.targetModelCount;
      const counted = models.state === "carry" ? carried : models.state === "lack" && modelCount !== undefined ? modelCount - carried : undefined;
      if (counted === undefined) return "unknown";
      for (const key of ["min", "max"] as const) {
        if (bounds[key] !== undefined && !Number.isInteger(bounds[key])) return "unknown";
      }
      if (typeof bounds.min === "number" && counted < bounds.min) return false;
      if (typeof bounds.max === "number" && counted > bounds.max) return false;
      return true;
    }
    case "battle-size": {
      const size = (condition.parameters as Record<string, unknown> | undefined)?.size;
      if (typeof size !== "string" || ctx.battleSize === undefined) return "unknown";
      return ctx.battleSize === size;
    }
    case "battle-round": {
      const params = isObject(condition.parameters) ? condition.parameters : {};
      if (ctx.battleRound === undefined) return "unknown";
      if (typeof params.min === "number" && ctx.battleRound < params.min) return false;
      if (typeof params.max === "number" && ctx.battleRound > params.max) return false;
      return true;
    }
    case "player-turn-is": {
      // "Your turn" is the turn of the player whose ability it is.
      const turn = (condition.parameters as Record<string, unknown> | undefined)?.turn;
      if ((turn !== "your-turn" && turn !== "opponent-turn") || ctx.attackerTurn === undefined) return "unknown";
      const yours = perspective === "attacker" ? ctx.attackerTurn : !ctx.attackerTurn;
      return turn === "your-turn" ? yours : !yours;
    }
    case "strength": {
      const params = isObject(condition.parameters) ? condition.parameters : {};
      const side = conditionSide(params.subject, perspective);
      const strength = side === "attacker" ? ctx.attackerStrength : side === "target" ? ctx.targetStrength : undefined;
      if (strength === undefined || (params.below !== "starting" && params.below !== "half")) return "unknown";
      return params.below === "half" ? strength === "below-half" : strength !== "full";
    }
    case "wounds": {
      // Each listed property must hold; the Damaged bracket needs datasheet data the context lacks.
      const params = isObject(condition.parameters) ? condition.parameters : {};
      const side = conditionSide(params.subject, perspective);
      const wounds = side === "attacker" ? ctx.attackerWounds : side === "target" ? ctx.targetWounds : undefined;
      if (wounds === undefined) return "unknown";
      let unknown = params.damaged !== undefined;
      if (params.lost === true && wounds.remaining >= wounds.starting) return false;
      if (params.remaining_max !== undefined) {
        if (typeof params.remaining_max !== "number") unknown = true;
        else if (wounds.remaining > params.remaining_max) return false;
      }
      return unknown ? "unknown" : true;
    }
    case "closest": {
      // Only "the target is the closest eligible target to the attacker" is in the context.
      const params = isObject(condition.parameters) ? condition.parameters : {};
      const toAttacker = params.to === undefined || params.to === "attacker" || (perspective === "attacker" && isBuffedUnit(params.to));
      if (conditionSide(params.subject, perspective) !== "target" || params.among !== "eligible-targets" || !toAttacker) return "unknown";
      if (ctx.targetClosest === undefined) return "unknown";
      if (!ctx.targetClosest) return false;
      if (params.range === undefined) return true;
      const range = params.range;
      if (!isObject(range) || typeof range.inches !== "number" || ctx.distanceInches === undefined) return "unknown";
      return ctx.distanceInches <= range.inches;
    }
    case "guided": {
      // Guided is read for the attacking unit: a For the Greater Good unit, not an Observer, targeting a Spotted unit.
      const subject = (condition.parameters as Record<string, unknown> | undefined)?.subject;
      if ((subject != null && !isBuffedUnit(subject)) || ctx.attackerGuided === undefined) return "unknown";
      return ctx.attackerGuided;
    }
    default:
      return "unknown";
  }
}

/**
 * Kleene three-valued evaluator for compound conditions. `and` short-circuits
 * to `false` as soon as any operand is false (an unknown operand is then
 * irrelevant); `or` short-circuits to `true` symmetrically. `not` flips its
 * single operand and leaves `"unknown"` as `"unknown"`. Unknown operands that
 * don't get short-circuited propagate as `"unknown"` so the SPA can surface
 * the gap rather than collapsing it into a misleading false.
 */
/** `attachment` from the attachment flags and roles alone; `with` filters are left to the members. */
function attachmentFromFlags(
  params: Record<string, unknown>,
  ctx: EngineContext,
  perspective: TranslationPerspective,
  source?: BuffSource,
): boolean | "unknown" {
  const subject = params.subject;
  const explicitSide = subject === "attacker" ? "attacker" : subject === "defender" ? "target" : undefined;
  const side = explicitSide ?? (perspective === "attacker" ? "attacker" : "target");
  let attached = side === "attacker" ? ctx.attackerAttached : ctx.targetAttached;
  let role = side === "attacker" ? ctx.attackerAttachmentRole : ctx.targetAttachmentRole;
  if (!explicitSide && source?.kind === "ability" && (source.abilityKind === "attached" || source.abilityKind === "support")) {
    role = source.sourceUnitId === undefined ? undefined : ctx.attachmentRoles?.[source.sourceUnitId];
    attached = source.abilityKind === "attached" ? true : role === undefined ? undefined : true;
  }
  if (attached === false) return false;
  if (params.role === "attached") return attached ?? "unknown";
  if (params.role === "leading") return role === undefined ? "unknown" : role === "leader";
  // A bodyguard is known to be led; other combined-unit leadership needs more facts.
  if (params.role === "led" && role === "bodyguard") return true;
  return "unknown";
}

function evaluateCompound(
  operator: string,
  operands: unknown[],
  ctx: EngineContext,
  perspective: TranslationPerspective,
  source?: BuffSource,
): boolean | "unknown" {
  if (operator === "not") {
    const first = operands[0];
    if (!isObject(first)) return "unknown";
    const v = evaluateCondition(first, ctx, perspective, source);
    if (v === "unknown") return "unknown";
    return !v;
  }
  if (operator !== "and" && operator !== "or") return "unknown";
  let sawUnknown = false;
  for (const operand of operands) {
    if (!isObject(operand)) {
      sawUnknown = true;
      continue;
    }
    const v = evaluateCondition(operand, ctx, perspective, source);
    if (v === "unknown") {
      sawUnknown = true;
      continue;
    }
    if (operator === "and" && v === false) return false;
    if (operator === "or" && v === true) return true;
  }
  if (sawUnknown) return "unknown";
  return operator === "and"; // all true for AND, all false for OR
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a signed numeric value out of a modifier `{operation, value}` pair.
 * "add"/"subtract" become the matching sign; "set" / "multiply" / etc. return
 * `null` (translator surfaces them as unsupported).
 */
function signedValue(modifier: Record<string, unknown>): number | null {
  const value = Number(modifier.value);
  if (!Number.isFinite(value)) return null;
  switch (modifier.operation) {
    case "add":
      return value;
    case "subtract":
      return -value;
    // For the symmetric stats (A/S/T) and roll-/bs-modifiers, "improve" moves
    // the number up (beneficial) and "worsen" down. AP is handled separately by
    // `apDelta`, which inverts this because AP's beneficial direction is more
    // negative.
    case "improve":
      return value;
    case "worsen":
      return -value;
    default:
      // set / halve / multiply: not a single signed delta — left unsupported.
      return null;
  }
}

/**
 * Read the AP delta out of a stat-modifier `{operation, value}` pair. AP is
 * stored negative (more negative = more piercing), so "improve" makes it more
 * negative and "worsen" less. The legacy `add`/`subtract` forms pass a signed
 * value through directly (the data already encodes the sign).
 */
function apDelta(modifier: Record<string, unknown>): number | null {
  const value = Number(modifier.value);
  if (!Number.isFinite(value)) return null;
  switch (modifier.operation) {
    case "improve":
      return -Math.abs(value);
    case "worsen":
      return Math.abs(value);
    case "add":
      return value;
    case "subtract":
      return -value;
    default:
      return null;
  }
}


function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A roll kind for a diagnostic: "hit", or the ability whose dice it is. */
function rollLabel(roll: unknown): string {
  return isObject(roll) && typeof roll.of_ability === "string" ? `${roll.of_ability} roll` : String(roll);
}

/** Numeric modifier fields whose size a buff reads. */
const SIZED_FIELDS = ["value", "count", "amount"];

/**
 * Why a leaf's size cannot be read here, or undefined: a `scaling` block (the size depends on models
 * or wounds on the board) or a value bound to the battle size, a roll or a count.
 */
function unsizedValueReason(node: Record<string, unknown>): string | undefined {
  if (!isObject(node.modifier) || typeof node.type !== "string") return undefined;
  if (isObject(node.scaling)) return `${node.type}: the value scales with ${String(node.scaling.of)}; not resolved by the buff engine`;
  for (const field of SIZED_FIELDS) {
    const v = node.modifier[field];
    if (!isObject(v)) continue;
    const what = typeof v.roll_var === "string" ? "a bound roll" : typeof v.count_of === "string" ? `the number of ${v.count_of}` : "the battle size";
    return `${node.type}: its ${field} is set by ${what}; not resolved by the buff engine`;
  }
  return undefined;
}

/**
 * A scaled leaf with a cap, as the leaf at that cap: the scaled field set to `max_value` and the
 * scaling removed. Undefined when the scaling has no positive integer cap, the scaled field is not
 * a plain number, or another size is bound.
 */
function scaledToCap(node: Record<string, unknown>): Record<string, unknown> | undefined {
  const scaling = node.scaling;
  const modifier = node.modifier;
  if (!isObject(scaling) || !isObject(modifier)) return undefined;
  const cap = scaling.max_value;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap <= 0) return undefined;
  const field = scaling.field === undefined ? "value" : scaling.field;
  if (typeof field !== "string" || !SIZED_FIELDS.includes(field) || typeof modifier[field] !== "number") return undefined;
  if (SIZED_FIELDS.some((other) => isObject(modifier[other]))) return undefined;
  const { scaling: _scaling, ...rest } = node;
  return { ...rest, modifier: { ...modifier, [field]: cap } };
}

const FIDELITY_BINDING_REASON = "selection/history/model/attack predicates are not resolved by the buff engine";
function hasUnresolvedFidelityBinding(node: Record<string, unknown>): boolean {
  const selector = isObject(node.selector) ? node.selector : undefined;
  const applies = isObject(node.applies) ? node.applies : undefined;
  return (
    ((node.type === "select-units" || node.type === "for-each-unit") && selector != null) ||
    // A designation's own selection (range, visibility, eligibility) is what its lever's player vouches for.
    (node.type === "designate-target" && (
      applies?.beneficiary != null || applies?.reference != null)) ||
    (node.type === "ability-part" && hasUnresolvedTriggerBinding(node.trigger))
  );
}

function hasUnresolvedTriggerBinding(trigger: unknown): boolean {
  if (Array.isArray(trigger)) return trigger.some(hasUnresolvedTriggerBinding);
  return isObject(trigger) && ((isObject(trigger.filter) && trigger.filter.by != null) || trigger.source_ability != null);
}

/** Self targets that, in an ability another unit provides, name that provider. */
const PROVIDER_TARGETS = new Set(["this-unit", "ability-unit", "this-model"]);

function isProvidedByAnotherUnit(source: BuffSource): boolean {
  return source.kind === "ability" && source.abilityKind === "support";
}

