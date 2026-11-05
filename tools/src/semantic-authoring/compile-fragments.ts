/**
 * One fixed DSL fragment per leaf family. The composition rules in `compile.ts` decide how the
 * fragments combine; nothing here depends on the other leaves of an ability.
 */

import { activationModifier } from "./compile-activation.js";
import { thatManyCount } from "./compile-that-many.js";
import { permissionDestination } from "./compile-permission-destination.js";
import { isSelectionRef } from "./compile-pair-eligibility.js";
import { boardEffect } from "./compile-board-effects.js";
import { applyCounts } from "./compile-scaling.js";
import { containerEffect } from "./compile-containers.js";
import { printedGrantEffect } from "./compile-granted.js";
import { testEffect } from "./compile-test-effects.js";
import { isTargetRef } from "./compile-target-refs.js";
import { namedRange } from "./named-ranges.js";
import { CompileError } from "./compile-error.js";
import { namedAbilityStateEffect } from "./compile-named-ability-states.js";
import { oathEffect } from "./compile-oath.js";
import { compileNamedRegionProducer } from "./compile-named-region.js";
import { targetingEffect } from "./compile-targeting.js";
import { withEmbarked } from "./compile-with-embarked.js";
import { abilityUseEffect } from "./compile-ability-use.js";
import { rollEffect } from "./compile-roll-effects.js";
import { keywordRef, weaponAbilityEffect, weaponScope } from "./compile-weapon-effects.js";
import { characteristicEffect } from "./compile-characteristic-effects.js";

export { CompileError };

export type CompileLeaf = {
  role: string;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
  start_byte: number;
  /** Where the leaf's wording ends; with the source text it locates clause breaks. */
  end_byte?: number;
  fragment?: string;
  /** A NAME leaf's stored wording, set by leaf-view.ts from the workbench row; absent on hand-built leaves. */
  exact_text?: string;
  /** A Stratagem target's exclusive mode ("a", "b"), set by compile-target-modes.ts; absent without modes. */
  mode?: string;
  /** The cost a paid target mode names (label: pool or resource name; amount: whole number). */
  mode_cost?: { label: string; amount: number };
  /** The parameters a binding filled in from an earlier leaf (compile-antecedent.ts); absent when none. */
  antecedent_keys?: string[];
  /**
   * Reviewed connectives (connective-rows.ts) whose next leaf in the fragment is this one, set by
   * leaf-view.ts. Absent when none.
   */
  connectives?: LeafConnective[];
  /**
   * Leaves a fold carried into this one's own parameters (compile-counts-as-moved.ts: a charge
   * refusal that "if it does" introduces becomes the permission's then_cannot). Absent when none.
   */
  absorbs?: Array<{ fragment: string; start_byte: number; end_byte: number; family_id: string }>;
};

/** A reviewed connective attached to the leaf it introduces (compile-connective-plan.ts reads it). */
export type LeafConnective = {
  relation: string; surface: string; start_byte: number; end_byte: number;
  /** Printed inside the leaf's own span. */
  within?: boolean;
  /** No leaf follows it in its fragment; it sits on the fragment's last leaf. */
  trailing?: boolean;
};

type Node = Record<string, unknown>;

/** Who an effect's attacks and recipients belong to; `effect()` documents each field. */
export type EffectContext = { attached: boolean; attacker?: Node | string | null; incoming: boolean; defended?: boolean; allocatedTo?: unknown };

/** Resolves a family's subject parameter to its DSL target (built per leaf in `leafEffect()`). */
export type TargetOf = (subject: unknown) => Node | string;

const RESOURCE_POOLS: Record<string, string> = {
  "miracle-dice": "miracle-dice-pool", "fate-dice": "fate-dice-pool", "bloodshed-point": "bloodshed-point",
};

/** Whose models an effect changes. "The bearer" is this-model; leaves still spelling it bearer are on a retired version. */
const SUBJECT_TARGETS: Record<string, string> = {
  "this-unit": "this-unit", "this-model": "this-model", "selected-unit": "selected-unit",
  // Later versions of some effect families (families/) also name the triggering unit and the attack's target.
  "event-subject": "event-subject", target: "defender",
  // Bound by compile-antecedent.ts only: the unit a moment happens to (damage allocated to it).
  "event-object": "event-object",
  // Bound by compile-antecedent.ts only: the unit an aura reaches.
  recipient: "recipient",
  // The Transport the bearer is embarked within (bearer-transport, families/shared.ts).
  "bearer-transport": "bearer-transport",
};
/** Recipients that stay themselves when a leader is attached; only the ability's own unit widens to the attached unit. */
const OTHER_UNITS = new Set(["selected-unit", "event-subject", "event-object", "defender", "recipient", "bearer-transport"]);

/** Families whose subject is a property of one model: its keywords, its rules, its characteristics. */
const MODEL_PROPERTY_FAMILIES = new Set(["keyword-grant", "rule-state", "characteristic-modifier", "characteristic-set"]);

/**
 * A model property the source writes of "this model" (not a "that unit" compile-antecedent.ts bound
 * to the bearer): an attached leader's own keywords and characteristics, not the led unit's.
 */
function ownModelProperty(leaf: CompileLeaf): boolean {
  return MODEL_PROPERTY_FAMILIES.has(leaf.family_id) && leaf.parameters.subject === "this-model" && !(leaf.antecedent_keys ?? []).includes("subject");
}

const MORTAL_TARGETS: Record<string, string> = { target: "defender", "that-unit": "selected-unit", "this-unit": "this-unit", "this-model": "this-model", recipient: "recipient", "event-subject": "event-subject", "event-object": "event-object" };

const isSource = (value: unknown): boolean => value !== null && typeof value === "object" && "source" in value;

/**
 * A roll a named ability makes ({ability: id} on a reroll or roll-modifier): the DSL's of_ability
 * ability-roll. Not closed(): the object carries an id, not quoted source text.
 */
export function abilityRollOf(leaf: CompileLeaf): { of_ability: string } | undefined {
  const roll = leaf.parameters.roll;
  if (roll === null || typeof roll !== "object" || !("ability" in roll)) return undefined;
  return { of_ability: String((roll as { ability: unknown }).ability) };
}

export function closed(leaf: CompileLeaf, name: string): unknown {
  const value = leaf.parameters[name];
  if (isSource(value)) throw new CompileError(`${leaf.family_id} ${name} is quoted source text; give it a listed value before it can compile.`);
  return value;
}

/**
 * A unit a family names by a closed role: the role itself, or every unit the unit-filter folded
 * before the leaf matches (`filtered-units`, bound by compile-antecedent.ts).
 */
export function unitOf(leaf: CompileLeaf, name: string): Node | string {
  const value = closed(leaf, name);
  if (value !== "filtered-units") return value as string;
  if (leaf.parameters.subject_filter === undefined) throw new CompileError(`${leaf.family_id} names the units of a unit-filter, but none sits right before it.`);
  return structuredClone(leaf.parameters.subject_filter as Node);
}

/**
 * "**CHARACTER** models in this unit": the subject's own models with every listed keyword, as a
 * model-level DSL unit-filter; without model_keywords, the subject itself.
 */
export function models(leaf: CompileLeaf, subject: Node | string): Node | string {
  const keywords = leaf.parameters.model_keywords as string[] | undefined;
  if (keywords === undefined) return subject;
  if (subject === "this-model") throw new CompileError(`${leaf.family_id} limits this model to its models with keywords; name its unit instead.`);
  return { level: "model", member_of: subject, all_of: keywords };
}

/**
 * The attack a subject-attack leaf changes ("that attack"). `incoming` attacks target this unit, so
 * the attack belongs to its attacker. `defended` marks an allocation moment: the attack is allocated
 * to a model in the bearer's unit, so the bearer's unit is the attack's target, as in every
 * stat-modifier on an incoming attack. Else the attack is the one the bearer's unit makes.
 */
export function attackOwner(context: { attacker?: Node | string | null; incoming: boolean; defended?: boolean }): Node | string {
  if (context.incoming) return "attacker";
  if (context.defended) return "this-unit";
  return context.attacker ?? "this-unit";
}

/**
 * One effect. `subject` is who the ability's own subject resolves to: the unit when a leader
 * is attached, else the family's subject parameter. `incoming` marks an effect on attacks that
 * target this unit, where the attacker's rolls are modified. `defended` is set when an
 * allocation moment precedes the effect (see attackOwner). `allocatedTo` is that moment's object: an attack allocated
 * to this model, or to the unit a selection picked, reduces that model's or that unit's damage, not this unit's.
 */
export function effect(leaf: CompileLeaf, context: EffectContext): Node {
  // "That unit (and any units embarked within that unit)": the same effect on the embarked units too (compile-with-embarked.ts).
  if (leaf.parameters.with_embarked === true) {
    const { with_embarked: _widened, ...parameters } = leaf.parameters;
    return withEmbarked(effect({ ...leaf, parameters }, context));
  }
  // "… after the attacking unit has finished making its attacks" (compile-destruction-after-attacks.ts): the effect waits for that unit.
  if (leaf.parameters.after_attacks === true) {
    const { after_attacks: _deferred, ...parameters } = leaf.parameters;
    return { type: "ability-part", trigger: { event: "attacks-resolved", subject: "attacker" }, effect: effect({ ...leaf, parameters }, context) };
  }
  const specialized = namedAbilityStateEffect(leaf) ?? oathEffect(leaf) ?? abilityUseEffect(leaf);
  if (specialized) return specialized;
  // A count folded onto the leaf (compile-count-scale.ts) applies to the whole node it lowers to.
  const { scaling, per_item: perItem, ...parameters } = leaf.parameters;
  if (scaling === undefined && perItem === undefined) return leafEffect(leaf, context);
  return applyCounts({ scaling, per_item: perItem }, leafEffect({ ...leaf, parameters }, context));
}

/**
 * The fragment for one leaf's family. Roll, weapon-ability and characteristic families lower in
 * their own modules; board, container and test families are tried after every family here.
 */
function leafEffect(leaf: CompileLeaf, context: EffectContext): Node {
  const target: TargetOf = (subject) => {
    // Every unit a folded unit-filter matches (compile-unit-filters.ts): an army-wide grant.
    if (subject === "filtered-units") {
      if (leaf.parameters.subject_filter === undefined) throw new CompileError(`${leaf.family_id} names the units of a unit-filter, but none sits right before it.`);
      return structuredClone(leaf.parameters.subject_filter as Node);
    }
    // One of a Stratagem's several targets (compile-target-refs.ts), resolved once the entry is built.
    if (isTargetRef(subject)) return subject;
    // The outer or inner unit of a bound selection pair (compile-pair-eligibility.ts).
    if (isSelectionRef(subject)) return subject as unknown as Node;
    const found = SUBJECT_TARGETS[String(subject)];
    if (!found) throw new CompileError(`${leaf.family_id}@${leaf.family_version} subject ${JSON.stringify(subject)} has no DSL target; move the leaf to its current version.`);
    // An attached leader's own subject is the whole unit; a selected unit stays the selected unit,
    // and a keyword or characteristic written of "this model" stays the leader's own model.
    if (found === "this-model" && ownModelProperty(leaf)) return found;
    return context.attached && !OTHER_UNITS.has(found) ? "this-unit" : found;
  };
  const delegated = rollEffect(leaf, context, target) ?? weaponAbilityEffect(leaf, context, target) ?? characteristicEffect(leaf, context, target);
  if (delegated) return delegated;
  switch (leaf.family_id) {
    case "end-attack-sequence":
      return { type: "end-attack-sequence", target: "attacker" };
    case "resource-action": {
      const resource = closed(leaf, "resource");
      const amount = closed(leaf, "amount");
      if (closed(leaf, "operation") !== "gain") throw new CompileError(`Only resource gains compile; ${String(leaf.parameters.operation)} has no DSL fragment yet.`);
      if (resource === "command-point") return { type: "cp-gain", target: "this-model", modifier: { amount } };
      const pool = RESOURCE_POOLS[String(resource)];
      if (!pool) throw new CompileError(`Resource ${String(resource)} has no DSL pool yet.`);
      return { type: "resource-gain", target: "this-model", modifier: { pool, amount } };
    }
    case "core-ability-grant": {
      const value = leaf.parameters.value;
      // Deep Strike prints no rating, so no unit has one for a grant to read.
      if (leaf.parameters.ability === "deep-strike" && value !== undefined) throw new CompileError("core-ability-grant: Deep Strike carries no rating; grant it without a value.");
      return { type: "ability-grant", target: target(leaf.parameters.subject), modifier: { ability: closed(leaf, "ability"), ...(value !== undefined ? { value } : {}) } };
    }
    case "ability-record-grant": {
      if (leaf.parameters.printed !== undefined || leaf.parameters.granted !== undefined) return printedGrantEffect(leaf, target(leaf.parameters.subject));
      const value = leaf.parameters.value;
      const rulesBundle = leaf.parameters.rules_bundle;
      return {
        type: "ability-grant", target: target(leaf.parameters.subject),
        modifier: { ability: closed(leaf, "ability"), ...(value !== undefined ? { value } : {}), ...(rulesBundle === true ? { rules_bundle: true } : {}) },
      };
    }
    case "keyword-grant": {
      const replaces = leaf.parameters.replaces;
      return { type: "keyword-grant", target: target(leaf.parameters.subject), modifier: { keywords: leaf.parameters.keywords, ...(replaces !== undefined ? { replaces } : {}) } };
    }
    case "weapon-grant": {
      const count = leaf.parameters.count;
      return { type: "weapon-grant", target: target(leaf.parameters.subject), modifier: { weapon_id: closed(leaf, "weapon_id"), ...(count !== undefined ? { count } : {}) } };
    }
    case "ability-modifier": {
      const p = leaf.parameters;
      return {
        type: "ability-modifier", target: target(p.subject),
        modifier: {
          ability: closed(leaf, "ability"), aspect: closed(leaf, "aspect"), operation: closed(leaf, "operation"),
          ...(p.value !== undefined ? { value: p.value } : {}),
          ...(p.cap !== undefined ? { cap: p.cap } : {}),
          ...(p.recipients !== undefined ? { recipients: p.recipients } : {}),
          ...(p.add_option !== undefined ? { add_option: p.add_option } : {}),
          ...(p.cap_per !== undefined ? { cap_per: p.cap_per } : {}),
          ...(p.not_same !== undefined ? { not_same: p.not_same } : {}),
          ...(p.consumes_shared_use !== undefined ? { consumes_shared_use: p.consumes_shared_use } : {}),
        },
      };
    }
    case "ability-activate":
      return { type: "ability-activate", target: target(leaf.parameters.subject), modifier: activationModifier(leaf) };
    case "feel-no-pain": {
      const against = closed(leaf, "against");
      return { type: "feel-no-pain", target: models(leaf, target(leaf.parameters.subject)), modifier: { threshold: closed(leaf, "threshold"), ...(against !== "all" ? { against } : {}) } };
    }
    case "invulnerable-save":
      return { type: "invulnerable-save", target: models(leaf, target(leaf.parameters.subject)), modifier: { invuln_sv: closed(leaf, "threshold") } };
    case "fights-first":
      return { type: "ability-grant", target: target(leaf.parameters.subject), modifier: { ability: "fights-first" } };
    case "sticky-objective":
      // Version 4: "that objective is secured", the marker the record's select-objective chose (compile.ts names it).
      if (leaf.parameters.subject === "selected-objective") {
        if (typeof leaf.parameters.selection_var !== "string") throw new CompileError("sticky-objective names the selected objective marker, but this record selects no objective marker.");
        return { type: "objective-sticky", target: "this-unit", modifier: { objective: { selection_var: leaf.parameters.selection_var } } };
      }
      // Version 1 leaves carry no subject at all, and always meant this-unit.
      return { type: "objective-sticky", target: leaf.parameters.subject !== undefined ? closed(leaf, "subject") : "this-unit" };
    case "no-advance-roll":
      return { type: "move-modifier", target: target(leaf.parameters.subject), modifier: { advance: "fixed-6" } };
    // A transient planning node (compile.ts): the instead loop removes it, and a left-over one is refused.
    case "roll-prohibition":
      return { type: "roll-prohibition", roll: closed(leaf, "roll") };
    case "mortal-wounds": {
      const count = String(closed(leaf, "count"));
      // Version 5: "(to a maximum of 6 mortal wounds)" caps the total.
      const cap = leaf.parameters.max === undefined ? {} : { max: closed(leaf, "max") };
      // "that enemy unit" under a later moment: the unit the Stratagem's WHEN moment bound (compile-when-subject.ts).
      // "that enemy unit" after a selection of this unit's models: the unit selection's name (compile-pair-eligibility.ts).
      const target = typeof leaf.parameters.recipient_var === "string" ? { event_var: leaf.parameters.recipient_var }
        : typeof leaf.parameters.recipient_selection === "string" ? { selection_var: leaf.parameters.recipient_selection }
          : leaf.parameters.recipient === "filtered-units" ? unitOf(leaf, "recipient") : MORTAL_TARGETS[String(closed(leaf, "recipient"))];
      // "These mortal wounds are inflicted by a psychic attack" (compile-weapon-qualified.ts foldMortalWoundSources).
      const psychic = leaf.parameters.psychic === true ? { psychic: true } : {};
      // "… and regains up to that many lost wounds": the count is the pair's shared roll (compile-that-many.ts).
      const amount = typeof leaf.parameters.count_var === "string" ? thatManyCount(leaf.parameters.count_var, count) : count === "rating" ? { rating: true } : /^\d+$/u.test(count) ? Number(count) : count;
      return { type: "mortal-wounds", target, modifier: { count: amount, ...cap, ...psychic } };
    }
    case "fight-on-death": {
      const act = leaf.family_version >= 2 ? closed(leaf, "act") : "fight";
      // Shooting is a plain grant with no timing of its own: no resolution, removal, roll, or eligibility.
      if (act === "shoot") return { type: "act-on-death", target: target(leaf.parameters.subject), modifier: { act: "shoot" } };
      // The schema pairs each resolution with its removal; a roll or eligibility is folded in by compile-dice.
      return closed(leaf, "timing") === "when-its-unit-fights"
        ? { type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "when-unit-fights", removal: "after-unit-fights-or-phase-end" } }
        : { type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "after-attacking-unit-finishes", removal: "after-destroyed-model-fights" } };
    }
    case "act-after-move": {
      // Shooting after Advancing is [ASSAULT] on every ranged weapon (as Devastator Doctrine is
      // written); every other act is a permission after that move.
      const owner = target(leaf.parameters.subject);
      const acts = leaf.parameters.acts as string[];
      const steps: Record<string, unknown>[] = [];
      for (const move of leaf.parameters.moves as string[]) {
        for (const act of acts) {
          steps.push(move === "advance" && act === "shoot"
            ? { type: "weapon-ability-grant", target: owner, modifier: { keywords: [keywordRef("Assault")], ...weaponScope({ ...leaf, parameters: { ...leaf.parameters, weapon_type: "ranged" } }) } }
            : { type: "permission", target: owner, modifier: { activity: act === "charge" ? "declare-charge" : act, allow: true, after: [move] } });
        }
      }
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    case "regain-wounds": {
      const amount = String(closed(leaf, "amount"));
      const per = leaf.parameters.per;
      // "Regains all of its lost wounds" is the DSL's full heal.
      const quantity = typeof leaf.parameters.amount_var === "string" ? { roll_var: leaf.parameters.amount_var }
        : amount === "all" ? "full" : /^\d+$/u.test(amount) ? Number(amount) : amount;
      return { type: "heal", target: target(leaf.parameters.subject), modifier: { amount: quantity, ...(per ? { per } : {}) } };
    }
    case "eligibility-permission": {
      const despite = leaf.parameters.despite as string[] | undefined;
      const asIf = leaf.parameters.as_if;
      const stratagem = leaf.parameters.stratagem;
      const modelName = leaf.parameters.model_name as string | undefined;
      const weaponNames = leaf.parameters.weapon_names as string[] | undefined;
      const subject = target(leaf.parameters.subject);
      return {
        // "The Tempestor Aquilon": the subject's models with that profile name.
        type: "permission", target: modelName === undefined ? subject : { level: "model", member_of: subject, model_names: [modelName] },
        modifier: {
          activity: closed(leaf, "activity"), allow: closed(leaf, "allow"),
          ...(despite && despite.length > 0 ? { despite } : {}),
          ...(asIf ? { as_if: asIf } : {}),
          ...(stratagem ? { stratagem } : {}),
          // A fight permission's reach ("models within 3" are eligible to fight") and its next-to-fight order.
          ...(leaf.parameters.reach !== undefined ? { reach: { inches: closed(leaf, "reach") } } : {}),
          ...(leaf.parameters.next === true ? { next: true } : {}),
          // An embark permission's destination (compile-permission-destination.ts).
          ...(leaf.parameters.into !== undefined ? { into: permissionDestination(leaf) } : {}),
          // A folded counts-as-moved leaf (compile-counts-as-moved.ts): the units count as having made this move.
          ...(leaf.parameters.counts_as_move !== undefined ? { counts_as_move: closed(leaf, "counts_as_move") } : {}),
          // "that phase", and a charge refusal on the same subject folded with it: "if it does, it cannot declare a charge".
          ...(leaf.parameters.counts_as_until !== undefined ? { counts_as_until: closed(leaf, "counts_as_until") } : {}),
          ...(leaf.parameters.then_cannot !== undefined ? { then_cannot: closed(leaf, "then_cannot") } : {}),
          // "with its sentry flamer, sentry grenade launcher or sentry hot-shot volley gun": any one of these weapons.
          ...(weaponNames !== undefined ? { weapons: weaponNames.map((name) => ({ name })) } : {}),
        },
      };
    }
    case "targeting-restriction":
      return targetingEffect(leaf, target);
    case "counts-as": {
      // A region grant (counts-as@2, families/regions.ts) names the army rule's region instead of a range;
      // a named-range grant (counts-as@3) names the range and whose units it is measured to.
      const modifier: Node = leaf.parameters.range_ref !== undefined
        ? { within: { aura_of: namedRange(leaf.parameters.range_ref).aura_of }, of: { owner: closed(leaf, "of_side") } }
        : leaf.parameters.region !== undefined
        ? { in_region: { rule_region: structuredClone(leaf.parameters.region as Node) } }
        : { within: { inches: closed(leaf, "within") } };
      return { type: "counts-as", target: target(leaf.parameters.subject), modifier };
    }
    case "named-region-producer":
      return compileNamedRegionProducer(leaf);
    case "rule-state":
      return {
        type: "rule-state", target: target(leaf.parameters.subject),
        modifier: {
          direction: closed(leaf, "direction"), rule_kind: closed(leaf, "rule_kind"), rule: closed(leaf, "rule"),
          // The attacks a shooting moment bound ("those attacks"), folded by compile-bound-attacks.ts.
          ...(leaf.parameters.attacks_var !== undefined ? { attacks: { event_var: closed(leaf, "attacks_var") } } : {}),
          ...(leaf.parameters.any_army_faction === true ? { any_army_faction: true } : {}),
        },
      };
    default: {
      const board = boardEffect(leaf, target);
      if (board) return board;
      const container = containerEffect(leaf);
      if (container) return container;
      const test = testEffect(leaf);
      if (test) return test;
      throw new CompileError(`Effect ${leaf.family_id} has no DSL fragment yet.`);
    }
  }
}
