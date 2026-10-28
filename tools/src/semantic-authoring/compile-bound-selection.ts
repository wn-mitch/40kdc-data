import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Two selections in one ability, where the second is measured from or visible to the first:
 * "select one friendly X model" (bind_as) then "select one enemy unit within 8\" of that model"
 * (within_of), or a selection of the ability's own models after a unit selection
 * (ownModelsAfter). The first selection wraps the second, and the effects name the second, the
 * selection the ability's wording makes its unit. Any other pair of selections has no reading.
 */

const refersTo = (leaf: CompileLeaf) => leaf.parameters.within_of !== undefined || leaf.parameters.visible_to !== undefined;

/**
 * "Select one enemy unit …, then select one or more X models in this unit": a selection of the
 * ability's own models after a selection of a unit. The models are chosen for the unit already
 * selected, so the first selection wraps the second, as a measured pair does; the effects take
 * each selected model, and name the unit only by the first selection's bound name.
 */
export function ownModelsAfter(outer: CompileLeaf, inner: CompileLeaf): boolean {
  const filter = (inner.parameters.filter ?? {}) as Record<string, unknown>;
  return inner.parameters.target_kind === "model" && filter.member_of === "this-unit" && outer.parameters.target_kind !== "model"
    && outer.start_byte < inner.start_byte;
}

/**
 * The outer and inner selection of a bound pair, or null when the selections are not such a pair
 * (the caller then refuses two selections). Refuses a reference to a selection the ability does
 * not bind, and a reference in a lone selection.
 */
export function boundSelectionPair(selections: readonly CompileLeaf[]): { outer: CompileLeaf; inner: CompileLeaf } | null {
  if (selections.length === 1) {
    if (refersTo(selections[0]!)) throw new CompileError("A selection measured from or visible to another selection needs that selection in the ability; this ability selects one unit.");
    return null;
  }
  if (selections.length !== 2) return null;
  const [outer, inner] = selections as [CompileLeaf, CompileLeaf];
  if (!refersTo(inner) && !ownModelsAfter(outer, inner)) return null;
  const name = outer.parameters.bind_as;
  if (typeof name !== "string") throw new CompileError(refersTo(inner)
    ? "A selection measured from or visible to another needs the earlier selection bound by a name (bind_as)."
    : "A selection of this unit's own models after a unit selection needs the unit selection bound by a name (bind_as).");
  for (const reference of [inner.parameters.within_of, inner.parameters.visible_to]) {
    if (reference !== undefined && reference !== name) throw new CompileError(`The selection refers to "${String(reference)}", which this ability does not bind.`);
  }
  if (inner.parameters.bind_as === name) throw new CompileError("Two selections bind the same name.");
  return { outer, inner };
}

/**
 * Two selections that stand apart: "select one friendly X unit within 6\" of this model and one
 * enemy Y unit visible to this model", each bound by its own name, neither measured from the
 * other. The friendly unit receives what the ability gives; the enemy unit is the one the friendly
 * unit's attacks must target. The roles come from the sides, not from the order. Returns null for
 * any other pair of selections (the caller then refuses two selections); a friendly and an enemy
 * selection that share a name or count more than one unit are refused with a message.
 */
export function independentSelectionPair(selections: readonly CompileLeaf[]): { friendly: CompileLeaf; enemy: CompileLeaf } | null {
  if (selections.length !== 2 || selections.some(refersTo)) return null;
  const friendly = selections.filter((leaf) => leaf.parameters.scope === "friendly");
  const enemy = selections.filter((leaf) => leaf.parameters.scope === "enemy");
  if (friendly.length !== 1 || enemy.length !== 1) return null;
  const pair = { friendly: friendly[0]!, enemy: enemy[0]! };
  for (const leaf of selections) {
    if (leaf.parameters.target_kind === "model") throw new CompileError("An independent pair of selections selects units; a model selection beside a unit selection has no reading yet.");
    if (leaf.parameters.quantity !== undefined || leaf.parameters.count !== undefined || leaf.parameters.up_to !== undefined || leaf.parameters.at_least !== undefined) throw new CompileError("An independent pair of selections takes one unit each; a selection with its own count has no reading yet.");
  }
  const names = [pair.friendly.parameters.bind_as, pair.enemy.parameters.bind_as];
  // Selections that bind no names are not an independent pair: the caller's two-selections refusal stands.
  if (names.some((name) => typeof name !== "string")) return null;
  if (names[0] === names[1]) throw new CompileError("Two selections bind the same name.");
  return pair;
}

/** The effect families that can take the friendly unit of an independent pair as their recipient. */
const FRIENDLY_RECIPIENT_FAMILIES = new Set(["weapon-ability-grant", "weapon-property-scope", "attack", "characteristic-modifier", "roll-modifier"]);
const POSITIONAL_REFERENCES = new Set(["antecedent", "that-unit", "selected-unit"]);

/**
 * Why an ability with an independent pair of selections cannot be lowered, or null. The pair
 * lowers to a designation of the enemy unit whose "applies" gives the friendly unit what the
 * ability grants against it, so it needs the leaf saying the attacks target the enemy unit
 * (target-is-selected, with no parameters of its own), and every effect that names "that unit" must be one
 * of the grants or attack scopes that bind to the friendly unit. Parts, a for-each loop, a count and a
 * persistent designation have no reading beside the pair.
 */
export function independentPairRefusal(leaves: readonly CompileLeaf[], context: { parts: boolean; forEach: boolean; count: boolean }): string | null {
  if (context.parts) return "An independent pair of selections with parts has no reading yet.";
  if (context.forEach) return "An independent pair of selections beside a for-each loop has no reading yet.";
  if (context.count) return "An independent pair of selections beside a count by battle size or battle round has no reading yet.";
  if (leaves.some((leaf) => leaf.family_id === "persistent-designation-open")) return "An independent pair of selections beside a persistent designation has no reading yet.";
  const targets = leaves.filter((leaf) => leaf.family_id === "target-is-selected");
  if (targets.length === 0) return "An independent pair of selections needs a target-is-selected leaf saying the friendly unit's attacks target the enemy unit.";
  if (targets.some((leaf) => Object.keys(leaf.parameters).length > 0)) return "An independent pair of selections takes a target-is-selected leaf with no parameters; its enemy unit is the second selection.";
  const consumers = leaves.filter((leaf) => (leaf.role === "EFFECT" || leaf.family_id === "attack")
    && Object.values(leaf.parameters).some((value) => typeof value === "string" && POSITIONAL_REFERENCES.has(value)));
  if (consumers.some((leaf) => !FRIENDLY_RECIPIENT_FAMILIES.has(leaf.family_id))) {
    return "An independent pair binds only attack grants to the friendly unit and attacks that target the enemy unit.";
  }
  return null;
}
