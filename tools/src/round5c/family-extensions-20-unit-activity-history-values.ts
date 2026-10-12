import { activitiesExtension, type FamilyExtension, optional, properties, type Schema, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 unit-activity history values. Two versions:
 *
 * 1. Four subject-bearing activities: `lost-wounds-to-triggering-attacks` ("lost a wound as a result
 *    of those attacks"), `was-charged-this-turn` ("was charged this turn"),
 *    `suffered-mortal-wounds-from-this-ability` and `lost-models-to-own-mortal-wounds` ("as a result
 *    of this ability"). Lowered from the HISTORY table in compile-conditions.ts.
 * 2. `destroyed-units-in-window` ("an enemy unit that has destroyed one or more X units during the
 *    battle"): a windowed destruction history. It takes no subject; `named` places the unit-filter
 *    of the victims, `destroyer` says who destroyed them (`defender`, the attack's target, joins
 *    the older roles and is valid only here) and a `history-window` leaf after it names the
 *    window. Lowered in compile-triggering-destruction.ts.
 */
export const HISTORY_VALUE_ACTIVITIES = [
  "lost-wounds-to-triggering-attacks", "was-charged-this-turn", "suffered-mortal-wounds-from-this-ability", "lost-models-to-own-mortal-wounds",
] as const;
export const WINDOWED_DESTRUCTION = "destroyed-units-in-window";
export const WINDOWED_DESTROYERS = ["this-unit", "this-model", "event-subject", "stratagem-target", "defender"] as const;
const WINDOWED_NAMED = ["before", "after"] as const;

const VALUES: FamilyExtension = activitiesExtension(
  HISTORY_VALUE_ACTIVITIES,
  "four activities that name the unit by subject: lost wounds to the triggering attacks, was charged this turn, suffered mortal wounds from this ability, lost models to this ability's mortal wounds",
);

const WINDOWED: FamilyExtension = {
  family: "unit-activity",
  description: "As the previous version, plus the activity destroyed-units-in-window (a windowed destruction history): named before or after, container none, destroyer this-unit, this-model, event-subject, stratagem-target or defender (the attack's target; this activity only), no subject. A history-window leaf after it names the window.",
  schema: (previous) => {
    const property = properties(previous).activities!;
    const items = property.items as Schema;
    const destroyer = properties(previous).destroyer!;
    return withProperties(previous, {
      activities: { ...property, items: { ...items, enum: [...(items.enum as string[]), WINDOWED_DESTRUCTION] } },
      destroyer: optional({ ...destroyer, enum: [...(destroyer.enum as string[]), "defender"] }),
    });
  },
  normalize: (input, previous) => {
    const listed = Array.isArray(input.activities) ? input.activities as unknown[] : [];
    if (!listed.includes(WINDOWED_DESTRUCTION)) {
      if (input.destroyer === "defender") throw new TypeError("unit-activity destroyer defender belongs to destroyed-units-in-window only.");
      return previous(input);
    }
    if (listed.length !== 1) throw new TypeError("unit-activity destroyed-units-in-window: one activity per leaf.");
    if (input.subject !== undefined) throw new TypeError("unit-activity destroyed-units-in-window takes no subject; destroyer names who destroyed.");
    if (!(WINDOWED_DESTROYERS as readonly unknown[]).includes(input.destroyer)) throw new TypeError(`unit-activity destroyed-units-in-window needs destroyer: ${WINDOWED_DESTROYERS.join(", ")}.`);
    if (!(WINDOWED_NAMED as readonly unknown[]).includes(input.named)) throw new TypeError("unit-activity destroyed-units-in-window needs named: before or after.");
    if (input.container !== "none") throw new TypeError("unit-activity destroyed-units-in-window names a unit, not a model's container: container none.");
    const { named, container, destroyer, ...rest } = input;
    const stray = Object.keys(rest).filter((key) => key !== "activities" && key !== "negated");
    if (stray.length) throw new TypeError(`unit-activity destroyed-units-in-window has no parameter ${stray[0]}.`);
    // The previous version checks the shared parameters (negated) with a known activity standing in.
    const { subject: _subject, ...normalized } = previous({ ...rest, activities: ["remained-stationary"], subject: "this-unit" });
    return { ...normalized, activities: [WINDOWED_DESTRUCTION], named, container, destroyer };
  },
};

export const FAMILY_EXTENSIONS_20_UNIT_ACTIVITY_HISTORY_VALUES: readonly FamilyExtension[] = [VALUES, WINDOWED];
