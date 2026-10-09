import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, properties, type Schema, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** The Stratagem id shape every entity id uses (kebab-case, as the core records name them). */
const STRATAGEM_ID = { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" };

/** The unit-activity that says a unit was targeted with the Stratagems named in stratagem_ids this phase. */
export const TARGETED_WITH_STRATAGEM = "targeted-with-stratagem-this-phase";

/**
 * Wave-10 opponent Stratagem targeting. A targets-selected moment can name the unit it was done to
 * as the antecedent of an earlier leaf ("chosen by a Gadget", "picked for a Gadget") and an owner
 * of any player (owner any). The unit-activity version adds "not chosen by these Gadgets this
 * phase", for restrictions that name other Gadgets.
 */
export const FAMILY_EXTENSIONS_16_OPPONENT_STRATAGEM_TARGET_EVENT: readonly FamilyExtension[] = [
  {
    // "chosen by a Gadget", "picked for a Gadget": the unit as the moment's object.
    family: "event",
    description: "As the previous version, plus, for targets-selected only: object antecedent (the unit an earlier leaf named is the one selected as the target), and owner any (any player's unit, for wording that names no owner).",
    schema: (previous) => withProperties(previous, {
      object: widenedEnum(previous, "object", [ANTECEDENT]),
      owner: widenedEnum(previous, "owner", ["any"]),
    }),
    normalize: (input, previous) => {
      const antecedent = input.object === ANTECEDENT;
      const any = input.owner === "any";
      if (!antecedent && !any) return previous(input);
      if (input.kind !== "targets-selected") throw new TypeError("event.object antecedent and event.owner any describe a targets-selected only.");
      // Each new value is checked as the value the previous version knows, then put back.
      const staged = { ...input, ...(antecedent ? { object: "this-unit" } : {}), ...(any ? { owner: "friendly" } : {}) };
      const normalized = previous(staged);
      return { ...normalized, ...(antecedent ? { object: ANTECEDENT } : {}), ...(any ? { owner: "any" } : {}) };
    },
  },
  {
    // "not chosen by the Alpha Gadget or Beta Gadget this phase": one leaf naming the Gadgets.
    family: "unit-activity",
    description: "As the previous version, plus activity targeted-with-stratagem-this-phase with stratagem_ids (one or more Stratagems that targeted the unit this phase, any player's): the leaf names that activity alone, and its stratagem_ids name the Stratagems.",
    schema: (previous) => {
      const activities = properties(previous).activities!;
      const items = activities.items as Schema;
      return withProperties(previous, {
        activities: { ...activities, items: { ...items, enum: [...(items.enum as string[]), TARGETED_WITH_STRATAGEM] } },
        stratagem_ids: optional({ type: "array", items: STRATAGEM_ID, minItems: 1, uniqueItems: true }),
      });
    },
    normalize: (input, previous) => {
      const listed = Array.isArray(input.activities) ? input.activities as unknown[] : [];
      const named = listed.includes(TARGETED_WITH_STRATAGEM);
      if (!named) {
        if ("stratagem_ids" in input) throw new TypeError(`unit-activity.stratagem_ids applies only to ${TARGETED_WITH_STRATAGEM}.`);
        return previous(input);
      }
      if (listed.length !== 1) throw new TypeError(`unit-activity ${TARGETED_WITH_STRATAGEM} is not mixed with another activity in one leaf.`);
      if (!Array.isArray(input.stratagem_ids) || input.stratagem_ids.length === 0) throw new TypeError(`unit-activity ${TARGETED_WITH_STRATAGEM} names its Stratagems in stratagem_ids.`);
      const ids = input.stratagem_ids.map((id) => {
        if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/u.test(id)) throw new TypeError("unit-activity.stratagem_ids lists Stratagem ids (kebab-case).");
        return id;
      });
      if (new Set(ids).size !== ids.length) throw new TypeError("unit-activity.stratagem_ids lists a Stratagem twice.");
      const { stratagem_ids: _ids, ...rest } = input;
      // The previous version checks the rest of the leaf with one activity it knows standing in.
      const normalized = previous({ ...rest, activities: ["remained-stationary"] });
      return { ...normalized, activities: [TARGETED_WITH_STRATAGEM], stratagem_ids: [...ids].sort() };
    },
  },
];
