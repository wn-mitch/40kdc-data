import { type FamilyExtension, optional, properties, withProperties } from "./family-extension-helpers.js";
import { FOLLOWING_FILTER } from "./family-extensions-11.js";
import { enumValue } from "./family-validation.js";

/**
 * Wave-10 weapon-qualified attack references: a hit-by-attacks leaf can name the unit hit by the
 * unit-filter before it (in the before-form "those attacks made with its Doomweaver scored a hit
 * against an enemy unit"), and unit-activity can say which attacks destroyed (in "If this unit's
 * melee attacks destroyed an enemy unit this phase"). Both keep every earlier leaf unchanged.
 */

/** Destroyed-enemy-unit activities that an attack type can qualify. */
const DESTROY_ACTIVITIES = ["destroyed-enemy-unit-this-phase", "destroyed-enemy-unit-this-turn"];
const ATTACK_TYPES = ["melee", "ranged", "psychic"];

export const FAMILY_EXTENSIONS_16_WEAPON_QUALIFIED_ATTACK_REFERENCE: readonly FamilyExtension[] = [
  {
    // "scored a hit against an enemy unit" (object) in place of "was hit by … units" (subject).
    family: "hit-by-attacks",
    description: "As the previous version, but subject is optional: object following-filter names the unit hit as the unit-filter right after this leaf (\"those attacks made with its Doomweaver scored a hit against an enemy unit\"). It takes no by, and not with subject.",
    schema: (previous) => {
      const { required: _required, ...rest } = previous;
      return withProperties({ ...rest, required: [] }, {
        subject: optional(properties(previous).subject!),
        object: optional({ enum: [FOLLOWING_FILTER] }),
      });
    },
    normalize: (input, previous) => {
      if (input.object === undefined) {
        if (input.subject === undefined) throw new TypeError("hit-by-attacks names the unit hit: subject, or object following-filter.");
        return previous(input);
      }
      const { object, ...rest } = input;
      enumValue(object, [FOLLOWING_FILTER], "hit-by-attacks.object");
      if (rest.subject !== undefined) throw new TypeError("hit-by-attacks names the unit hit by subject or by object, not both.");
      if (rest.by !== undefined) throw new TypeError("hit-by-attacks names the following unit-filter as both the unit hit and the attacks' attacker; it can be only one.");
      // The previous version checks the rest with a subject standing in; the subject is then removed.
      const { subject: _subject, ...normalized } = previous({ ...rest, subject: "this-unit" });
      return { ...normalized, object: FOLLOWING_FILTER };
    },
  },
  {
    // "If this unit's melee attacks destroyed an enemy unit this phase".
    family: "unit-activity",
    description: "As the previous version, plus attack_type (melee, ranged or psychic) on one destroyed-enemy-unit activity this phase or turn: the destroying attacks are of that type. It qualifies no other activity, nor a list of several.",
    schema: (previous) => withProperties(previous, { attack_type: optional({ enum: ATTACK_TYPES }) }),
    normalize: (input, previous) => {
      if (input.attack_type === undefined) return previous(input);
      const { attack_type: attackType, ...rest } = input;
      const listed = Array.isArray(rest.activities) ? rest.activities as unknown[] : [];
      if (listed.length !== 1 || !DESTROY_ACTIVITIES.includes(String(listed[0]))) {
        throw new TypeError("unit-activity.attack_type qualifies only a destroyed-enemy-unit activity on its own.");
      }
      const normalized = previous(rest);
      return { ...normalized, attack_type: enumValue(attackType, ATTACK_TYPES, "unit-activity.attack_type") };
    },
  },
];
