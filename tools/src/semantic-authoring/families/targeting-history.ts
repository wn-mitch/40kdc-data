import type { FamilyExtension } from "../family-extension-helpers.js";
import { optional, withProperties } from "../family-extension-helpers.js";
import { enumSet } from "../family-validation.js";
import { TARGETING_KINDS } from "../targeting-families.js";

/**
 * What the unit being targeted did or had done to it, named relative to the unit that targets
 * (`by`): within its Engagement Range at the start of the turn, or the target of another unit's
 * attack or charge this phase. A leaf that lists several means any one of them.
 */
export const TARGET_HISTORY = ["engaged-with-by-at-turn-start", "attacked-by-another-unit-this-phase", "charged-by-another-unit-this-phase"] as const;

/** The moves after which a restriction holds ("in a turn in which it Advanced or Fell Back, but when doing so"). */
export const AFTER_MOVES = ["advance", "fall-back"] as const;

/** Every kind a targeting restriction can name, as the version before this one knows them. */
const KINDS = [...TARGETING_KINDS, "ability"] as const;

/**
 * "This unit cannot target a unit it was within Engagement Range of at the start of the turn",
 * "… a unit that was the target of another unit's charge or attack this phase": the restriction
 * covers only targets with that history. kinds names several kinds at once ("shoot and declare a
 * charge … it cannot target"), and after_moves holds the restriction only in a turn the unit that
 * targets made one of those moves. All three need the by form, since each is relative to `by`.
 */
export const TARGETING_HISTORY_EXTENSIONS: readonly FamilyExtension[] = [
  {
    family: "targeting-restriction",
    version: 6,
    description: "As the previous version, plus, on the by form: target_history (the restriction covers only targets with any of this history, relative to by: engaged-with-by-at-turn-start, attacked-by-another-unit-this-phase, charged-by-another-unit-this-phase), kinds (two or more kinds in place of kind: \"shoot and declare a charge … it cannot target\") and after_moves (the restriction holds only in a turn by made one of these moves: advance, fall-back).",
    schema: (previous) => {
      const schema = withProperties(previous, {
        target_history: optional({ type: "array", items: { enum: [...TARGET_HISTORY] }, minItems: 1, uniqueItems: true }),
        kinds: optional({ type: "array", items: { enum: [...KINDS] }, minItems: 2, uniqueItems: true }),
        after_moves: optional({ type: "array", items: { enum: [...AFTER_MOVES] }, minItems: 1, uniqueItems: true }),
      });
      return { ...schema, required: (schema.required as string[]).filter((key) => key !== "kind") };
    },
    normalize: (input, previous) => {
      const { target_history: history, kinds, after_moves: afterMoves, ...rest } = input;
      if (history === undefined && kinds === undefined && afterMoves === undefined) return previous(input);
      if (!("by" in input)) throw new TypeError("targeting-restriction.target_history, kinds and after_moves are relative to the unit that targets; they need the by form.");
      const added: Record<string, unknown> = {};
      if (history !== undefined) added.target_history = enumSet(history, TARGET_HISTORY, "targeting-restriction.target_history");
      if (afterMoves !== undefined) added.after_moves = enumSet(afterMoves, AFTER_MOVES, "targeting-restriction.after_moves");
      if (kinds === undefined) return { ...previous(rest), ...added };
      if ("kind" in input) throw new TypeError("targeting-restriction names either kind or kinds, not both.");
      const list = enumSet(kinds, KINDS, "targeting-restriction.kinds");
      if (list.length < 2) throw new TypeError("targeting-restriction.kinds names two or more kinds; one kind is kind.");
      if ("stratagem" in input || "ability" in input || "except" in input) throw new TypeError("targeting-restriction.kinds names no one Stratagem or ability.");
      // The previous version checks the rest once per kind, each standing in for kind.
      let normalized: Record<string, unknown> = {};
      for (const kind of list) {
        const { kind: _kind, ...checked } = previous({ ...rest, kind });
        normalized = checked;
      }
      return { ...normalized, kinds: list, ...added };
    },
  },
];
