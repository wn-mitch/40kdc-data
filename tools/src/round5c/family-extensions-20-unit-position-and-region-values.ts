import { type FamilyExtension, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** The middle of the battlefield: a place a distance can be measured from. */
export const BATTLEFIELD_CENTRE = "battlefield-centre";
/** The unit the moment's event acted on, as the subject of a position ("the unit that was targeted"). */
export const EVENT_OBJECT = "event-object";

const PLACE_REFUSED = ["range_ref", "distance", "weapon_range", "models"] as const;

/**
 * unit-position, widened for place values: a distance measured from the centre of the battlefield
 * (`of: battlefield-centre`), a within (and wholly within) distance of the enemy deployment zone
 * (`of: enemy-deployment-zone` with `kind: within`; `kind: beyond` keeps its set-up restriction
 * rule), and the unit an event acted on as the subject (`subject: event-object`).
 *
 * The three values can share one leaf, so one function checks every refusal on the input as
 * authored, then makes one call of the previous version with a stand-in for each new value and
 * writes the authored values back.
 */
export const FAMILY_EXTENSIONS_20_UNIT_POSITION_AND_REGION_VALUES: readonly FamilyExtension[] = [
  {
    family: "unit-position",
    description: "As the previous version, plus of battlefield-centre (a within or beyond distance from the centre of the battlefield, whole inches), of enemy-deployment-zone with kind within (the unit is within, or with wholly wholly within, the distance of the enemy deployment zone), and subject event-object (the unit the moment's event acted on; not with closest-eligible).",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", [BATTLEFIELD_CENTRE]),
      subject: widenedEnum(previous, "subject", [EVENT_OBJECT]),
    }),
    normalize: (input, previous) => {
      const centre = input.of === BATTLEFIELD_CENTRE;
      const zoneWithin = input.of === "enemy-deployment-zone" && input.kind === "within";
      const objectSubject = input.subject === EVENT_OBJECT;
      if (!centre && !zoneWithin && !objectSubject) return previous(input);
      if (objectSubject && input.kind === "closest-eligible") throw new TypeError("unit-position subject event-object takes within, beyond or objective-range, not closest-eligible.");
      if (centre || zoneWithin) {
        if (input.kind !== "within" && input.kind !== "beyond") throw new TypeError(`unit-position of ${String(input.of)} measures a within or beyond distance.`);
        const refused = PLACE_REFUSED.find((key) => input[key] !== undefined);
        if (refused) throw new TypeError(`unit-position of ${String(input.of)} takes whole inches; ${refused} does not apply.`);
        if (input.objective !== undefined || input.objective_tag !== undefined || input.controlled_by !== undefined) throw new TypeError(`unit-position of ${String(input.of)} is a place, not an objective marker; objective, objective_tag and controlled_by do not apply.`);
        if (input.wholly !== undefined && input.kind !== "within") throw new TypeError(`unit-position of ${String(input.of)} is wholly within a distance, not wholly beyond it.`);
      }
      const original = { of: input.of, subject: input.subject };
      const standIns = {
        ...(centre || zoneWithin ? { of: "this-unit" } : {}),
        ...(objectSubject ? { subject: "event-subject" } : {}),
      };
      const normalized = previous({ ...input, ...standIns });
      return { ...normalized, ...(centre || zoneWithin ? { of: original.of } : {}), ...(objectSubject ? { subject: original.subject } : {}) };
    },
  },
];
