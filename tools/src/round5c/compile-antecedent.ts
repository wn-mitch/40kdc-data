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

/** A Stratagem's own fragments; every other record is one RAW_TEXT. */
const STRATAGEM_FRAGMENTS = new Set(["WHEN", "TARGET", "EFFECT", "RESTRICTIONS"]);

function isStratagem(leaves: readonly CompileLeaf[]): boolean {
  return leaves.some((leaf) => (leaf.fragment !== undefined && STRATAGEM_FRAGMENTS.has(leaf.fragment))
    || STRATAGEM_TARGETS.has(leaf.family_id) || leaf.family_id === "use-window");
}

/** The role an earlier leaf of the record gives an anaphor, in order of precedence. */
function antecedentRole(leaves: readonly CompileLeaf[], index: number): string | null {
  const earlier = leaves.slice(0, index);
  if (earlier.some((other) => SELECTIONS.has(other.family_id))) return "selected-unit";
  if (leaves.some((other) => STRATAGEM_TARGETS.has(other.family_id))) return "this-unit";
  if (earlier.some((other) => other.family_id === "event" && UNIT_EVENT_KINDS.has(String(other.parameters.kind)))) return "event-subject";
  return null;
}

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
  const values = keyEnum(reviewedFamily(leaf.family_id, leaf.family_version).parameterSchema, key) ?? [];
  if (values.includes(role)) return role;
  if (leaf.family_id === "mortal-wounds" && role === "selected-unit" && values.includes("that-unit")) return "that-unit";
  return null;
}

/**
 * Bind every `antecedent` to the unit an earlier leaf of the record introduced: the selected
 * unit when a selection precedes the leaf; else, in a Stratagem, its target (this-unit); else
 * the unit of a preceding event whose moment names a unit (the triggering unit); else, outside
 * a Stratagem, the record's own unit (or model). A Stratagem leaf with none of these, or a leaf
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
