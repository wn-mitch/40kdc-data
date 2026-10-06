import { ANTECEDENT, antecedentKeys, keyEnum } from "./antecedent-families.js";
import { reviewedFamily } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { awaitsFollowingFilter } from "./family-extensions-11.js";
import { destroyedObject, rollOwnerEvent } from "./compile-model-level.js";

/** Leaves that choose a unit an anaphor can point back to. */
/** A Stratagem's TARGET leaves; the target is the unit its effects name as this-unit. */
const STRATAGEM_TARGETS = new Set(["stratagem-target", "triggering-target", "target-binding"]);
/**
 * Event kinds whose moment is a unit acting or being acted on, so "that unit" can be it. Phase,
 * turn, round and step boundaries, resource and designation changes, uses of a rule and named
 * rolls introduce no unit.
 */
export const UNIT_EVENT_KINDS = new Set([
  "attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "this-model-destroyed", "after-shooting",
  "selected-to-shoot", "selected-to-fight", "enemy-selected-targets", "enemy-ended-move", "enemy-has-shot", "enemy-declared-charge",
  "disembarked", "damage-allocated", "state-changed", "move-ended", "selected", "targets-selected", "attacks-resolved", "set-up",
]);

/** Moments whose only named unit is the one they happen to (the trigger's object). */
const OBJECT_MOMENTS = new Set(["damage-allocated"]);

/** A Stratagem's own fragments; every other record is one RAW_TEXT. */
const STRATAGEM_FRAGMENTS = new Set(["WHEN", "TARGET", "EFFECT", "RESTRICTIONS"]);

function isStratagem(leaves: readonly CompileLeaf[]): boolean {
  return leaves.some((leaf) => (leaf.fragment !== undefined && STRATAGEM_FRAGMENTS.has(leaf.fragment))
    || STRATAGEM_TARGETS.has(leaf.family_id) || leaf.family_id === "use-window");
}

/**
 * The unit an aura reaches ("While a friendly X unit is within 6\" of this model, that unit …"):
 * the DSL's `recipient`, the unit the aura is being applied to.
 */
export const AURA_RECIPIENT = "recipient";
/**
 * Every unit a unit-filter right before the leaf matches ("Friendly **K** units" + "have the
 * Scouts ability"): an army-wide grant. Folding (`compile-unit-filters.ts`) puts the filter on
 * the leaf as `subject_filter`, which becomes its DSL target.
 */
export const FILTERED_UNITS = "filtered-units";

/** Leaves a unit-filter right after them belongs to: it says which units they pick or aim at. */
const FILTER_ANCHORS = new Set(["select-unit", "stratagem-target", "attack"]);

/**
 * The unit-filter an anaphor right after it names, when nothing else claims the filter: it sits
 * in the same fragment directly before the leaf (a "from your army" between them is the filter's
 * own wording), with no selection, Stratagem target or attack right before it.
 */
function bareFilter(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  let at = index - 1;
  // Past a per-recipient condition on the same units ("is within range of an objective, that unit's …").
  while (at >= 0 && leaves[at]!.fragment === leaf.fragment
    && (leaves[at]!.family_id === "unit-owner" || (leaves[at]!.role === "CONDITION" && hasAntecedent(leaves[at]!)))) at -= 1;
  const filter = leaves[at];
  if (filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment) return false;
  const before = leaves[at - 1];
  return !(before && before.fragment === leaf.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter"));
}

/**
 * A leaf a bare filter's description runs through on its way to the moment it describes: a
 * condition, a "from your army", or the unit-filter a following-filter distance measures to.
 */
function describes(leaves: readonly CompileLeaf[], at: number, fragment: string | undefined): boolean {
  const leaf = leaves[at];
  if (!leaf || leaf.fragment !== fragment) return false;
  if (leaf.family_id === "unit-owner") return true;
  if (leaf.family_id === "unit-filter") {
    const before = leaves[at - 1];
    return before !== undefined && awaitsFollowingFilter(before.parameters);
  }
  return leaf.role === "CONDITION";
}

/**
 * "an enemy unit" + "engaged with this unit" + "is selected to fight": the index of the ownerless
 * moment that a bare filter, and the conditions between them, describe; null when there is none.
 * The filter is the moment's unit, and each condition is on that unit.
 */
export function momentOfFilter(leaves: readonly CompileLeaf[], filterIndex: number): number | null {
  const filter = leaves[filterIndex];
  if (filter?.family_id !== "unit-filter") return null;
  const before = leaves[filterIndex - 1];
  if (before && before.fragment === filter.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter")) return null;
  let at = filterIndex + 1;
  while (describes(leaves, at, filter.fragment)) at += 1;
  const moment = leaves[at];
  // An ownerless moment, or one its filter's own side owns ("an enemy model" + "selects its targets").
  return moment?.family_id === "event" && moment.fragment === filter.fragment && moment.parameters.subject === undefined
    && (moment.parameters.owner === undefined || (filter.parameters.side !== "any" && moment.parameters.owner === filter.parameters.side)) ? at : null;
}

/**
 * The moment's unit a condition between a bare filter and the moment describes, or null: the
 * subject, or, for a destruction the filter names (compile-unit-filters.ts), the destroyed object.
 */
function onMomentUnit(leaves: readonly CompileLeaf[], index: number): string | null {
  const leaf = leaves[index]!;
  if (leaf.role !== "CONDITION") return null;
  // Back past the description to the filter it starts with (a filter a following-filter distance
  // measures to is part of the description, so the walk passes it).
  let at = index - 1;
  while (at >= 0 && describes(leaves, at, leaf.fragment)) at -= 1;
  const moment = momentOfFilter(leaves, at);
  if (moment === null || moment <= index) return null;
  return destroyedObject(leaves[moment], leaves[at]) ? "event-object" : "event-subject";
}

/** "when a friendly X model … is destroyed": a destruction whose object a unit-filter before it names. */
function filterNamesObject(leaves: readonly CompileLeaf[], momentIndex: number): boolean {
  return leaves.some((leaf, at) => at < momentIndex && momentOfFilter(leaves, at) === momentIndex && destroyedObject(leaves[momentIndex], leaf));
}

/**
 * "when a saving throw is failed for a" + "friendly X model": the last roll moment before the leaf
 * whose roll a unit-filter right after it (past "from your army") names, so it introduces a unit.
 */
function rollOwnerBefore(leaves: readonly CompileLeaf[], index: number): boolean {
  const at = leaves.slice(0, index).map((leaf) => leaf.family_id === "event").lastIndexOf(true);
  if (at < 0) return false;
  let next = at + 1;
  while (leaves[next]?.family_id === "unit-owner") next += 1;
  return next < index && rollOwnerEvent(leaves[at], leaves[next]);
}

/**
 * "a friendly model" + "that disembarked from this TRANSPORT this turn" + "makes an attack": the
 * index of the attack a bare filter and the conditions after it describe, or null. The filter is
 * the attacker (compile-unit-filters.ts), and each condition is on the attacking unit.
 */
export function attackOfFilter(leaves: readonly CompileLeaf[], filterIndex: number): number | null {
  const filter = leaves[filterIndex];
  if (filter?.family_id !== "unit-filter") return null;
  const before = leaves[filterIndex - 1];
  if (before && before.fragment === filter.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter")) return null;
  let at = filterIndex + 1;
  while (describes(leaves, at, filter.fragment) && leaves[at]!.family_id !== "unit-filter") at += 1;
  const attack = leaves[at];
  // A back-reference ("If that attack …") is an earlier attack again; a filter before it is never its attacker.
  return at > filterIndex + 1 && attack?.family_id === "attack" && attack.fragment === filter.fragment && attack.parameters.direction === "makes"
    && attack.parameters.backref !== true && attack.parameters.refers === undefined
    && leaves.slice(filterIndex + 1, at).some((leaf) => leaf.role === "CONDITION") ? at : null;
}

/** Leaves after which "that unit" is a selected unit, a for-each pass's unit or an aura's recipient, not a bare filter's. */
const UNIT_INTRODUCERS = new Set(["select-unit", "for-each-unit-select", "aura-range"]);

/**
 * "While a friendly X unit" + "is within range of an objective" + "attacks that target that unit":
 * the index of the attack on that unit a bare filter and the conditions after it describe, or null.
 * The filter is the defender (compile-unit-filters.ts), and each condition is on it. At least one
 * condition about the filter's unit sits between them (still pointing back, or already bound to the
 * target); without one, or after a selection, aura or for-each, "that unit" is that leaf's unit.
 */
export function targetedAttackOfFilter(leaves: readonly CompileLeaf[], filterIndex: number): number | null {
  const filter = leaves[filterIndex];
  if (filter?.family_id !== "unit-filter") return null;
  const before = leaves[filterIndex - 1];
  if (before && before.fragment === filter.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter")) return null;
  if (leaves.slice(0, filterIndex).some((leaf) => UNIT_INTRODUCERS.has(leaf.family_id))) return null;
  let at = filterIndex + 1;
  while (describes(leaves, at, filter.fragment) && leaves[at]!.family_id !== "unit-filter") at += 1;
  const attack = leaves[at];
  const onUnit = (leaf: CompileLeaf) => leaf.role === "CONDITION" && (hasAntecedent(leaf) || Object.values(leaf.parameters).includes("target"));
  return attack?.family_id === "attack" && attack.fragment === filter.fragment && attack.parameters.direction === "targeted" && attack.parameters.unit === "that-unit"
    && leaves.slice(filterIndex + 1, at).some(onUnit) ? at : null;
}

/** Whether a condition sits between a bare filter and the attack on that filter's unit. */
function onTargeted(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  if (leaf.role !== "CONDITION") return false;
  let at = index - 1;
  while (at >= 0 && describes(leaves, at, leaf.fragment) && leaves[at]!.family_id !== "unit-filter") at -= 1;
  const attack = targetedAttackOfFilter(leaves, at);
  return attack !== null && attack > index;
}

/** Whether a condition sits between a bare filter and the attack they describe. */
function onAttacker(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  if (leaf.role !== "CONDITION") return false;
  let at = index - 1;
  while (at >= 0 && describes(leaves, at, leaf.fragment) && leaves[at]!.family_id !== "unit-filter") at -= 1;
  const attack = attackOfFilter(leaves, at);
  return attack !== null && attack > index;
}

/** Leaves that claim a unit-filter right before them, so it is not an effect's postfix recipient. */
const FILTER_CLAIMANTS = new Set(["aura-range", "event", "attack"]);

/**
 * "Add 1 to the Strength characteristic of" + "**K** models from your army": an effect whose units
 * a unit-filter right after it names, in the same fragment, when nothing after the filter (past a
 * "from your army") claims it instead.
 */
export function postfixFilter(leaves: readonly CompileLeaf[], index: number): boolean {
  const leaf = leaves[index]!;
  const filter = leaves[index + 1];
  if (!ANY_UNIT_KEYS[leaf.family_id] || filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment) return false;
  let at = index + 2;
  while (leaves[at]?.family_id === "unit-owner" && leaves[at]!.fragment === leaf.fragment) at += 1;
  const next = leaves[at];
  // A back-referring effect after the filter takes it as its own prefix ("Friendly X units have …").
  return !(next && next.fragment === leaf.fragment
    && (FILTER_CLAIMANTS.has(next.family_id) || (next.role === "EFFECT" && Object.values(next.parameters).includes("antecedent"))));
}

/** The role an earlier leaf of the record gives an anaphor, in order of precedence. */
function antecedentRole(leaves: readonly CompileLeaf[], index: number): string | null {
  if (postfixFilter(leaves, index)) return FILTERED_UNITS;
  // "an enemy unit" + "engaged with this unit" + "is selected to fight": the moment's unit.
  const momentUnit = onMomentUnit(leaves, index);
  if (momentUnit !== null) return momentUnit;
  // "a friendly model" + "that disembarked this turn" + "makes an attack": the attacking unit.
  if (onAttacker(leaves, index)) return "attacker";
  // "a friendly X unit" + "is within range of an objective" + "attacks that target that unit": the defender.
  if (onTargeted(leaves, index)) return "target";
  // "when a saving throw is failed for a friendly X model within 6\" …, that attack": the model whose roll it is.
  if (rollOwnerBefore(leaves, index)) return "event-subject";
  const earlier = leaves.slice(0, index);
  // "Friendly X units' attacks that target that unit": a filter right before an attack-property
  // scope names whose attacks, even after a selection the rest of the record points to.
  if (leaves[index]!.family_id === "weapon-property-scope" && bareFilter(leaves, index)) return FILTERED_UNITS;
  if (earlier.some((other) => other.family_id === "select-unit")) return "selected-unit";
  // "For each enemy unit …, that unit …": each pass's unit, which the DSL's for-each-unit calls its recipient.
  if (earlier.some((other) => other.family_id === "for-each-unit-select")) return AURA_RECIPIENT;
  if (bareFilter(leaves, index)) return FILTERED_UNITS;
  if (earlier.some((other) => other.family_id === "aura-range")) return AURA_RECIPIENT;
  const moment = earlier.filter((other) => other.family_id === "event" && UNIT_EVENT_KINDS.has(String(other.parameters.kind))).at(-1);
  // In a Stratagem's WHEN clause, "an enemy unit ends a move" + "within 8\" of …": the moment's
  // unit, not the Stratagem's target, which only the later clauses name.
  const inWhen = leaves[index]!.fragment === "WHEN" && moment?.fragment === "WHEN";
  if (!inWhen && leaves.some((other) => STRATAGEM_TARGETS.has(other.family_id))) return "this-unit";
  // "Each time an attack is allocated to a model, … that model": the unit the moment happens to,
  // which the DSL's damage-allocated trigger holds as its object; its subject is the attacker.
  if (moment) return OBJECT_MOMENTS.has(String(moment.parameters.kind)) || filterNamesObject(leaves, leaves.indexOf(moment)) ? "event-object" : "event-subject";
  return null;
}

/**
 * Keys whose lowering takes any DSL unit-ref, so they can name an aura's recipient or the units a
 * filter matches even though their family's own enum lists neither: effects go through
 * `compile-fragments.ts` target(), conditions through widenedWho. A filter's units are a DSL
 * unit-filter object, which only an effect's target can hold.
 */
const ANY_UNIT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "characteristic-modifier": ["subject"], "weapon-ability-grant": ["subject"], "keyword-grant": ["subject"], "feel-no-pain": ["subject"],
  "regain-wounds": ["subject"], "return-models": ["subject"], "eligibility-permission": ["subject"], "core-ability-grant": ["subject"],
  "invulnerable-save": ["subject"], "ability-record-grant": ["subject"], "move-through": ["subject"],
  "targeting-restriction": ["by", "target"], "weapon-property-scope": ["subject"], "ignore-modifiers": ["subject"],
  "roll-modifier": ["subject"], reroll: ["subject"], "ability-activate": ["subject"],
  "make-move": ["subject"], "set-up": ["subject"], "apply-mark": ["subject"], test: ["target"],
  "damage-reduction": ["subject"],
};
const ANY_UNIT_CONDITION_KEYS: Readonly<Record<string, readonly string[]>> = {
  "unit-state": ["subject", "with"], "unit-activity": ["subject"], "unit-position": ["subject", "of"], "unit-keyword": ["subject"], "hit-by-attacks": ["subject"],
  "in-region": ["subject"],
  targeted: ["subject"], "target-is-selected": ["by", "target"],
  // An owned moment's subject, and who destroyed a unit, go into the trigger as is (compile-triggers.ts).
  event: ["subject", "by"],
};

/** Units a chosen-option-grant holder can bind to: the menu's own-unit effects are retargeted to it. */
const MENU_HOLDERS = new Set(["this-unit", "this-model", "selected-unit", "event-subject", AURA_RECIPIENT]);

/** Subject-like keys whose values say which of the record's own unit or model it talks about. */
const SELF_KEYS = ["subject", "recipient", "target", "unit", "who", "of", "with", "to"];

/**
 * Outside a Stratagem, an anaphor nothing earlier introduces ("it can be set up anywhere …") is
 * the record's own unit; the model, when the record's other leaves only ever name this model.
 */
function ownRole(leaves: readonly CompileLeaf[]): string {
  const named = new Set(leaves.flatMap((leaf) => SELF_KEYS.map((key) => leaf.parameters[key]).filter((value) => value === "this-unit" || value === "this-model")));
  return named.has("this-model") && !named.has("this-unit") ? "this-model" : "this-unit";
}

/**
 * The value a family records for a bound role, when the family can name it. A recipient of
 * mortal wounds names a selected unit as `that-unit` (`compile-fragments.ts` MORTAL_TARGETS).
 */
function boundValue(leaf: CompileLeaf, key: string, role: string): string | null {
  // "that unit has that ability": the unit whose options the menu before it applies (compile.ts retargets them).
  if (leaf.family_id === "chosen-option-grant") return MENU_HOLDERS.has(role) ? role : null;
  if (role === FILTERED_UNITS) return ANY_UNIT_KEYS[leaf.family_id]?.includes(key) || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key) ? role : null;
  if (role === AURA_RECIPIENT) {
    if (ANY_UNIT_KEYS[leaf.family_id]?.includes(key) || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key)) return role;
    if (leaf.family_id === "mortal-wounds" && key === "recipient") return role;
    // A family that lists the recipient itself ("each enemy unit … must take a Battle-shock test").
    return keyEnum(reviewedFamily(leaf.family_id, leaf.family_version).parameterSchema, key)?.includes(role) ? role : null;
  }
  const values = keyEnum(reviewedFamily(leaf.family_id, leaf.family_version).parameterSchema, key) ?? [];
  if (values.includes(role)) return role;
  // A selected or triggering unit is a plain DSL unit-ref, which a key lowered as any unit-ref
  // takes even when its family's own enum does not list it.
  if ((role === "selected-unit" || role === "event-subject" || role === "event-object" || role === "attacker")
    && (ANY_UNIT_KEYS[leaf.family_id]?.includes(key) || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key))) return role;
  if (leaf.family_id === "mortal-wounds" && role === "selected-unit" && values.includes("that-unit")) return "that-unit";
  return null;
}

/**
 * Bind every `antecedent` to the unit an earlier leaf of the record introduced: the selected
 * unit when a selection precedes the leaf; else the units a unit-filter right before it matches
 * (an army-wide grant); else the unit a preceding aura reaches (its recipient); else, in a
 * Stratagem, its target (this-unit); else the unit of a preceding event whose moment names a unit
 * (the triggering unit); else, outside a Stratagem, the record's own unit (or model). A Stratagem leaf with none of these, or a leaf
 * whose family cannot name the unit it binds to, refuses compilation. Later lowering only sees
 * the bound roles.
 */
export function bindAntecedents(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  return leaves.map((leaf, index) => {
    const keys = antecedentKeys(leaf.family_id, leaf.parameters);
    if (keys.length === 0) return leaf;
    const introduced = antecedentRole(leaves, index);
    if (introduced === null && isStratagem(leaves)) {
      throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to an earlier unit (${ANTECEDENT}), but no earlier leaf selects a unit, targets a Stratagem or names a unit's moment.`);
    }
    // "While an enemy unit is within Engagement Range of this unit": a condition on the units a
    // bare filter matches holds when any of them meets it. When a later leaf also points back
    // ("If a friendly X unit is …, that unit …"), the condition is per recipient instead: each
    // unit the effect's filter matches receives it only while that unit meets the condition.
    const perRecipient = introduced === FILTERED_UNITS && leaf.role === "CONDITION" && leaves.slice(index + 1).some(hasAntecedent);
    const parameters = { ...leaf.parameters };
    for (const key of keys) {
      if (perRecipient) {
        if (boundValue(leaf, key, AURA_RECIPIENT) === null) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} tests each unit a later effect's filter matches, which its ${key} cannot name.`);
        parameters[key] = AURA_RECIPIENT;
        continue;
      }
      // The record's own unit is the unit or its model, whichever the family can name here.
      const own = ownRole(leaves);
      const role = introduced ?? (boundValue(leaf, key, own) === null ? (own === "this-unit" ? "this-model" : "this-unit") : own);
      const value = boundValue(leaf, key, role);
      if (value === null) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to the ${role}, which its ${key} cannot name.`);
      parameters[key] = value;
    }
    return { ...leaf, parameters };
  });
}

/** Whether any parameter of a leaf still points back to an earlier unit. */
export function hasAntecedent(leaf: CompileLeaf): boolean {
  return antecedentKeys(leaf.family_id, leaf.parameters).length > 0;
}
