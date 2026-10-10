import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 every-model position: "every model in that unit is within 3\" of this transport", "every
 * model in this unit is within range of an objective marker". `models: every` says every model of
 * the subject passes the distance test. It is not `wholly` (every part of each model), which the
 * previous version keeps, and the two never combine. The compiler lowers it to the DSL's
 * `models: "every"` (compile-every-model.ts).
 */

const SUBJECTS = ["this-unit", "antecedent"] as const;
const WITHIN_OF = ["this-unit", "following-filter"] as const;

/** Distance forms an every-model position never combines with: wholly is footprint, not every model; the others measure a range this version does not cover. */
const REFUSED_WITH_EVERY = ["wholly", "distance", "range_ref", "weapon_range"] as const;

export const FAMILY_EXTENSIONS_16_EVERY_MODEL_POSITION: readonly FamilyExtension[] = [
  {
    family: "unit-position",
    description: "As the previous version, plus models: every, meaning every model of the subject is within the distance (\"every model in that unit is within 3\\\" of this transport\") or within range of an objective marker (\"every model in this unit is within range of an objective\"). A within distance is measured from this unit or the following filter's unit; a subject is this unit or an earlier leaf's unit. It cannot combine with wholly.",
    schema: (previous) => withProperties(previous, {
      models: optional({ enum: ["every"], "x-only-when": { kind: ["within", "objective-range"] } }),
    }),
    normalize: (input, previous) => {
      if (!("models" in input)) return previous(input);
      const { models, ...rest } = input;
      if (models !== "every") throw new TypeError(`unit-position.models is "every" or absent; got ${JSON.stringify(models)}.`);
      if (rest.negated !== false) throw new TypeError("unit-position.models every describes a position that holds, so negated is false.");
      if (!(SUBJECTS as readonly unknown[]).includes(rest.subject)) throw new TypeError(`unit-position.models every takes subject ${SUBJECTS.join(" or ")}.`);
      if (rest.kind === "within") {
        if (!(WITHIN_OF as readonly unknown[]).includes(rest.of)) throw new TypeError(`unit-position.models every measures within a distance to ${WITHIN_OF.join(" or ")}.`);
      } else if (rest.kind === "objective-range") {
        if ("of" in rest) throw new TypeError("unit-position.models every on objective-range takes no of.");
      } else {
        throw new TypeError("unit-position.models every describes a within distance or an objective-range.");
      }
      const refused = REFUSED_WITH_EVERY.filter((key) => key in rest);
      if (refused.length) throw new TypeError(`unit-position.models every cannot combine with ${refused[0]}.`);
      return { ...previous(rest), models: "every" };
    },
  },
];
