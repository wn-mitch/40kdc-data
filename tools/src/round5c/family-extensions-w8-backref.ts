import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/** The attack types a back-reference can print ("those ranged attacks"); "any" is the antecedent's own. */
const PRINTED_TYPES = ["melee", "ranged", "psychic"];

/**
 * Wave 8, those-attacks-backref: an attack leaf can point back to an earlier attack of its record
 * ("that attack", "such an attack", "the target of that attack") or name the unit an earlier leaf
 * introduced as the attack's target ("an X unit … targets that unit"). The compiler resolves both
 * (compile-attack-backref.ts).
 */
export const FAMILY_EXTENSIONS_W8_BACKREF: readonly FamilyExtension[] = [
  {
    family: "attack",
    description: "As the previous version, plus refers earlier-attack: \"that attack\", \"those attacks\", \"such an attack\", \"the target of that attack\" name the attack an earlier attack leaf of the record introduced; who makes it and which way come from that leaf, so the leaf records only the back-reference (and attack_type when the anaphor prints one, \"those ranged attacks\"). Plus target that-unit on direction makes: the attack targets a unit an earlier leaf introduced (\"an X unit … targets that unit\"), a designation's unit or else the selected unit.",
    // A back-reference leaves direction, unit and attack_type out, so none is required by the
    // schema; normalize still requires all three on a leaf without refers.
    schema: (previous) => ({
      ...withProperties(previous, {
        refers: optional({ const: "earlier-attack" }),
        target: optional({ const: "that-unit", "x-only-when": { direction: ["makes"] } }),
      }),
      required: [],
    }),
    normalize: (input, previous) => {
      if (input.refers !== undefined) {
        if (input.refers !== "earlier-attack") throw new TypeError("attack.refers must be earlier-attack.");
        const extra = Object.keys(input).filter((key) => key !== "refers" && key !== "attack_type");
        // Who attacks and which way are the earlier attack's; a back-reference that also names them borrows wording from outside its span.
        if (extra.length) throw new TypeError(`attack with refers takes only attack_type besides it; drop ${extra.join(", ")}: the earlier attack already says them.`);
        if (input.attack_type === undefined) return { refers: "earlier-attack" };
        if (!PRINTED_TYPES.includes(String(input.attack_type))) throw new TypeError("attack with refers prints only melee, ranged or psychic as its attack_type; leave it out otherwise.");
        return { refers: "earlier-attack", attack_type: input.attack_type };
      }
      for (const key of ["direction", "unit", "attack_type"]) {
        if (input[key] === undefined) throw new TypeError(`attack.${key} is required unless the leaf refers to an earlier attack.`);
      }
      if (input.target === undefined) return previous(input);
      const { target, ...rest } = input;
      if (target !== "that-unit") throw new TypeError("attack.target must be that-unit.");
      if (rest.direction !== "makes") throw new TypeError("attack.target names what the attack targets, so the attack's direction must be makes.");
      if (rest.unit === "that-unit") throw new TypeError("attack.target that-unit cannot go with unit that-unit: one unit would both make and receive the attack.");
      return { ...previous(rest), target };
    },
  },
];
