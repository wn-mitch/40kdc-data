import { DESIGNATION_IDS, refuseListBuildingTag } from "../translate/designations.js";
import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, properties, type Schema, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/** What a resource-spent moment can be done for: the same activities a used moment names. */
export const SPEND_ACTIVITIES = ["stratagem", "ability", "action", "manoeuvre", "order", "ritual", "dark-pact", "act-of-faith", "doctrine", "contract"] as const;
/** The unit a spend serves: this unit, or the unit an earlier leaf named. */
export const SPEND_OBJECTS = ["this-unit", ANTECEDENT] as const;

const SPEND_KINDS = ["resource-spent"] as const;

/** The kinds a key already applies to, plus resource-spent. */
function widenedKinds(schema: Schema): string[] {
  const kinds = ((schema["x-only-when"] as { kind: string[] }).kind);
  return kinds.includes("resource-spent") ? kinds : [...kinds, ...SPEND_KINDS];
}

/**
 * Purpose-qualified spends: "when you spend 1 Foo token to Empower a friendly unit", "spend a Bar
 * token to enable this unit to perform a Baz Manoeuvre". A resource-spent moment can name what the
 * spend was for: activity (an activity the spend enables) or tag (a designation the spend applies),
 * not both, and object (the unit it serves). Lowered to the trigger's filter.kind, filter.tag and
 * object (compile-triggers.ts).
 */
export const FAMILY_EXTENSIONS_20_RESOURCE_SPEND_GAIN_QUALIFIERS: readonly FamilyExtension[] = [
  {
    family: "event",
    description: "As the previous version, plus, for resource-spent only: activity (the activity the spend enables, e.g. a manoeuvre) or tag (the designation the spend applies, e.g. empowered), not both, and object (this-unit, or antecedent: the unit an earlier leaf named) for the unit the spend serves.",
    schema: (previous) => {
      const props = properties(previous);
      return withProperties(previous, {
        // Optional for the samplers: a resource-spent names at most one of them, and a used or designation moment still refuses it absent.
        activity: optional({ ...props.activity!, "x-only-when": { kind: widenedKinds(props.activity!) } }),
        tag: optional({ ...props.tag!, "x-only-when": { kind: widenedKinds(props.tag!) } }),
        object: { ...props.object!, "x-only-when": { kind: widenedKinds(props.object!) } },
      });
    },
    normalize: (input, previous) => {
      const { activity, tag, object, ...rest } = input;
      const named = activity !== undefined || tag !== undefined || object !== undefined;
      // Another kind keeps the previous version's rules for these keys.
      if (input.kind !== "resource-spent" || !named) return previous(input);
      if (activity !== undefined && tag !== undefined) throw new TypeError("event resource-spent names what the spend is for by activity or by tag, not both.");
      const canonical = previous(rest);
      return {
        ...canonical,
        ...(activity !== undefined ? { activity: enumValue(activity, SPEND_ACTIVITIES, "event.activity") } : {}),
        ...(tag !== undefined ? { tag: spendTag(tag) } : {}),
        ...(object !== undefined ? { object: enumValue(object, SPEND_OBJECTS, "event.object") } : {}),
      };
    },
  },
];

function spendTag(tag: unknown): string {
  if (typeof tag !== "string" || !DESIGNATION_IDS.has(tag)) throw new TypeError("event.tag on a resource-spent must be a registered designation id.");
  refuseListBuildingTag(tag, "event.tag");
  return tag;
}
