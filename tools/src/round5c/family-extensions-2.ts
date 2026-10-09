import { ANTECEDENT } from "./antecedent-families.js";
import { activitiesExtension, DICE, EVENT_SUBJECT, type FamilyExtension, keywordList, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * The second round of family extensions, each on top of the version `family-extensions.ts` (or
 * the antecedent versions) made current. As there, a version checks only its own additions and
 * hands the rest of a leaf to the previous version, so leaves move across by identity.
 */

/** Tests a roll-modifier can change ("subtract 1 from those Desperate Escape tests"), checked as Battle-shock is. */
const TEST_ROLLS = ["hazard", "psychic", "desperate-escape"] as const;
/** Rolls made with a weapon, so a modifier to them can name melee or ranged weapons only. */
const WEAPON_ROLLS = new Set(["hit", "wound", "damage"]);
const WEAPON_TYPES = ["all", "melee", "ranged"] as const;
/** Weapon abilities a characteristic change can be limited to ("Torrent weapons equipped by …"). */
export const WEAPON_KEYWORDS = [
  "Assault", "Blast", "Devastating Wounds", "Hazardous", "Heavy", "Ignores Cover", "Indirect Fire", "Lance", "Lethal Hits",
  "Melta", "One Shot", "Pistol", "Precision", "Psychic", "Rapid Fire", "Sustained Hits", "Torrent", "Twin-linked",
] as const;
const NEW_ACTIVITIES = ["declared-charge-this-phase", "fell-back-this-turn"] as const;
const AFTER_ROLL_SUBJECTS = ["this-unit", "this-model", "selected-unit", EVENT_SUBJECT, ANTECEDENT] as const;

function weaponType(input: Record<string, unknown>, rolls: readonly unknown[], label: string): Record<string, unknown> {
  if (!("weapon_type" in input)) return {};
  const value = enumValue(input.weapon_type, WEAPON_TYPES, `${label}.weapon_type`);
  if (!rolls.every((roll) => WEAPON_ROLLS.has(String(roll)))) throw new TypeError(`${label}.weapon_type limits Hit, Wound or Damage rolls only.`);
  return { weapon_type: value };
}

export const FAMILY_EXTENSIONS_2: readonly FamilyExtension[] = [
  {
    // "subtract 1 from each of those Desperate Escape tests", "melee attacks have -1 to Wound rolls".
    family: "roll-modifier",
    description: "As the previous version, and roll can also be a Hazardous, Psychic or Desperate Escape test; weapon_type limits a Hit, Wound or Damage roll change to melee or ranged weapons.",
    schema: (previous) => withProperties(previous, {
      roll: optional(widenedEnum(previous, "roll", TEST_ROLLS)),
      weapon_type: optional({ enum: WEAPON_TYPES }),
    }),
    normalize: (input, previous) => {
      const { weapon_type: _type, ...rest } = input;
      const rolls = Array.isArray(rest.rolls) ? rest.rolls as unknown[] : [rest.roll];
      const scope = weaponType(input, rolls, "roll-modifier");
      const normalized = (TEST_ROLLS as readonly unknown[]).includes(rest.roll) ? standIn(rest, "roll", "battle-shock", previous) : previous(rest);
      return { ...normalized, ...scope };
    },
  },
  {
    // "it can make a Normal move of up to D3+3\"".
    family: "make-move",
    description: "As the previous version, and a distance can be a dice amount plus a number (D3+3, D6+1).",
    schema: (previous) => {
      // One flat list of alternatives, so samplers and readers see each branch.
      const distance = properties(previous).distance!;
      return withProperties(previous, { distance: { anyOf: [...(distance.anyOf as Schema[] ?? [distance]), { type: "string", pattern: DICE.source }] } });
    },
    normalize: (input, previous) => {
      if (typeof input.distance !== "string" || ["D3", "D6", "2D6"].includes(input.distance)) return previous(input);
      const dice = input.distance.trim().toUpperCase();
      if (!DICE.test(dice)) throw new TypeError("make-move.distance is inches, D3, D6, 2D6 or a dice amount plus a number (D3+3).");
      return { ...standIn(input, "distance", "D3", previous), distance: dice };
    },
  },
  {
    // "add 1 to the Strength characteristic of Torrent weapons equipped by models in this unit".
    family: "characteristic-modifier",
    description: "As the previous version, plus weapon_keyword: the change applies only to weapons with that ability (Torrent, Rapid Fire, Psychic …).",
    schema: (previous) => withProperties(previous, { weapon_keyword: optional({ enum: WEAPON_KEYWORDS }) }),
    normalize: (input, previous) => {
      if (!("weapon_keyword" in input)) return previous(input);
      const { weapon_keyword: keyword, ...rest } = input;
      const normalized = previous(rest);
      if (normalized.weapon_type === undefined) throw new TypeError("characteristic-modifier.weapon_keyword limits a weapon characteristic; give weapon_type too.");
      return { ...normalized, weapon_keyword: enumValue(keyword, WEAPON_KEYWORDS, "characteristic-modifier.weapon_keyword") };
    },
  },
  // "if that unit has declared a charge this phase", "if this unit Fell Back this turn".
  activitiesExtension(NEW_ACTIVITIES, "two activities: declared a charge this phase, and made a Fall Back move this turn"),
  {
    // "while this unit is wholly within 6\" of one or more friendly **K** units", "within 3\" of one or more enemy units".
    family: "unit-position",
    description: "As the previous version, plus wholly (every model of the subject is within the distance), and a matching unit can be any unit of a side, with no keywords.",
    schema: (previous) => withProperties(previous, {
      wholly: optional({ const: true, "x-only-when": { kind: ["within"] } }),
      of_keywords: optional(properties(previous).of_keywords!),
    }),
    normalize: (input, previous) => {
      const { wholly, ...rest } = input;
      if ("wholly" in input) {
        if (wholly !== true) throw new TypeError("unit-position.wholly is true or absent.");
        if (rest.kind !== "within") throw new TypeError("unit-position.wholly describes a within distance.");
      }
      // Any unit of a side: the previous version checks the rest with a keyword standing in.
      const anyUnit = rest.of === "matching-unit" && !("of_keywords" in rest);
      const normalized = anyUnit ? (({ of_keywords: _keywords, ...checked }) => checked)(previous({ ...rest, of_keywords: ["INFANTRY"] })) : previous(rest);
      return { ...normalized, ...(wholly === true ? { wholly: true } : {}) };
    },
  },
  {
    // "select up to two **K** units from your army", "select three enemy units".
    family: "select-unit",
    description: "As the previous version, plus count: how many units are selected, exactly or (up_to) at most that many. Without count, one unit.",
    schema: (previous) => withProperties(previous, {
      count: optional({ type: "integer", minimum: 1, maximum: 10 }),
      up_to: optional({ const: true }),
    }),
    normalize: (input, previous) => {
      const { count, up_to: upTo, ...rest } = input;
      const normalized = previous(rest);
      if (count === undefined) {
        if (upTo !== undefined) throw new TypeError("select-unit.up_to needs a count.");
        return normalized;
      }
      if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) throw new TypeError("select-unit.count is a whole number of units from 1 to 10 (a dice count has no DSL selector).");
      if (upTo !== undefined && upTo !== true) throw new TypeError("select-unit.up_to is true or absent.");
      if (count === 1 && upTo === undefined) throw new TypeError("select-unit selects one unit by default; leave count out.");
      return { ...normalized, count, ...(upTo === true ? { up_to: true } : {}) };
    },
  },
  {
    // "while this model is leading a **DOMINION SQUAD**": attached to a unit with those keywords.
    family: "leading-unit",
    description: "As the previous version, plus attached_to_keywords: the unit it is attached to has every one of these keywords.",
    schema: (previous) => withProperties(previous, { attached_to_keywords: optional({ type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true }) }),
    normalize: (input, previous) => {
      if (!("attached_to_keywords" in input)) return previous(input);
      const { attached_to_keywords: keywords, ...rest } = input;
      return { ...previous(rest), attached_to_keywords: keywordList(keywords, "leading-unit.attached_to_keywords", 1) };
    },
  },
  {
    // "in the first, third and fifth battle rounds".
    family: "battle-round",
    description: "As the previous version, or rounds: any one of two or more listed battle rounds, in place of min and max.",
    schema: (previous) => {
      const { minProperties: _minimum, ...rest } = previous;
      return { ...withProperties(rest, { rounds: optional({ type: "array", items: { type: "integer", minimum: 1, maximum: 5 }, minItems: 2, uniqueItems: true }) }), minProperties: 1 };
    },
    normalize: (input, previous) => {
      if (!("rounds" in input)) return previous(input);
      const { rounds, ...rest } = input;
      if (Object.keys(rest).length) throw new TypeError("battle-round lists rounds or gives min and max, not both.");
      if (!Array.isArray(rounds) || rounds.length < 2) throw new TypeError("battle-round.rounds lists at least two rounds.");
      for (const round of rounds) previous({ min: round, max: round });
      if (new Set(rounds).size !== rounds.length) throw new TypeError("battle-round.rounds lists a round twice.");
      return { rounds: [...rounds as number[]].sort((left, right) => left - right) };
    },
  },
  {
    // "in the Battle-shock step of your opponent's Command phase", "when your opponent uses a
    // Stratagem", "each time that unit fails a Battle-shock test".
    family: "event",
    description: "As the previous version, plus whose turn a step-started is (turn), whose army used a rule (owner on used), and on after-roll the unit that made the roll (subject) and its outcome (result: success or failure).",
    schema: (previous) => withProperties(previous, {
      turn: widenedKinds(properties(previous).turn!, ["step-started"]),
      owner: widenedKinds(properties(previous).owner!, ["used"]),
      subject: widenedKinds(properties(previous).subject!, ["after-roll"]),
      result: optional({ enum: ["success", "failure"], "x-only-when": { kind: ["after-roll"] } }),
    }),
    normalize: (input, previous) => {
      const kind = String(input.kind);
      const own: Record<string, readonly string[]> = { "step-started": ["turn"], used: ["owner"], "after-roll": ["subject", "result"] };
      const keys = (own[kind] ?? []).filter((key) => key in input);
      if (keys.length === 0) {
        if ("result" in input) throw new TypeError("event.result describes an after-roll only.");
        return previous(input);
      }
      const rest = Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
      const added: Record<string, unknown> = {};
      if ("turn" in input && kind === "step-started") added.turn = enumValue(input.turn, ["your", "opponent", "either"], "event.turn");
      if ("owner" in input && kind === "used") added.owner = enumValue(input.owner, ["friendly", "enemy"], "event.owner");
      if ("subject" in input && kind === "after-roll") added.subject = enumValue(input.subject, AFTER_ROLL_SUBJECTS, "event.subject");
      if ("result" in input && kind === "after-roll") added.result = enumValue(input.result, ["success", "failure"], "event.result");
      return { ...previous(rest), ...added };
    },
  },
];

/** A property that now also applies to more event kinds. */
function widenedKinds(property: Schema, kinds: readonly string[]): Schema {
  const only = property["x-only-when"] as { kind: string[] };
  return { ...property, "x-only-when": { kind: [...only.kind, ...kinds] } };
}
