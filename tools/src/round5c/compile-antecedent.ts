import { ANTECEDENT, antecedentKeys, keyEnum } from "./antecedent-families.js";
import { reviewedFamily } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/** Leaves that choose a unit an anaphor can point back to. */
const SELECTIONS = new Set(["select-unit", "for-each-unit-select"]);
/** A Stratagem's TARGET leaves; the target is the unit its effects name as this-unit. */
const STRATAGEM_TARGETS = new Set(["stratagem-target", "triggering-target", "target-binding"]);
/**
 * Event kinds whose moment is a unit acting or being acted on, so "that unit" can be it. Phase,
 * turn, round and step boundaries, resource and designation changes, uses of a rule and named
 * rolls introduce no unit.
 */
const UNIT_EVENT_KINDS = new Set([
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
  while (at >= 0 && leaves[at]!.family_id === "unit-owner" && leaves[at]!.fragment === leaf.fragment) at -= 1;
  const filter = leaves[at];
  if (filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment) return false;
  const before = leaves[at - 1];
  return !(before && before.fragment === leaf.fragment && (FILTER_ANCHORS.has(before.family_id) || before.family_id === "unit-filter"));
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
  const earlier = leaves.slice(0, index);
  if (earlier.some((other) => SELECTIONS.has(other.family_id))) return "selected-unit";
  if (bareFilter(leaves, index)) return FILTERED_UNITS;
  if (earlier.some((other) => other.family_id === "aura-range")) return AURA_RECIPIENT;
  if (leaves.some((other) => STRATAGEM_TARGETS.has(other.family_id))) return "this-unit";
  const moment = earlier.filter((other) => other.family_id === "event" && UNIT_EVENT_KINDS.has(String(other.parameters.kind))).at(-1);
  // "Each time an attack is allocated to a model, … that model": the unit the moment happens to,
  // which the DSL's damage-allocated trigger holds as its object; its subject is the attacker.
  if (moment) return OBJECT_MOMENTS.has(String(moment.parameters.kind)) ? "event-object" : "event-subject";
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
};
const ANY_UNIT_CONDITION_KEYS: Readonly<Record<string, readonly string[]>> = {
  "unit-state": ["subject", "with"], "unit-activity": ["subject"], "unit-position": ["subject", "of"], "unit-keyword": ["subject"], "hit-by-attacks": ["subject"],
  // An owned moment's subject goes into the trigger as is (compile-triggers.ts).
  event: ["subject"],
};

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
  if (role === FILTERED_UNITS) return ANY_UNIT_KEYS[leaf.family_id]?.includes(key) || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key) ? role : null;
  if (role === AURA_RECIPIENT) {
    if (ANY_UNIT_KEYS[leaf.family_id]?.includes(key) || ANY_UNIT_CONDITION_KEYS[leaf.family_id]?.includes(key)) return role;
    if (leaf.family_id === "mortal-wounds" && key === "recipient") return role;
    return null;
  }
  const values = keyEnum(reviewedFamily(leaf.family_id, leaf.family_version).parameterSchema, key) ?? [];
  if (values.includes(role)) return role;
  // A selected or triggering unit is a plain DSL unit-ref, which a key lowered as any unit-ref
  // takes even when its family's own enum does not list it.
  if ((role === "selected-unit" || role === "event-subject" || role === "event-object")
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
    // ("If a friendly X unit is …, that unit …"), the condition is per recipient instead, which
    // this binding does not say.
    if (introduced === FILTERED_UNITS && leaf.role === "CONDITION" && leaves.slice(index + 1).some(hasAntecedent)) {
      throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} tests the units of a unit-filter that a later leaf points back to; a per-recipient condition cannot compile yet.`);
    }
    const parameters = { ...leaf.parameters };
    for (const key of keys) {
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
