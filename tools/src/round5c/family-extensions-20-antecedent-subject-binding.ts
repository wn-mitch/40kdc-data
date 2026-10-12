import { activitiesExtension, EVENT_SUBJECT, type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Antecedent-subject binding versions. Each widens only:
 *
 * unit-filter attached_to: the Leader units attached to this unit ("that Leader unit gains the
 * Scouts ability", "models in those units have"). Lowers to a friendly filter that is a member of
 * this unit and has the Leader ability (compile-unit-filters.ts).
 *
 * weapon-property-scope subject event-subject and battle-shock-state recipient event-subject: the
 * unit a Stratagem's or ability's moment names (the enemy unit that selected its targets), where
 * the family's own enum named only the bearer, a selection or an earlier leaf's unit.
 *
 * unit-activity destroyed-stratagem-target: the subject destroyed the unit the Stratagem targets
 * ("targets the enemy unit that just destroyed your unit"). Lowers to a history condition
 * (compile-conditions.ts) and is refused outside a Stratagem whose target was just destroyed
 * (compile-triggering-destruction.ts).
 */

/** The unit-filter value naming the Leader units attached to this unit. */
export const ATTACHED_TO_THIS_UNIT = "this-unit";
/** The activity: the subject destroyed the Stratagem's target. */
export const DESTROYED_STRATAGEM_TARGET = "destroyed-stratagem-target";

/** unit-filter parameters that name units another way, so attached Leaders cannot combine with them. */
const EXCLUSIVE_WITH_ATTACHED = ["level", "among", "targets", "designated", "designated_by", "held_in", "other", "datasheets", "excluded_from", "subject", "alternatives"] as const;

const ATTACHED_LEADERS: FamilyExtension = {
  family: "unit-filter",
  description: "As the previous version, plus attached_to: this-unit, on a friendly unit-level filter. It names the Leader units attached to this unit (\"that Leader unit\", \"models in those units\"); it cannot combine with a model level, a designation, a held state, other, a matched set or alternatives.",
  schema: (previous) => withProperties(previous, { attached_to: optional({ enum: [ATTACHED_TO_THIS_UNIT] }) }),
  normalize: (input, previous) => {
    if (!("attached_to" in input)) return previous(input);
    const { attached_to: attached, ...rest } = input;
    if (attached !== ATTACHED_TO_THIS_UNIT) throw new TypeError(`unit-filter.attached_to must be ${ATTACHED_TO_THIS_UNIT}.`);
    if (rest.side !== "friendly") throw new TypeError("unit-filter.attached_to names the Leaders attached to this unit, so the filter's side must be friendly.");
    for (const key of EXCLUSIVE_WITH_ATTACHED) {
      if (key in rest) throw new TypeError(`unit-filter.attached_to names units by their attachment; ${key} is not allowed with it.`);
    }
    return { ...previous(rest), attached_to: attached };
  },
};

const SCOPE_EVENT_SUBJECT: FamilyExtension = {
  family: "weapon-property-scope",
  description: "As the previous version, plus subject event-subject: the weapons are equipped by models in the unit the record's moment names (\"weapons equipped by models in the attacking unit have\").",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
  normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

const BATTLE_SHOCK_EVENT_SUBJECT: FamilyExtension = {
  family: "battle-shock-state",
  description: "As the previous version, plus recipient event-subject: the unit the record's moment names becomes or stops being Battle-shocked.",
  schema: (previous) => withProperties(previous, { recipient: widenedEnum(previous, "recipient", [EVENT_SUBJECT]) }),
  normalize: (input, previous) => input.recipient === EVENT_SUBJECT ? standIn(input, "recipient", "this-unit", previous) : previous(input),
};

export const FAMILY_EXTENSIONS_20_ANTECEDENT_SUBJECT_BINDING: readonly FamilyExtension[] = [
  ATTACHED_LEADERS,
  SCOPE_EVENT_SUBJECT,
  BATTLE_SHOCK_EVENT_SUBJECT,
  activitiesExtension([DESTROYED_STRATAGEM_TARGET], `activity ${DESTROYED_STRATAGEM_TARGET}: the subject destroyed the unit the Stratagem targets ("targets the enemy unit that just destroyed your unit")`),
];
