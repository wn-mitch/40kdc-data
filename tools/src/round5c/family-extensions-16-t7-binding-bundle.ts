import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Tier 7 binding bundle. Three versions, each widening only:
 *
 * usage-limit: per selected-unit, a frequency counted for each unit the ability's one unit
 * selection chooses, across every bearer ("once per turn" on the selected unit, 8553). Lowers to
 * that selection's selection_limit (compile.ts), so the usage is never the ability's.
 *
 * event: attack_type on damage-allocated ("each time a ranged attack is allocated to a model").
 * Lowers to an attack-is condition on the trigger (compile-triggers.ts trigger).
 *
 * attack: target following-filter, the defender is the unit the unit-filter right after the attack
 * matches ("makes a ranged attack that targets an enemy unit ..."). Mirrors hit-by-attacks object
 * following-filter. Refused without direction makes, and with unit that-unit.
 */

const USAGE_SELECTED_UNIT = "selected-unit";
const ATTACK_TYPES_DAMAGE = ["ranged", "melee", "any"] as const;
const FOLLOWING = "following-filter";

const USAGE_PER_SELECTED_UNIT: FamilyExtension = {
  family: "usage-limit",
  description: "As the previous version, plus per selected-unit: the frequency counts for each unit the ability's one unit selection chooses, across every bearer. It lowers to that selection's selection_limit, not to the ability's usage.",
  schema: (previous) => withProperties(previous, { per: widenedEnum(previous, "per", [USAGE_SELECTED_UNIT]) }),
  normalize: (input, previous) => input.per === USAGE_SELECTED_UNIT ? standIn(input, "per", "any", previous) : previous(input),
};

const EVENT_DAMAGE_ATTACK_TYPE: FamilyExtension = {
  family: "event",
  description: "As the previous version, plus attack_type on damage-allocated: the allocated attack is ranged, melee or any. Lowers to an attack-is condition on the trigger; any adds none.",
  schema: (previous) => withProperties(previous, {
    attack_type: optional({ enum: [...ATTACK_TYPES_DAMAGE], "x-only-when": { kind: ["damage-allocated"] } }),
  }),
  normalize: (input, previous) => {
    if (!("attack_type" in input)) return previous(input);
    const { attack_type: attackType, ...rest } = input;
    if (rest.kind !== "damage-allocated") throw new TypeError("event.attack_type applies only to a damage-allocated moment.");
    if (!ATTACK_TYPES_DAMAGE.includes(attackType as typeof ATTACK_TYPES_DAMAGE[number])) throw new TypeError("event.attack_type is ranged, melee or any.");
    return { ...previous(rest), attack_type: attackType };
  },
};

const ATTACK_TARGET_FOLLOWING: FamilyExtension = {
  family: "attack",
  description: "As the previous version, plus target following-filter: the defender is any unit the unit-filter right after this attack matches (\"makes a ranged attack that targets an enemy unit\"). The same target field as that-unit; direction makes is required and unit that-unit is refused.",
  schema: (previous) => withProperties(previous, {
    target: optional({ enum: ["that-unit", FOLLOWING], "x-only-when": { direction: ["makes"] } }),
  }),
  normalize: (input, previous) => {
    if (input.target !== FOLLOWING) return previous(input);
    if (input.direction !== "makes") throw new TypeError("attack.target following-filter names the defender, so the attack's direction must be makes.");
    if (input.unit === "that-unit") throw new TypeError("attack.target following-filter cannot go with unit that-unit: one unit would both make and receive the attack.");
    return standIn(input, "target", "that-unit", previous);
  },
};

export const FAMILY_EXTENSIONS_16_T7_BINDING_BUNDLE: readonly FamilyExtension[] = [
  USAGE_PER_SELECTED_UNIT,
  EVENT_DAMAGE_ATTACK_TYPE,
  ATTACK_TARGET_FOLLOWING,
];
