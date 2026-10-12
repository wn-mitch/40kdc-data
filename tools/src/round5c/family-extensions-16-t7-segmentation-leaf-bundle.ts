import { DESTRUCTION_ACTIVITIES } from "./family-extensions-17-triggering-destruction.js";
import { KEYWORD_ITEMS, keywordList, optional, type FamilyExtension, withProperties } from "./family-extension-helpers.js";

/**
 * Segmentation-leaf bundle (T7). Two versions:
 *
 * event: object_keywords on model-destroyed. "When this unit destroys a **Character** model" names
 * the destroyed model's keywords after the event; with object_owner it lowers to the trigger's
 * object `{owner, all_of, level: model}`. The keywords need the owner, so the object is whole.
 *
 * unit-activity: keywords on destroyed-models-by-triggering-attacks ("destroyed an enemy Character
 * model"), and both destruction activities on one leaf ("destroyed an enemy unit or an enemy
 * Character model"): one verb, one unit-filter after it, each activity keeps its own object. The
 * keywords belong to the models activity only. Lowering: compile-triggering-destruction.ts.
 */

const UNITS = "destroyed-units-by-triggering-attacks";
const MODELS = "destroyed-models-by-triggering-attacks";

const EVENT_OBJECT_KEYWORDS: FamilyExtension = {
  family: "event",
  description: "As the previous version, plus object_keywords on model-destroyed: the destroyed model carries these unit keywords (needs object_owner, whose model it was).",
  schema: (previous) => withProperties(previous, {
    object_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { kind: ["model-destroyed"] } }),
  }),
  normalize: (input, previous) => {
    if (!("object_keywords" in input)) return previous(input);
    if (input.kind !== "model-destroyed") throw new TypeError("event.object_keywords applies only to model-destroyed.");
    if (input.object_owner === undefined) throw new TypeError("event.object_keywords needs object_owner: whose model was destroyed.");
    const { object_keywords: keywords, ...rest } = input;
    return { ...previous(rest), object_keywords: keywordList(keywords, "event.object_keywords", 1) };
  },
};

const UNIT_ACTIVITY_KEYWORDS: FamilyExtension = {
  family: "unit-activity",
  description: "As the previous version, plus keywords on destroyed-models-by-triggering-attacks (the destroyed models' unit keywords), and both destruction activities on one leaf (a destroyed unit or a destroyed model, one verb and one unit-filter after it).",
  schema: (previous) => withProperties(previous, {
    keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true }),
  }),
  normalize: (input, previous) => {
    const { keywords, ...rest } = input;
    const listed = Array.isArray(rest.activities) ? rest.activities as unknown[] : [];
    const destruction = listed.filter((activity) => (DESTRUCTION_ACTIVITIES as readonly unknown[]).includes(activity));
    if (keywords !== undefined && (!listed.includes(MODELS) || destruction.length !== listed.length)) {
      throw new TypeError("unit-activity keywords belong to destroyed-models-by-triggering-attacks.");
    }
    const checkedKeywords = keywords === undefined ? {} : { keywords: keywordList(keywords, "unit-activity keywords", 1) };
    if (destruction.length !== 2) return { ...previous(rest), ...checkedKeywords };
    if (listed.length !== 2 || new Set(listed).size !== 2) throw new TypeError("unit-activity names both destruction activities once each, and nothing else.");
    // The previous version checks one destruction activity; the pair is restored after it.
    const { activities: _activities, ...shared } = rest;
    const checked = previous({ ...shared, activities: [MODELS] });
    return { ...checked, activities: [...DESTRUCTION_ACTIVITIES], ...checkedKeywords };
  },
};

export const FAMILY_EXTENSIONS_16_T7_SEGMENTATION_LEAF_BUNDLE: readonly FamilyExtension[] = [EVENT_OBJECT_KEYWORDS, UNIT_ACTIVITY_KEYWORDS];
