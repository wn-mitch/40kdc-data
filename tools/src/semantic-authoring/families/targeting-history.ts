import type { FamilyExtension } from "../family-extension-helpers.js";
import { optional, properties, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumSet, enumValue, exactKeys } from "../family-validation.js";
import { TARGETING_KINDS } from "../targeting-families.js";

/**
 * What the unit being targeted did or had done to it, named relative to the unit that targets
 * (`by`): within its Engagement Range at the start of the turn, or the target of another unit's
 * attack or charge this phase. A leaf that lists several means any one of them.
 */
/** The narrower window a destroyed-units tally may count over; omitted, it counts the whole battle. */
const HISTORY_WINDOWS = ["battle-round"] as const;

const TARGET_HISTORY = ["engaged-with-by-at-turn-start", "attacked-by-another-unit-this-phase", "charged-by-another-unit-this-phase"] as const;

/** The actions whose targets a unit can select again ("can then select new charge targets"). */
const RESELECT_KINDS = ["charge", "attack", "shoot", "fight"] as const;

/** Moves the unit being targeted made ("enemy units that made a Fall Back move this phase"); targeting-restriction version 8 adds them. */
export const MOVE_HISTORY = ["fell-back-this-phase"] as const;

/** The moves after which a restriction holds ("in a turn in which it Advanced or Fell Back, but when doing so"). */
const AFTER_MOVES = ["advance", "fall-back"] as const;

/** Whose Engagement Range a may target restriction sets aside when targets are selected. */
const NOT_ENGAGED_WITH = ["this-unit"] as const;

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
  {
    family: "targeting-restriction",
    version: 7,
    description: "As the previous version, plus not_engaged_with: this-unit, on a may target restriction: when targets are selected, the units it names are not considered to be within Engagement Range of this unit (ranged attacks can target enemy units engaged with it).",
    schema: (previous) => withProperties(previous, { not_engaged_with: optional({ enum: [...NOT_ENGAGED_WITH] }) }),
    normalize: (input, previous) => {
      const { not_engaged_with: engaged, ...rest } = input;
      if (engaged === undefined) return previous(input);
      const normalized = previous(rest);
      if (normalized.may !== "target") throw new TypeError("targeting-restriction.not_engaged_with only applies when may is target.");
      return { ...normalized, not_engaged_with: enumValue(engaged, NOT_ENGAGED_WITH, "targeting-restriction.not_engaged_with") };
    },
  },
  {
    // "you can only select enemy units that made a Fall Back move this phase".
    family: "targeting-restriction",
    version: 8,
    description: "As the previous version, plus target_history fell-back-this-phase: the restriction covers only targets that ended a Fall Back move this phase.",
    schema: (previous) => {
      const history = properties(previous).target_history!;
      const items = history.items as Record<string, unknown>;
      return withProperties(previous, { target_history: { ...history, items: { ...items, enum: [...(items.enum as string[]), ...MOVE_HISTORY] } } });
    },
    normalize: (input, previous) => {
      const history = input.target_history;
      if (!Array.isArray(history) || !history.some((item) => (MOVE_HISTORY as readonly unknown[]).includes(item))) return previous(input);
      if (!("by" in input)) throw new TypeError("targeting-restriction.target_history is relative to the unit that targets; it needs the by form.");
      const all = enumSet(history, [...TARGET_HISTORY, ...MOVE_HISTORY], "targeting-restriction.target_history");
      const older = all.filter((item) => !(MOVE_HISTORY as readonly string[]).includes(item));
      const { target_history: _history, ...rest } = input;
      const normalized = previous(older.length > 0 ? { ...rest, target_history: older } : rest);
      return { ...normalized, target_history: all };
    },
  },
  {
    // "That enemy unit can then select new charge targets for that charge move".
    family: "targeting-restriction",
    version: 9,
    description: "As the previous version, plus may reselect on the subject form: the subject (this unit, or event-subject: the unit whose selection triggered the ability) having selected targets of kind (charge, attack, shoot or fight), can select new ones for that same action. It takes weapon_type all and no range, target or by.",
    schema: (previous) => withProperties(previous, {
      may: { enum: [...(properties(previous).may!.enum as string[]), "reselect"] },
      subject: widenedEnum(previous, "subject", ["event-subject"]),
    }),
    normalize: (input, previous) => {
      if (input.may !== "reselect") return previous(input);
      exactKeys(input, ["subject", "may", "kind", "weapon_type"], "targeting-restriction");
      enumValue(input.kind, RESELECT_KINDS, "targeting-restriction.kind with may reselect");
      if (input.weapon_type !== "all") throw new TypeError("targeting-restriction with may reselect takes weapon_type all.");
      const subject = enumValue(input.subject, ["this-unit", "event-subject"], "targeting-restriction.subject with may reselect");
      const normalized = previous({ ...input, may: "target", subject: "this-unit" });
      return { ...normalized, subject, may: "reselect" };
    },
  },
  {
    // "if the number of enemy units destroyed this battle round is greater than or equal to your pledge".
    family: "history-compare",
    version: 2,
    description: "As the previous version, plus window battle-round: both tallies count enemy units destroyed this battle round instead of this battle.",
    schema: (previous) => withProperties(previous, { window: optional({ enum: [...HISTORY_WINDOWS] }) }),
    normalize: (input, previous) => {
      const { window, ...rest } = input;
      if (window === undefined) return previous(input);
      return { ...previous(rest), window: enumValue(window, HISTORY_WINDOWS, "history-compare.window") };
    },
  },
];
