import { type FamilyExtension, properties, standIn, widenedEnum, withProperties, optional } from "./family-extension-helpers.js";

/**
 * Wave-10 embarked-transport shapes. A unit is embarked within a Transport (a unit state), and
 * the Transport the bearer is embarked within (`bearer-transport`) becomes a subject that the
 * effect and condition families accept. The Transport is only ever the bearer's own: a Stratagem
 * has no bearer, so compile-antecedent.ts refuses it there.
 */
const BEARER_TRANSPORT = "bearer-transport";

/** A family whose subject gains bearer-transport; the previous version checks the rest with this-unit standing in. */
function bearerTransportSubject(family: string, description: string): FamilyExtension {
  return {
    family,
    description,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [BEARER_TRANSPORT]) }),
    normalize: (input, previous) => input.subject === BEARER_TRANSPORT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  };
}

const UNIT_STATE_EMBARKED: FamilyExtension = {
  // The subject is embarked within some Transport.
  family: "unit-state",
  description: "As the previous version, plus embarked: the subject (this unit, this model or target) is embarked within a Transport. Embarked takes no with, no at, and no other state in the same list.",
  schema: (previous) => {
    const property = properties(previous).states!;
    const items = property.items as Record<string, unknown>;
    return withProperties(previous, { states: { ...property, items: { ...items, enum: [...(items.enum as string[]), "embarked"] } } });
  },
  normalize: (input, previous) => {
    const states = Array.isArray(input.states) ? input.states as unknown[] : [];
    if (!states.includes("embarked")) return previous(input);
    if (states.length !== 1) throw new TypeError("unit-state embarked cannot be listed with other states.");
    if (input.with !== undefined) throw new TypeError("unit-state embarked takes no with.");
    if (input.at !== undefined) throw new TypeError("unit-state embarked has no earlier point (at).");
    if (!["this-unit", "this-model", "target"].includes(String(input.subject))) {
      throw new TypeError(`unit-state embarked is about this-unit, this-model or target, not ${String(input.subject)}.`);
    }
    // The previous version has no embarked state; it checks the subject with on-battlefield standing in
    // (a this-model subject is refused for every other state).
    return standIn(input, "states", ["on-battlefield"], previous);
  },
};

const CORE_ABILITY_GRANT_BEARER = bearerTransportSubject(
  "core-ability-grant",
  "As the previous version, plus subject bearer-transport: the Transport the unit with the ability is embarked within, granted a valued ability.",
);

const CHARACTERISTIC_MODIFIER_BEARER = bearerTransportSubject(
  "characteristic-modifier",
  "As the previous version, plus subject bearer-transport: the Transport the model is embarked within.",
);

const INVULNERABLE_SAVE_BEARER = bearerTransportSubject(
  "invulnerable-save",
  "As the previous version, plus subject bearer-transport: the Transport the model is embarked within.",
);

const UNIT_KEYWORD_BEARER = bearerTransportSubject(
  "unit-keyword",
  "As the previous version, plus subject bearer-transport: the Transport the unit is embarked within, as a keyword condition.",
);

const UNIT_POSITION_BEARER: FamilyExtension = {
  // A Transport the unit is embarked within is within range of an objective marker: an objective range only.
  family: "unit-position",
  description: "As the previous version, plus subject bearer-transport, for kind objective-range only: the Transport the unit is embarked within is within range of an objective marker.",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [BEARER_TRANSPORT]) }),
  normalize: (input, previous) => {
    if (input.subject !== BEARER_TRANSPORT) return previous(input);
    if (input.kind !== "objective-range") throw new TypeError("unit-position subject bearer-transport is only for kind objective-range.");
    return standIn(input, "subject", "this-unit", previous);
  },
};

const SELECT_UNIT_WITHIN_ORIGIN: FamilyExtension = {
  // A selection whose distance is measured from the Transport the bearer is embarked within.
  family: "select-unit",
  description: "As the previous version, plus within_origin bearer-transport: a distance (distance within) is measured from the Transport the bearer is embarked within, not from the bearer. Needs inches; not with within_of.",
  schema: (previous) => withProperties(previous, {
    within_origin: optional({ enum: [BEARER_TRANSPORT], "x-only-when": { distance: ["within"] } }),
  }),
  normalize: (input, previous) => {
    if (!("within_origin" in input)) return previous(input);
    const { within_origin: origin, ...rest } = input;
    if (origin !== BEARER_TRANSPORT) throw new TypeError(`select-unit.within_origin is bearer-transport, not ${String(origin)}.`);
    if (rest.distance !== "within") throw new TypeError("select-unit.within_origin measures a distance, so it needs distance within.");
    if (rest.inches === undefined) throw new TypeError("select-unit.within_origin needs inches.");
    if (rest.within_of !== undefined) throw new TypeError("select-unit.within_origin and within_of name two origins; give one.");
    return { ...previous(rest), within_origin: BEARER_TRANSPORT };
  },
};

/** Unit-state embarked, and bearer-transport as a subject of the effect, condition and select-unit families. */
export const FAMILY_EXTENSIONS_16_EMBARKED_TRANSPORT: readonly FamilyExtension[] = [
  UNIT_STATE_EMBARKED,
  CORE_ABILITY_GRANT_BEARER,
  CHARACTERISTIC_MODIFIER_BEARER,
  INVULNERABLE_SAVE_BEARER,
  UNIT_KEYWORD_BEARER,
  UNIT_POSITION_BEARER,
  SELECT_UNIT_WITHIN_ORIGIN,
];
