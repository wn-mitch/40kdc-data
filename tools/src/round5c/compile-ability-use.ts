import type { CompileLeaf } from "./compile-fragments.js";
import { CompileError } from "./compile-error.js";
import { condition, duration, negate } from "./compile-conditions.js";
import { dslUnitFilter } from "./compile-unit-filters.js";

type Node = Record<string, unknown>;

export function abilityUseTrigger(leaf: CompileLeaf): Node | null {
  if (leaf.family_id !== "ability-use-context") return null;
  const p = leaf.parameters;
  return { event: "used", subject: { owner: p.owner, level: p.level }, filter: { kind: "ability", ability_keyword: p.keyword }, binds_event_variable: p.bind_as };
}

export function abilityUseCondition(leaf: CompileLeaf): Node | null {
  const p = leaf.parameters;
  if (leaf.family_id === "army-state") return { type: "army-state", parameters: { owner: p.owner, state: p.state } };
  if (leaf.family_id !== "ability-use-history") return null;
  const reference = { event_var: p.event_var };
  const subject = p.actor === "same" ? reference : { owner: p.owner, level: p.level, ...(p.actor === "other" ? { excluding: reference } : {}) };
  const history = { type: "happened", parameters: { event: "used", subject, filter: { kind: "ability", ...(p.ability === "same" ? { same_rule_as: reference } : {}) }, window: p.window } };
  return p.negated === true ? negate(history) : history;
}

/** Only the original use is modified: there is no select-units wrapper or ability-activate step. */
export function abilityUseEffect(leaf: CompileLeaf): Node | null {
  if (leaf.family_id !== "ability-selection-override") return null;
  const p = leaf.parameters;
  if (p.selection === undefined || p.recipient_duration === undefined) throw new CompileError("An ability selection override needs its bound selection and recipient duration.");
  const make = (selection: unknown): Node => ({ type: "ability-modifier", target: { event_var: p.event_var }, modifier: { ability: { event: "used", event_var: p.event_var }, aspect: "selection", operation: "set", selection, recipient_duration: p.recipient_duration } });
  if (p.alternative_selection === undefined) return make(p.selection);
  const gate = p.range_condition as Node;
  return { type: "sequence", steps: [
    { type: "conditional", condition: negate(gate), effect: make(p.selection) },
    { type: "conditional", condition: gate, effect: make(p.alternative_selection) },
  ] };
}

function one(leaves: readonly CompileLeaf[], family: string): CompileLeaf {
  const found = leaves.filter((leaf) => leaf.family_id === family);
  if (found.length !== 1) throw new CompileError(`An ability selection override needs exactly one ${family} leaf.`);
  return found[0]!;
}

function checkedKeys(leaf: CompileLeaf, keys: readonly string[]): void {
  const unexpected = Object.keys(leaf.parameters).filter((key) => !keys.includes(key));
  if (unexpected.length) throw new CompileError(`Ability-use selection cannot consume ${leaf.family_id}.${unexpected.join(", ")}.`);
}

/**
 * Fold only an explicitly reviewed selection-override relationship. Selection, recipients,
 * proximity, exclusion and lifetime remain independent trusted leaves; none is inferred from
 * an ability id or source spelling. Unknown qualifiers refuse rather than disappearing.
 */
export function foldAbilityUseContext(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const overrides = leaves.filter((leaf) => leaf.family_id === "ability-selection-override");
  if (!overrides.length) return [...leaves];
  if (overrides.length !== 1) throw new CompileError("Multiple ability selection overrides need separate ability parts.");
  const override = overrides[0]!;
  if (override.parameters.selection !== undefined) return [...leaves];
  const event = one(leaves, "ability-use-context");
  const variable = event.parameters.bind_as;
  if (override.parameters.event_var !== variable) throw new CompileError("The selection override references an unbound ability use.");
  for (const history of leaves.filter((leaf) => leaf.family_id === "ability-use-history")) {
    if (history.parameters.event_var !== variable) throw new CompileError("Ability-use history references an unbound ability use.");
    if (history.parameters.actor === "same" && (history.parameters.owner !== event.parameters.owner || history.parameters.level !== event.parameters.level)) {
      throw new CompileError("Same-actor ability history must retain the triggering actor's owner and level.");
    }
  }
  const selection = one(leaves, "select-unit");
  checkedKeys(selection, ["scope", "distance", "visible", "count", "up_to"]);
  if (selection.parameters.distance !== "any" || selection.parameters.visible !== false) throw new CompileError("Contextual selection reach and visibility need separate supported qualifiers.");
  const recipients = one(leaves, "unit-filter");
  checkedKeys(recipients, ["side", "level", "keywords", "any_keywords", "excluded_keywords"]);
  if (selection.parameters.scope !== undefined && selection.parameters.scope !== recipients.parameters.side) throw new CompileError("Contextual selection ownership conflicts with its recipient filter.");
  const count = selection.parameters.count ?? 1;
  if (!Number.isSafeInteger(count) || Number(count) < 1) throw new CompileError("Contextual selection count must be a positive integer.");
  const baseFilter = dslUnitFilter(recipients);
  const exclusions = leaves.filter((leaf) => leaf.family_id === "designated-filter");
  if (exclusions.length > 1) throw new CompileError("A contextual selection has multiple designation exclusions.");
  if (exclusions.length) {
    const exclusion = exclusions[0]!;
    checkedKeys(exclusion, ["subject", "tag", "negated"]);
    if (exclusion.parameters.subject !== "selected-unit" || exclusion.parameters.negated !== true) throw new CompileError("Contextual designation exclusion must test the selected recipient negatively.");
    baseFilter.not_designated = exclusion.parameters.tag;
  }
  const reaches = leaves.filter((leaf) => leaf.family_id === "unit-position");
  if (reaches.length < 1 || reaches.length > 2) throw new CompileError("Contextual selection needs a base reach and at most one conditional replacement reach.");
  // "Instead of" states that this is the original selection's replacement, not another use.
  const replacements = leaves.filter((leaf) => leaf.family_id === "instead");
  if (replacements.length > 1) throw new CompileError("A contextual selection has more than one replacement connective.");
  for (const replacement of replacements) {
    checkedKeys(replacement, []);
    if (replacement.start_byte <= recipients.start_byte || replacement.start_byte >= reaches[0]!.start_byte) {
      throw new CompileError("A contextual replacement connective must qualify its recipient selection.");
    }
  }
  const selectors = reaches.map((reach) => {
    checkedKeys(reach, ["subject", "kind", "of", "inches", "negated", "wholly"]);
    const p = reach.parameters;
    if (p.subject !== "selected-unit" || p.kind !== "within" || p.of !== "event-subject" || p.negated === true || typeof p.inches !== "number") {
      throw new CompileError("Contextual selection reach must be within a distance of its triggering actor.");
    }
    return { filter: { ...baseFilter, within: { range: { inches: p.inches }, of: { event_var: variable }, ...(p.wholly === true ? { wholly: true } : {}) } }, count: { min: selection.parameters.up_to === true ? 0 : count, max: count } };
  });
  const gates = leaves.filter((leaf) => leaf.family_id === "army-state");
  if (gates.length !== reaches.length - 1) throw new CompileError("Each alternative contextual reach needs exactly one army-state condition.");
  const lifetime = one(leaves, "duration");
  const recipientDuration = duration(lifetime);
  const consumed = new Set([selection, recipients, ...reaches, ...gates, ...exclusions, ...replacements]);
  for (const owner of leaves.filter((leaf) => leaf.family_id === "unit-owner")) {
    checkedKeys(owner, ["owner"]);
    if (owner.end_byte === undefined || event.end_byte === undefined
      || owner.start_byte < event.start_byte || owner.end_byte > event.end_byte || owner.parameters.owner !== event.parameters.owner) {
      throw new CompileError("Contextual ability ownership must qualify the triggering actor with the same owner.");
    }
    consumed.add(owner);
  }
  const accepted = ["ability-use-context", "ability-use-history", "ability-selection-override", "optional-use", "duration"];
  for (const leaf of leaves) if (!consumed.has(leaf) && !accepted.includes(leaf.family_id)) throw new CompileError(`Unbound ${leaf.family_id} beside an ability selection override.`);
  return leaves.filter((leaf) => !consumed.has(leaf)).map((leaf) => {
    // The override lasts only for this use; the recipients' lifetime is a separate modifier field.
    if (leaf === lifetime) return { ...leaf, parameters: { endpoint: "end-of-this-use" } };
    if (leaf !== override) return leaf;
    return { ...leaf, parameters: { ...leaf.parameters, selection: selectors[0], recipient_duration: recipientDuration,
      ...(selectors.length === 2 ? { alternative_selection: selectors[1], range_condition: condition(gates[0]!) } : {}),
    } };
  });
}
