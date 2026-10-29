import type { FamilyExtension } from "../family-extension-helpers.js";
import { optional, widenedEnum, withProperties } from "../family-extension-helpers.js";

/** An ability record id, as the DSL's entity-id writes it. */
const ABILITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

/**
 * "That unit cannot be selected when selecting units as part of the Noospheric Transference
 * Detachment rule": a selection by one named ability, not an attack or a Stratagem. kind ability
 * says so; ability names the rule by its record id. Like stratagem, a named ability needs the
 * target form (the unit being selected).
 */
export const TARGETING_ABILITY_EXTENSIONS: readonly FamilyExtension[] = [
  {
    family: "targeting-restriction",
    version: 5,
    description: "As the previous version, plus kind ability (a selection by an ability, not an attack or a Stratagem) and ability: the one ability's record id whose selection this limits (\"that unit cannot be selected as part of the Noospheric Transference Detachment rule\"). ability needs kind ability and the target form.",
    schema: (previous) => withProperties(previous, {
      kind: widenedEnum(previous, "kind", ["ability"]),
      ability: optional({ type: "string", pattern: ABILITY_ID.source, "x-only-when": { kind: ["ability"] } }),
    }),
    normalize: (input, previous) => {
      if (input.kind !== "ability") {
        if ("ability" in input) throw new TypeError("targeting-restriction.ability names the ability of kind ability only.");
        return previous(input);
      }
      const { ability, ...rest } = input;
      if ("stratagem" in input || "except" in input) throw new TypeError("targeting-restriction of kind ability names no Stratagem.");
      // The previous version checks the rest with a kind it knows standing in.
      const normalized = { ...previous({ ...rest, kind: "stratagem" }), kind: "ability" };
      if (ability === undefined) return normalized;
      if (!("target" in input)) throw new TypeError("targeting-restriction.ability needs target: the unit the ability would select.");
      if (typeof ability !== "string" || !ABILITY_ID.test(ability)) throw new TypeError("targeting-restriction.ability is the ability's kebab-case record id.");
      return { ...normalized, ability };
    },
  },
];
