import type { KeywordOption } from "./compile-keyword-menu.js";
/**
 * One fixed DSL fragment per leaf family. The composition rules in `compile.ts` decide how the
 * fragments combine; nothing here depends on the other leaves of an ability.
 */

import { activationModifier } from "./compile-activation.js";
import { permissionDestination } from "./compile-permission-destination.js";
import { isSelectionRef } from "./compile-pair-eligibility.js";
import { condition } from "./compile-conditions.js";
import { boardEffect } from "./compile-board-effects.js";
import { applyCounts } from "./compile-scaling.js";
import { containerEffect } from "./compile-containers.js";
import { printedGrantEffect } from "./compile-granted.js";
import { testEffect } from "./compile-test-effects.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { isTargetRef } from "./compile-target-refs.js";
import { namedRange } from "./named-ranges.js";
import { matchedPoolOf } from "./compile-matched-set.js";

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
};

export class CompileError extends Error {}

type Node = Record<string, unknown>;

const RESOURCE_POOLS: Record<string, string> = {
  "miracle-dice": "miracle-dice-pool", "fate-dice": "fate-dice-pool", "bloodshed-point": "bloodshed-point",
};

/** Whose models an effect changes. "The bearer" is this-model; leaves still spelling it bearer are on a retired version. */
const SUBJECT_TARGETS: Record<string, string> = {
  "this-unit": "this-unit", "this-model": "this-model", "selected-unit": "selected-unit",
  // Later versions of some effect families (family-extensions.ts) also name the triggering unit and the attack's target.
  "event-subject": "event-subject", target: "defender",
  // Bound by compile-antecedent.ts only: the unit a moment happens to (damage allocated to it).
  "event-object": "event-object",
  // Bound by compile-antecedent.ts only: the unit an aura reaches.
  recipient: "recipient",
  // The Transport the bearer is embarked within (family-extensions-16-embarked-transport.ts).
  "bearer-transport": "bearer-transport",
};
/** Recipients that stay themselves when a leader is attached; only the ability's own unit widens to the attached unit. */
const OTHER_UNITS = new Set(["selected-unit", "event-subject", "event-object", "defender", "recipient", "bearer-transport"]);

const MORTAL_TARGETS: Record<string, string> = { target: "defender", "that-unit": "selected-unit", "this-unit": "this-unit", "this-model": "this-model", recipient: "recipient", "event-subject": "event-subject" };

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
function models(leaf: CompileLeaf, subject: Node | string): Node | string {
  const keywords = leaf.parameters.model_keywords as string[] | undefined;
  if (keywords === undefined) return subject;
  if (subject === "this-model") throw new CompileError(`${leaf.family_id} limits this model to its models with keywords; name its unit instead.`);
  return { level: "model", member_of: subject, all_of: keywords };
}

/** A modifier's melee or ranged limit; "all" (or none) limits nothing. */
function weaponScope(leaf: CompileLeaf): Node {
  const type = leaf.parameters.weapon_type === undefined ? "all" : closed(leaf, "weapon_type");
  return type === "all" ? {} : { weapon_type: type };
}

/** Rolls the attacker makes; when an attack targets this unit, modifiers to them belong to the attacker. */
const ATTACKER_ROLLS = new Set(["hit", "wound", "damage"]);

/** "One Hit roll, one Wound roll or one Damage roll": the player picks one roll; each is an option with that roll alone. */
function pickOne(leaf: CompileLeaf, context: Parameters<typeof effect>[1]): Node {
  const { rolls, ...rest } = leaf.parameters as { rolls: string[] } & Record<string, unknown>;
  return { type: "choice", options: rolls.map((roll) => effect({ ...leaf, parameters: { ...rest, roll } }, context)) };
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
 * allocation moment precedes the effect (see attackOwner).
 */
export function effect(leaf: CompileLeaf, context: { attached: boolean; attacker?: Node | string | null; incoming: boolean; defended?: boolean }): Node {
  // A count folded onto the leaf (compile-count-scale.ts) applies to the whole node it lowers to.
  const { scaling, per_item: perItem, ...parameters } = leaf.parameters;
  if (scaling === undefined && perItem === undefined) return leafEffect(leaf, context);
  return applyCounts({ scaling, per_item: perItem }, leafEffect({ ...leaf, parameters }, context));
}

function leafEffect(leaf: CompileLeaf, context: Parameters<typeof effect>[1]): Node {
  const target = (subject: unknown): Node | string => {
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
    // An attached leader's own subject is the whole unit; a selected unit stays the selected unit.
    return context.attached && !OTHER_UNITS.has(found) ? "this-unit" : found;
  };
  // A unit-filter folded onto a subjectless roll ("Friendly X units can re-roll …") names whose rolls.
  const rollTarget = (roll: unknown): Node | string => {
    if (leaf.parameters.subject_filter !== undefined) return structuredClone(leaf.parameters.subject_filter as Node);
    // A test taker that names the units of a unit-filter, with none folded onto this leaf, has no unit to name.
    if (leaf.parameters.test_taker === "filtered-units") throw new CompileError(`${leaf.family_id} names the units of a unit-filter, but none sits right before it.`);
    return typeof leaf.parameters.test_taker === "string" ? leaf.parameters.test_taker
      : typeof leaf.parameters.subject === "string" && (leaf.family_id === "roll-modifier" || leaf.family_id === "reroll" || leaf.family_id === "roll-auto-result") ? target(leaf.parameters.subject)
      : context.incoming && ATTACKER_ROLLS.has(String(roll)) ? "attacker" : context.attacker ?? "this-unit";
  };
  switch (leaf.family_id) {
    case "reroll": {
      // Version 3: a pick of one from several rolls is a choice of one re-roll each.
      if (Array.isArray(leaf.parameters.rolls)) {
        if (leaf.parameters.each !== true) return pickOne(leaf, context);
        // Version 4 `each`: every listed roll can be re-rolled, together.
        const { rolls, each: _each, ...rest } = leaf.parameters as { rolls: string[] } & Record<string, unknown>;
        return { type: "sequence", steps: rolls.map((roll) => effect({ ...leaf, parameters: { ...rest, roll } }, context)) };
      }
      const roll = abilityRollOf(leaf) ?? closed(leaf, "roll");
      const subset = closed(leaf, "subset");
      const modifier: Node = subset === "ones" ? { roll, subset: "ones" } : subset === "failed" ? { roll, subset: "all-failures" } : { roll, result_scope: "any-result" };
      // Version 1 leaves have neither field; version 2 adds them, weapon_type defaulting to "all".
      const count = leaf.parameters.count === undefined ? undefined : closed(leaf, "count");
      if (count !== undefined) modifier.count = count;
      const weaponType = leaf.parameters.weapon_type === undefined ? undefined : closed(leaf, "weapon_type");
      if (weaponType && weaponType !== "all") modifier.weapon_type = weaponType;
      return { type: "re-roll", target: rollTarget(roll), modifier };
    }
    case "ignore-modifiers": {
      // Version 2 lists kinds; compileLeaves splits a two-kind leaf first, so only a lone leaf
      // (a preview) reaches here with both, and it reads as one effect per kind.
      if (Array.isArray(leaf.parameters.what)) {
        const { what: kinds, stats, rolls, ...rest } = leaf.parameters as Record<string, unknown> & { what: string[] };
        const steps = kinds.map((kind) => effect({ ...leaf, parameters: { ...rest, what: kind, ...(kind === "characteristics" ? (stats === undefined ? {} : { stats }) : { rolls }) } }, context));
        return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
      }
      const what = closed(leaf, "what");
      const modifier: Node = { what };
      if (what === "characteristics") {
        const stats = leaf.parameters.stats as string[] | undefined;
        if (stats) modifier.stats = stats;
      } else {
        const rolls = leaf.parameters.rolls as string[] | undefined;
        if (rolls) modifier.rolls = rolls;
      }
      const only = leaf.parameters.only === undefined ? undefined : closed(leaf, "only");
      if (only) modifier.only = only;
      const weaponType = leaf.parameters.weapon_type === undefined ? undefined : closed(leaf, "weapon_type");
      if (weaponType && weaponType !== "all") modifier.weapon_type = weaponType;
      return { type: "ignore-modifiers", target: target(leaf.parameters.subject), modifier };
    }
    case "roll-auto-result": {
      if (Array.isArray(leaf.parameters.rolls)) return pickOne(leaf, context);
      const roll = closed(leaf, "roll");
      const outcome = closed(leaf, "outcome");
      const modifier: Node = { roll };
      if (leaf.parameters.count === 1) modifier.count = 1;
      if (outcome === "succeeds-on") modifier.succeeds_on = closed(leaf, "value");
      else if (outcome === "counts-as-6") modifier.result = 6;
      else modifier.result = "pass";
      const weaponType = leaf.parameters.weapon_type === undefined ? undefined : closed(leaf, "weapon_type");
      if (weaponType && weaponType !== "all") modifier.weapon_type = weaponType;
      return { type: "roll-result", target: rollTarget(roll), modifier };
    }
    case "end-attack-sequence":
      return { type: "end-attack-sequence", target: "attacker" };
    case "roll-modifier": {
      // "Add 1 to Advance and Charge rolls": the same change to each roll, together.
      if (Array.isArray(leaf.parameters.rolls)) {
        const { rolls, ...rest } = leaf.parameters as { rolls: string[] } & Record<string, unknown>;
        return { type: "sequence", steps: rolls.map((roll) => effect({ ...leaf, parameters: { ...rest, roll } }, context)) };
      }
      const roll = abilityRollOf(leaf) ?? closed(leaf, "roll");
      return { type: "roll-modifier", target: rollTarget(roll), modifier: { roll, operation: closed(leaf, "operation"), value: closed(leaf, "value"), ...weaponScope(leaf) } };
    }
    case "critical-hit-threshold": {
      const value = closed(leaf, "value");
      if (typeof value !== "number") throw new CompileError("critical-hit-threshold needs a numeric threshold before it can compile.");
      const roll = leaf.parameters.roll === undefined ? "hit" : closed(leaf, "roll");
      return { type: "roll-result", target: rollTarget(roll), modifier: { roll, critical_on: value } };
    }
    case "resource-action": {
      const resource = closed(leaf, "resource");
      const amount = closed(leaf, "amount");
      if (closed(leaf, "operation") !== "gain") throw new CompileError(`Only resource gains compile; ${String(leaf.parameters.operation)} has no DSL fragment yet.`);
      if (resource === "command-point") return { type: "cp-gain", target: "this-model", modifier: { amount } };
      const pool = RESOURCE_POOLS[String(resource)];
      if (!pool) throw new CompileError(`Resource ${String(resource)} has no DSL pool yet.`);
      return { type: "resource-gain", target: "this-model", modifier: { pool, amount } };
    }
    case "characteristic-set": {
      // A list set together: each pair is one setter with the shared subject and scope.
      if (Array.isArray(leaf.parameters.values)) {
        const { values, ...rest } = leaf.parameters as { values: Array<Record<string, unknown>> } & Record<string, unknown>;
        return { type: "sequence", steps: values.map((item) => effect({ ...leaf, parameters: { ...rest, ...item } }, context)) };
      }
      const subject = leaf.parameters.subject;
      const characteristic = closed(leaf, "characteristic");
      const weaponType = leaf.parameters.weapon_type;
      if (leaf.family_version >= 3 && subject === undefined) throw new CompileError("Characteristic setter needs a reviewed recipient.");
      if (leaf.family_version >= 3 && (WEAPON_CHARACTERISTICS as readonly string[]).includes(String(characteristic)) && weaponType === undefined) {
        throw new CompileError("A weapon characteristic setter needs a reviewed weapon scope.");
      }
      // The attack being made belongs to whoever attacks, as for characteristic-modifier below.
      const owner = subject === "attack" && leaf.family_version >= 7 ? attackOwner(context) : target(subject);
      return {
        type: "stat-modifier", target: owner,
        modifier: {
          stat: characteristic, operation: "set", value: closed(leaf, "value"), ...(weaponType && weaponType !== "all" ? { weapon_type: weaponType } : {}),
          ...(leaf.parameters.weapon_name !== undefined ? { weapon_name: closed(leaf, "weapon_name") } : {}),
        },
      };
    }
    case "weapon-ability-range": {
      // "Friendly X units' Rapid Fire attacks benefit … up to that attack's maximum range": the units the subject names, one clause.
      return { type: "weapon-ability-range", target: target(leaf.parameters.subject), modifier: { keyword: closed(leaf, "keyword"), within: closed(leaf, "within") } };
    }
    case "weapon-ability-grant": {
      // A keyword gated by its own target qualifier (compile-weapon-keywords.ts): only this grant is conditional.
      if (leaf.parameters.gate !== undefined) {
        const { gate, ...rest } = leaf.parameters as Record<string, unknown> & { gate: CompileLeaf };
        return { type: "conditional", condition: condition(gate), effect: effect({ ...leaf, parameters: rest }, context) };
      }
      const weaponType = closed(leaf, "weapon_type");
      const weaponName = leaf.parameters.weapon_name;
      const weaponKeyword = leaf.parameters.weapon_keyword;
      const ifPresent = leaf.parameters.if_present;
      const incoming = leaf.parameters.incoming;
      // A frame folded with its keyword leaves (compile-weapon-keywords.ts) carries `keywords`; a menu grants one of them.
      const keywords = Array.isArray(leaf.parameters.keywords) ? leaf.parameters.keywords as string[] : [closed(leaf, "keyword")];
      if (leaf.parameters.keyword_choice === true && Array.isArray(leaf.parameters.option_groups)) {
        // Options of one or more runs, each run with its own qualifier, under the group's opening condition (compile-keyword-menu.ts).
        const { keywords: _keywords, keyword_choice: _choice, choice_label: _label, option_groups: groups, ...frame } = leaf.parameters as Record<string, unknown> & { option_groups: KeywordOption[] };
        const menu: Node = { type: "choice", options: groups.map((group) => {
          const grants = group.keywords.map((keyword, at) => {
            const grant = effect({ ...leaf, parameters: { ...frame, keyword } }, context);
            const qualifier = group.qualifiers[at];
            return qualifier ? { type: "conditional", condition: condition(qualifier), effect: grant } : grant;
          });
          const body: Node = grants.length === 1 ? grants[0]! : { type: "sequence", steps: grants };
          return group.gate ? { type: "conditional", condition: condition(group.gate), effect: body } : body;
        }) };
        if (leaf.parameters.choice_label !== undefined) menu.choice_label = closed(leaf, "choice_label");
        return menu;
      }
      if (leaf.parameters.keyword_choice === true) {
        // A menu option may carry the target qualifier printed after it (compile-weapon-keywords.ts): that option is conditional.
        const { keywords: _keywords, keyword_choice: _choice, choice_label: _label, option_conditions: conditions, ...frame } = leaf.parameters as Record<string, unknown> & { option_conditions?: CompileLeaf[] };
        const menu: Node = { type: "choice", options: keywords.map((keyword, at) => {
          const grant = effect({ ...leaf, parameters: { ...frame, keyword } }, context);
          const qualifier = conditions?.[at];
          return qualifier ? { type: "conditional", condition: condition(qualifier), effect: grant } : grant;
        }) };
        // The opener's label for its menu (compile-weapon-keywords.ts carries it over when the opener is dropped).
        if (leaf.parameters.choice_label !== undefined) menu.choice_label = closed(leaf, "choice_label");
        return menu;
      }
      // A list of named weapons (compile-weapon-names.ts): the same grant to each weapon, one step per name.
      if (Array.isArray(leaf.parameters.weapon_names)) {
        const { weapon_names: names, ...rest } = leaf.parameters as Record<string, unknown> & { weapon_names: string[] };
        const steps = names.map((name) => effect({ ...leaf, parameters: { ...rest, weapon_name: name } }, context));
        return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
      }
      // Version 7: "that attack has the [X] ability" — the attack's weapon, whoever makes the attack.
      // A grant with no subject has no bearer: no unit names its weapons and no model filter follows its scope.
      if (leaf.parameters.subject === undefined) throw new CompileError("A weapon-ability-grant names no bearer: it has no unit and no model filter for its weapons.");
      const holder = leaf.parameters.subject === "attack" ? (context.incoming ? "attacker" : context.attacker ?? "this-unit") : target(leaf.parameters.subject);
      return {
        type: "weapon-ability-grant", target: holder,
        modifier: {
          abilities: keywords,
          ...(weaponType && weaponType !== "all" ? { weapon_type: weaponType } : {}),
          ...(weaponName !== undefined ? { weapon_name: weaponName } : {}),
          ...(weaponKeyword !== undefined ? { weapon_keyword: weaponKeyword } : {}),
          // "that weapon": the weapon the record's select-weapon bound (compile-weapon-antecedent.ts).
          ...(leaf.parameters.weapon_var !== undefined ? { weapon_ref: { weapon_var: String(leaf.parameters.weapon_var) } } : {}),
          ...(ifPresent !== undefined ? { if_present: ifPresent } : {}),
          ...(incoming === true ? { incoming: true } : {}),
        },
      };
    }
    case "weapon-ability-removal": {
      // "Do not have [Heavy]" under a scope (compile-weapon-scopes.ts bindRemoval): the scope's weapons lose it.
      const subject = leaf.parameters.subject;
      if (subject === undefined) throw new CompileError("A weapon ability removal has no recipient; it needs a weapon-property scope before it.");
      const weaponType = leaf.parameters.weapon_type;
      const weaponKeyword = leaf.parameters.weapon_keyword;
      return {
        type: "weapon-ability-grant", target: target(subject),
        modifier: {
          removes: [closed(leaf, "keyword")],
          ...(weaponType && weaponType !== "all" ? { weapon_type: weaponType } : {}),
          ...(weaponKeyword !== undefined ? { weapon_keyword: weaponKeyword } : {}),
        },
      };
    }
    case "core-ability-grant": {
      const value = leaf.parameters.value;
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
      return { type: "mortal-wounds", target: MORTAL_TARGETS[String(closed(leaf, "recipient"))], modifier: { count: /^\d+$/u.test(count) ? Number(count) : count, ...cap } };
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
            ? { type: "weapon-ability-grant", target: owner, modifier: { abilities: ["Assault"], weapon_type: "ranged" } }
            : { type: "permission", target: owner, modifier: { activity: act === "charge" ? "declare-charge" : act, allow: true, after: [move] } });
        }
      }
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    case "regain-wounds": {
      const amount = String(closed(leaf, "amount"));
      const per = leaf.parameters.per;
      return { type: "heal", target: target(leaf.parameters.subject), modifier: { amount: /^\d+$/u.test(amount) ? Number(amount) : amount, ...(per ? { per } : {}) } };
    }
    case "characteristic-modifier": {
      // An additive change needs its amount: a change left without one is not lowered as a change of nothing.
      if (leaf.parameters.value === undefined && leaf.parameters.operation !== "halve") {
        throw new CompileError("Stat adjustment needs an amount; a change with no amount needs a characteristic amount leaf after its recipient.");
      }
      if (leaf.family_version < 2) {
        return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
      }
      if (leaf.parameters.subject === undefined) throw new CompileError("Stat adjustment needs a reviewed recipient.");
      if (leaf.parameters.weapon_type === undefined && leaf.parameters.weapon_var === undefined && (leaf.parameters.characteristics as string[]).some((stat) => stat === "Range" || (WEAPON_CHARACTERISTICS as readonly string[]).includes(stat))) {
        throw new CompileError("Stat adjustment needs a reviewed weapon scope.");
      }
      // The attack being made belongs to whoever attacks: the attacker when it targets this unit.
      // A weapon characteristic of "this model" names the bearer's own weapons: an attached leader's
      // bearer stays the model, not the led unit (so a Psychic-weapon scope does not widen to the unit).
      // "that unit" bound to the bearer (compile-antecedent.ts) is the led unit's models, so only an authored "this model" qualifies.
      const authoredBearer = !(leaf.antecedent_keys ?? []).includes("subject");
      const bearerWeapons = leaf.parameters.subject === "this-model" && authoredBearer && (leaf.parameters.characteristics as string[]).some((stat) => (WEAPON_CHARACTERISTICS as readonly string[]).includes(stat));
      const owner = leaf.parameters.subject === "attack" ? attackOwner(context) : models(leaf, bearerWeapons ? "this-model" : target(leaf.parameters.subject));
      const weaponType = closed(leaf, "weapon_type") ?? "all";
      // A list of named weapons (compile-weapon-names.ts) changes each characteristic for each weapon: one step per pair.
      const named = Array.isArray(leaf.parameters.weapon_names) ? leaf.parameters.weapon_names as string[] : undefined;
      const names: Array<string | undefined> = named ?? [leaf.parameters.weapon_name === undefined ? undefined : closed(leaf, "weapon_name") as string];
      const steps = (leaf.parameters.characteristics as string[]).flatMap((stat) => names.map((weaponName) => ({
        type: "stat-modifier", target: owner,
        modifier: {
          stat, operation: closed(leaf, "operation"),
          // Version 11: halve takes no value.
          ...(leaf.parameters.value !== undefined ? { value: closed(leaf, "value") } : {}), ...(weaponType !== "all" ? { weapon_type: weaponType } : {}),
          ...(leaf.parameters.weapon_keyword !== undefined ? { weapon_keyword: closed(leaf, "weapon_keyword") } : {}),
          ...(weaponName !== undefined ? { weapon_name: weaponName } : {}),
          ...(leaf.parameters.minimum !== undefined ? { minimum: closed(leaf, "minimum") } : {}),
          // "That weapon's attacks have": the weapon select-weapon bound (compile-weapon-antecedent.ts).
          ...(leaf.parameters.weapon_var !== undefined ? { weapon_ref: { weapon_var: String(leaf.parameters.weapon_var) } } : {}),
          ...(leaf.parameters.exclude_weapon_name !== undefined ? { exclude_weapon_name: closed(leaf, "exclude_weapon_name") } : {}),
        },
      })));
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    case "eligibility-permission": {
      const despite = leaf.parameters.despite as string[] | undefined;
      const asIf = leaf.parameters.as_if;
      const stratagem = leaf.parameters.stratagem;
      return {
        type: "permission", target: target(leaf.parameters.subject),
        modifier: {
          activity: closed(leaf, "activity"), allow: closed(leaf, "allow"),
          ...(despite && despite.length > 0 ? { despite } : {}),
          ...(asIf ? { as_if: asIf } : {}),
          ...(stratagem ? { stratagem } : {}),
          // An embark permission's destination (compile-permission-destination.ts).
          ...(leaf.parameters.into !== undefined ? { into: permissionDestination(leaf) } : {}),
          // A folded counts-as-moved leaf (compile-counts-as-moved.ts): the units count as having made this move.
          ...(leaf.parameters.counts_as_move !== undefined ? { counts_as_move: closed(leaf, "counts_as_move") } : {}),
        },
      };
    }
    case "targeting-restriction": {
      // enemy-units / friendly-units are every unit of that side, as a DSL unit-filter.
      // "those X units": the set an earlier unit-position of matching-unit introduced (compile-matched-set.ts).
      const unit = (value: unknown) => value === "matched-units" ? matchedPoolOf(leaf) : value === "enemy-units" ? { owner: "enemy" } : value === "friendly-units" ? { owner: "friendly" } : target(value);
      const weaponType = closed(leaf, "weapon_type");
      const range = leaf.parameters.range;
      const modifier: Node = {
        may: closed(leaf, "may"), kind: closed(leaf, "kind"),
        ...(weaponType !== "all" ? { weapon_type: weaponType } : {}),
        ...(range != null ? { range: { inches: range } } : {}),
      };
      // Version 3 names both sides: the effect sits on the unit that targets when the leaf says
      // which, else on the unit being targeted.
      if (leaf.parameters.target !== undefined) {
        const targeted = unit(closed(leaf, "target"));
        const by = leaf.parameters.by === undefined ? undefined : unit(closed(leaf, "by"));
        const named: Node = {
          ...(leaf.parameters.stratagem !== undefined ? { stratagem: closed(leaf, "stratagem") } : {}),
          ...(leaf.parameters.except !== undefined ? { except: closed(leaf, "except") } : {}),
        };
        return { type: "targeting", target: structuredClone(by ?? targeted), modifier: { ...(by !== undefined ? { by } : {}), ...modifier, target: targeted, ...named } };
      }
      return { type: "targeting", target: unit(closed(leaf, "subject")), modifier };
    }
    case "counts-as": {
      // A region grant (family-extensions-15-named-region.ts) names the army rule's region instead of a range;
      // a named-range grant (family-extensions-16-named-range-reference.ts) names the range and whose units it is measured to.
      const modifier: Node = leaf.parameters.range_ref !== undefined
        ? { within: { aura_of: namedRange(leaf.parameters.range_ref).aura_of }, of: { owner: closed(leaf, "of_side") } }
        : leaf.parameters.region !== undefined
        ? { in_region: { rule_region: structuredClone(leaf.parameters.region as Node) } }
        : { within: { inches: closed(leaf, "within") } };
      return { type: "counts-as", target: target(leaf.parameters.subject), modifier };
    }
    case "rule-state":
      return {
        type: "rule-state", target: target(leaf.parameters.subject),
        modifier: {
          direction: closed(leaf, "direction"), rule_kind: closed(leaf, "rule_kind"), rule: closed(leaf, "rule"),
          // The attacks a shooting moment bound ("those attacks"), folded by compile-bound-attacks.ts.
          ...(leaf.parameters.attacks_var !== undefined ? { attacks: { event_var: closed(leaf, "attacks_var") } } : {}),
        },
      };
    case "damage-reduction": {
      const reductionRaw = String(closed(leaf, "reduction"));
      const reduction = /^\d+$/u.test(reductionRaw) ? Number(reductionRaw) : reductionRaw;
      const weaponType = closed(leaf, "weapon_type");
      return { type: "damage-reduction", target: target(leaf.parameters.subject), modifier: { reduction, ...(weaponType !== "all" ? { weapon_type: weaponType } : {}) } };
    }
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
