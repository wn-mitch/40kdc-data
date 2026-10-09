import { type FamilyExtension, properties, withProperties } from "./family-extension-helpers.js";

/**
 * Engaged and hidden in a unit-filter: "One friendly **engaged** Plague Marines unit", "friendly
 * **hidden** Phobos unit". The state is the adjective of the unit's own noun phrase, as unengaged
 * already is, so it stays in the filter. A distance, a visibility or an engagement with another
 * unit stays a separate leaf. Compilation holds one positive state per filter
 * (compile-unit-filters.ts assertOneFilterState).
 */

/** The unit states a unit-filter gains in this version. */
export const FILTER_STATES_16 = ["engaged", "hidden"] as const;

export const FAMILY_EXTENSIONS_16_ENGAGED_STATE_IN_FILTER: readonly FamilyExtension[] = [
  {
    family: "unit-filter",
    description: "As the previous version, plus the states engaged and hidden (\"friendly engaged X unit\", \"friendly hidden X unit\"); engaged cannot be unengaged in the same filter.",
    schema: (previous) => {
      const states = properties(previous).states!;
      const items = states.items as Record<string, unknown>;
      return withProperties(previous, { states: { ...states, items: { ...items, enum: [...(items.enum as string[]), ...FILTER_STATES_16] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : undefined;
      const added = states?.filter((state) => (FILTER_STATES_16 as readonly unknown[]).includes(state)) ?? [];
      if (added.length === 0) return previous(input);
      if (new Set(states).size !== states!.length) throw new TypeError("unit-filter.states lists a state twice.");
      if (added.includes("engaged") && states!.includes("unengaged")) throw new TypeError("unit-filter cannot be both engaged and unengaged.");
      // The older states go to the previous version; a filter of only engaged or hidden has none to pass.
      const older = states!.filter((state) => !added.includes(state));
      const { states: _states, ...rest } = input;
      const normalized = previous(older.length ? { ...rest, states: older } : rest);
      const kept = (normalized.states as string[] | undefined) ?? [];
      return { ...normalized, states: [...kept, ...(added as string[])].sort() };
    },
  },
];
