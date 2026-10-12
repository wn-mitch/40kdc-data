import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** The subject value a unit-filter folds onto a leaf (compile-antecedent.ts FILTERED_UNITS). */
const FILTERED_UNITS = "filtered-units";

/** The Transports a unit-filter's embarked units can be embarked within: the leaf's own unit or model. */
export const EMBARKED_IN = ["this-unit", "this-model"] as const;

/** unit-filter keys that name a different set of units; none combines with embarked_in. */
const EMBARKED_IN_EXCLUDES = ["held_in", "alternatives", "among", "subject", "datasheets", "designated", "designated_by"] as const;

/** The disembark modes the DSL names; the move's modifier carries one as `mode`. */
export const DISEMBARK_MODES = ["rapid", "tactical", "combat", "emergency", "assault"] as const;

/**
 * Wave-10 embarked units as a subject and as a state's subject. Each version checks only its own
 * additions and hands the rest of a leaf to the previous version (see family-extensions.ts).
 */
export const FAMILY_EXTENSIONS_20_EMBARKED_UNITS_STATE_SUBJECT_AND_MOVES: readonly FamilyExtension[] = [
  {
    // "units embarked within this unit": the units a Transport (this unit or this model) carries.
    family: "unit-filter",
    description: "As the previous version, plus embarked_in: the units (or models) embarked within this unit or this model (\"units embarked within this unit\"). Always friendly; it takes no held_in, alternatives, among, subject, datasheets or designation.",
    schema: (previous) => withProperties(previous, { embarked_in: optional({ enum: [...EMBARKED_IN] }) }),
    normalize: (input, previous) => {
      if (!("embarked_in" in input) || input.embarked_in === undefined) return previous(input);
      const { embarked_in: embarked, ...rest } = input;
      if (!(EMBARKED_IN as readonly unknown[]).includes(embarked)) throw new TypeError(`unit-filter.embarked_in is this-unit or this-model, not ${JSON.stringify(embarked)}.`);
      if (rest.side !== "friendly") throw new TypeError("unit-filter.embarked_in names friendly units: embarked units are always the Transport's own army's.");
      for (const key of EMBARKED_IN_EXCLUDES) {
        if (rest[key] !== undefined) throw new TypeError(`unit-filter.embarked_in cannot be combined with ${key}.`);
      }
      return { ...previous(rest), embarked_in: embarked };
    },
  },
  {
    // "units embarked within this unit can make an assault disembark move": the filter's units move, in a named mode.
    family: "make-move",
    description: "As the previous version, plus subject filtered-units (the units a unit-filter names right before the move) and mode: the disembark mode the move uses (rapid, tactical, combat, emergency, assault). Mode needs move_type disembark.",
    schema: (previous) => withProperties(previous, {
      subject: widenedEnum(previous, "subject", [FILTERED_UNITS]),
      mode: optional({ enum: [...DISEMBARK_MODES], "x-only-when": { move_type: ["disembark"] } }),
    }),
    normalize: (input, previous) => {
      const { mode, ...rest } = input;
      if (mode !== undefined) {
        if (rest.move_type !== "disembark") throw new TypeError("make-move.mode names a disembark mode, so it needs move_type disembark.");
        if (!(DISEMBARK_MODES as readonly unknown[]).includes(mode)) throw new TypeError(`make-move.mode is one of ${DISEMBARK_MODES.join(", ")}, not ${JSON.stringify(mode)}.`);
      }
      const normalized = rest.subject === FILTERED_UNITS ? standIn(rest, "subject", "this-unit", previous) : previous(rest);
      return mode === undefined ? normalized : { ...normalized, mode };
    },
  },
  {
    // "units cannot embark within this unit": every unit the filter names loses the embark permission.
    family: "eligibility-permission",
    description: "As the previous version, plus subject filtered-units: the units a unit-filter names right before the permission (\"units cannot embark within this unit\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => input.subject === FILTERED_UNITS ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    // "While a Big Mek model is embarked within this unit": a unit-filter's units embarked within a named Transport.
    family: "unit-state",
    description: "As the previous version, plus embarked with a Transport: the units a unit-filter right before the leaf names (subject antecedent) are embarked within this unit or this model (with). It takes no at, no other state; negated reads \"no such unit is embarked\".",
    schema: (previous) => {
      const withSchema = (previous.properties as Record<string, Record<string, unknown>>).with!;
      const only = (withSchema["x-only-when"] ?? {}) as Record<string, string[]>;
      return withProperties(previous, { with: { ...withSchema, "x-only-when": { ...only, states: [...new Set([...(only.states ?? []), "embarked"])] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (!(states.length === 1 && states[0] === "embarked") || input.with === undefined) return previous(input);
      if (!(EMBARKED_IN as readonly unknown[]).includes(input.with)) throw new TypeError(`unit-state embarked names the Transport with this-unit or this-model, not ${JSON.stringify(input.with)}.`);
      // Any other subject keeps the previous version's refusal of a with on the embarked state.
      if (input.subject !== "antecedent") return previous(input);
      if (input.at !== undefined) throw new TypeError("unit-state embarked has no earlier point (at).");
      const { with: transport, ...rest } = input;
      // The previous version takes an embarked state of this-unit with no with; the subject and with are put back.
      return { ...previous({ ...rest, subject: "this-unit" }), subject: "antecedent", with: transport };
    },
  },
];
