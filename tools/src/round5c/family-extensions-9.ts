import { activitiesExtension, type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * The ninth round of family extensions: leaves the DSL-extension round can now lower (a move
 * starting, Reserves states, a mortal-wound cap, a negated filter state, an all-of exclusion and
 * the Transport a unit disembarked from). As in the earlier rounds, a version checks only its own
 * additions and hands the rest to the previous one.
 */

/** Reserves states a unit-state leaf can name, as the DSL unit-state spells them. */
export const RESERVE_STATES = ["in-strategic-reserves", "in-cult-ambush"] as const;

/** History that names the Transport, lowered to `happened` disembarked in compile-conditions.ts. */
export const TRANSPORT_ACTIVITIES = ["disembarked-from-this-transport-this-turn"] as const;

export const FAMILY_EXTENSIONS_9: readonly FamilyExtension[] = [
  {
    // "At the start of this unit's move", "just before it Consolidates": the DSL's move-started.
    family: "event",
    description: "As the previous version, plus move-started: a unit starts a move (with move_types, owner and subject as move-ended takes them).",
    schema: (previous) => withProperties(previous, { kind: widenedEnum(previous, "kind", ["move-started"]) }),
    normalize: (input, previous) => input.kind === "move-started" ? standIn(input, "kind", "move-ended", previous) : previous(input),
  },
  {
    // "(to a maximum of 6 mortal wounds)": a cap on the total.
    family: "mortal-wounds",
    description: "As the previous version, plus max: no more than this many mortal wounds in total (\"to a maximum of 6 mortal wounds\").",
    schema: (previous) => withProperties(previous, { max: optional({ type: "integer", minimum: 1, maximum: 20 }) }),
    normalize: (input, previous) => {
      if (input.max === undefined) return previous(input);
      const { max, ...rest } = input;
      if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 20) throw new TypeError("mortal-wounds max is a whole number from 1 to 20.");
      return { ...previous(rest), max };
    },
  },
  {
    // "While this unit is in Reserves", "a unit in Cult Ambush": the DSL's Reserves unit-states.
    family: "unit-state",
    description: "As the previous version, plus in-strategic-reserves (\"in Reserves\" means Strategic Reserves) and in-cult-ambush (a type of Strategic Reserves).",
    schema: (previous) => {
      const property = properties(previous).states!;
      const items = property.items as Record<string, unknown>;
      return withProperties(previous, { states: { ...property, items: { ...items, enum: [...(items.enum as string[]), ...RESERVE_STATES] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      const added = states.filter((state) => (RESERVE_STATES as readonly unknown[]).includes(state));
      if (added.length === 0) return previous(input);
      if (input.with !== undefined) throw new TypeError("unit-state Reserves states take no with.");
      if (new Set(states).size !== states.length) throw new TypeError("unit-state lists a state twice.");
      const older = states.filter((state) => !added.includes(state));
      const normalized = previous({ ...input, states: older.length ? older : ["on-battlefield"] });
      const kept = older.length ? normalized.states as string[] : [];
      return { ...normalized, states: [...kept, ...(added as string[])] };
    },
  },
  {
    // "(excluding MONSTER CHARACTER units)" excludes only units with both keywords; "not Battle-shocked".
    family: "unit-filter",
    description: "As the previous version, plus excluded_all_keywords (units with every one of these keywords are left out) and the state not-battle-shocked.",
    schema: (previous) => {
      const states = properties(previous).states!;
      const items = states.items as Record<string, unknown>;
      return withProperties(previous, {
        states: { ...states, items: { ...items, enum: [...(items.enum as string[]), "not-battle-shocked"] } },
        excluded_all_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 2, uniqueItems: true }),
      });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : undefined;
      const negated = states?.includes("not-battle-shocked") === true;
      if (!negated && input.excluded_all_keywords === undefined) return previous(input);
      if (negated && states!.includes("battle-shocked")) throw new TypeError("unit-filter cannot be both battle-shocked and not-battle-shocked.");
      const { excluded_all_keywords: allOf, states: _states, ...rest } = input;
      const older = states?.filter((state) => state !== "not-battle-shocked") ?? [];
      const normalized = previous({ ...rest, ...(older.length ? { states: older } : {}) });
      const result: Record<string, unknown> = { ...normalized };
      if (negated) result.states = [...((normalized.states as string[] | undefined) ?? []), "not-battle-shocked"].sort();
      if (allOf !== undefined) result.excluded_all_keywords = keywordList(allOf, "unit-filter excluded_all_keywords", 2);
      return result;
    },
  },
  activitiesExtension(TRANSPORT_ACTIVITIES, "disembarked-from-this-transport-this-turn: the subject disembarked from this unit (the Transport) this turn"),
];
