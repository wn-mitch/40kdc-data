import { ANTECEDENT } from "../antecedent-families.js";
import { DICE, EVENT_SUBJECT, type FamilyExtension, optional, properties, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";
import { FOLLOWING_FILTER, WEAPON, printedKeywordsExtension } from "./shared.js";

/**
 * Versions of the attack families (attack, attack-filter, hit-by-attacks) and of the families that
 * destroy or return models (mortal-wounds, destroy-models, return-models). Each version checks only
 * its own additions and hands the rest of a leaf to the previous version, so every earlier leaf
 * still fits it unchanged.
 */

/** Wounds a returned model can come back with beyond return-models@1's: 3, and half of its starting wounds. */
const RETURN_WOUNDS_ADDED = ["3", "half-starting"] as const;

const RETURN_MODELS_WOUNDS: FamilyExtension = {
  // "with 3 wounds remaining", "with half of its starting number of wounds remaining".
  family: "return-models",
  version: 4,
  description: "As the previous version, plus wounds_remaining 3 and half-starting (half of the model's starting number of wounds).",
  schema: (previous) => withProperties(previous, { wounds_remaining: widenedEnum(previous, "wounds_remaining", RETURN_WOUNDS_ADDED) }),
  normalize: (input, previous) => (RETURN_WOUNDS_ADDED as readonly unknown[]).includes(input.wounds_remaining)
    ? standIn(input, "wounds_remaining", "1", previous)
    : previous(input),
};

const HIT_THIS_PHASE: FamilyExtension = {
  // "that was hit by one or more Psychic Attacks made by a" + "THOUSAND SONS PSYKER model" + "this phase".
  family: "hit-by-attacks",
  version: 3,
  description: "As the previous version, plus window phase: hit at any time this phase, not only by the attacks of the ability's moment; and by following-filter (only with window phase): the attacks were made by any unit or model the unit-filter right after this leaf matches. Without by, the attacker is the unit of the ability's moment, as before.",
  schema: (previous) => withProperties(previous, {
    window: optional({ enum: ["phase"] }),
    by: optional({ enum: [FOLLOWING_FILTER], "x-only-when": { window: ["phase"] } }),
  }),
  normalize: (input, previous) => {
    if (input.window === undefined && input.by === undefined) return previous(input);
    const { window, by, ...rest } = input;
    if (window === undefined) throw new TypeError("hit-by-attacks.by names who made the attacks of a window phase hit.");
    const normalized = { ...previous(rest), window: enumValue(window, ["phase"], "hit-by-attacks.window") };
    return by === undefined ? normalized : { ...normalized, by: enumValue(by, [FOLLOWING_FILTER], "hit-by-attacks.by") };
  },
};

/** The attack types a back-reference can print ("those ranged attacks"); "any" is the antecedent's own. */
const PRINTED_TYPES = ["melee", "ranged", "psychic"];

/**
 * The attack-filter fields "those attacks" can carry beside `of`. A shooting moment's attacks
 * are ranged by definition, so only attack_type ranged may restate it; any other field would
 * narrow the bound attacks in a way the DSL's event reference cannot say.
 */
export function boundAttacksProblem(parameters: Record<string, unknown>): string | null {
  const extra = Object.keys(parameters).filter((key) => key !== "of" && key !== "attack_type");
  if (extra.length) return `attack-filter of antecedent names the attacks of an earlier shooting moment; ${extra.join(", ")} cannot narrow them.`;
  if (parameters.attack_type !== undefined && parameters.attack_type !== "ranged") {
    return `attack-filter of antecedent names the attacks of an earlier shooting moment, which are ranged, not ${String(parameters.attack_type)}.`;
  }
  return null;
}

const FOLLOWING = "following-filter";

const ATTACK_TARGET_FOLLOWING: FamilyExtension = {
  family: "attack",
  version: 7,
  description: "As the previous version, plus target following-filter: the defender is any unit the unit-filter right after this attack matches (\"makes a ranged attack that targets an enemy unit\"). The same target field as that-unit; direction makes is required and unit that-unit is refused.",
  schema: (previous) => withProperties(previous, {
    target: optional({ enum: ["that-unit", FOLLOWING], "x-only-when": { direction: ["makes"] } }),
  }),
  normalize: (input, previous) => {
    if (input.target !== FOLLOWING) return previous(input);
    if (input.direction !== "makes") throw new TypeError("attack.target following-filter names the defender, so the attack's direction must be makes.");
    if (input.unit === "that-unit") throw new TypeError("attack.target following-filter cannot go with unit that-unit: one unit would both make and receive the attack.");
    return standIn(input, "target", "that-unit", previous);
  },
};

export const ATTACK_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "each time an enemy model makes an attack": any enemy unit attacks, or the enemy units the
    // unit-filter right before the attack matches.
    family: "attack",
    version: 5,
    description: "As the previous version, plus unit enemy-unit: an enemy unit makes the attack (\"each time an enemy model makes a ranged attack\"); a unit-filter right before it says which enemy units.",
    schema: (previous) => withProperties(previous, { unit: widenedEnum(previous, "unit", ["enemy-unit"]) }),
    normalize: (input, previous) => input.unit === "enemy-unit" ? standIn(input, "unit", "friendly-unit", previous) : previous(input),
  },
  /**
   * Back-references: an attack leaf can point back to an earlier attack of its record ("that
   * attack", "such an attack", "the target of that attack") or name the unit an earlier leaf
   * introduced as the attack's target ("an X unit … targets that unit"). The compiler resolves both
   * (compile-attack-backref.ts).
   */
  {
    family: "attack",
    version: 6,
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
  /**
   * Target following-filter: the defender is the unit the unit-filter right after the attack
   * matches ("makes a ranged attack that targets an enemy unit ..."). Mirrors hit-by-attacks object
   * following-filter. Refused without direction makes, and with unit that-unit.
   */
  ATTACK_TARGET_FOLLOWING,
  {
    family: "attack",
    version: 8,
    description: "As the previous version, plus refers earlier-permission: resolving the attacks made by the nearest preceding allowed shoot or fight permission in the same fragment. The actor and attack type come from that permission; its attack modifiers last only for that resolution, not afterwards.",
    schema: (previous) => withProperties(previous, {
      refers: optional({ enum: ["earlier-attack", "earlier-permission"] }),
    }),
    normalize: (input, previous) => input.refers === "earlier-permission"
      ? standIn(input, "refers", "earlier-attack", previous)
      : previous(input),
  },
  /**
   * "Those attacks": the attacks of an earlier shooting moment of the same record. Compilation
   * binds them to that moment (`compile-bound-attacks.ts`); the leaf only records that it points
   * back.
   */
  {
    // "Those attacks do not prevent your unit from being hidden", "those ranged attacks …".
    family: "attack-filter",
    version: 2,
    description: "As the previous version, plus of antecedent: the attacks an earlier moment of the record introduced (\"those attacks\", \"those ranged attacks\"): the attacks a shooting selection goes on to make, or the attacks of a shooting that has just resolved.",
    schema: (previous) => withProperties(previous, { of: optional({ enum: [ANTECEDENT] }) }),
    normalize: (input, previous) => {
      if (!("of" in input)) return previous(input);
      if (input.of !== ANTECEDENT) throw new TypeError(`attack-filter.of is ${ANTECEDENT} or absent.`);
      const problem = boundAttacksProblem(input);
      if (problem) throw new TypeError(problem);
      const { of: _of, ...rest } = input;
      return { ...(Object.keys(rest).length ? previous(rest) : {}), of: ANTECEDENT };
    },
  },
  /**
   * `weapon: antecedent` names the attacks made with the weapons an earlier keyword grant gave that
   * keyword.
   */
  {
    // "each time an attack is made with such a weapon": the attacks made with the weapons an earlier grant gave a keyword.
    family: "attack-filter",
    version: 3,
    description: "As the previous version, plus weapon: antecedent, the attacks made with the weapons an earlier keyword grant gave that keyword (\"each time an attack is made with such a weapon\"). It takes attack_type and negated only; the grant's weapon type sets attack_type.",
    schema: (previous) => withProperties(previous, { weapon: optional({ enum: [ANTECEDENT] }) }),
    normalize: (input, previous) => {
      if (!(WEAPON in input)) return previous(input);
      if (input.weapon !== ANTECEDENT) throw new TypeError(`attack-filter.weapon is ${ANTECEDENT} or absent.`);
      const extra = Object.keys(input).filter((key) => key !== WEAPON && key !== "attack_type" && key !== "negated");
      if (extra.length) throw new TypeError(`attack-filter weapon antecedent names the weapons an earlier grant gave a keyword; ${extra.join(", ")} cannot narrow them.`);
      // The keyword comes from the grant at compile time; a stand-in lets the previous version check the rest.
      const { weapon: _weapon, ...rest } = input;
      const { weapon_keyword: _standIn, ...others } = previous({ ...rest, weapon_keyword: "Antecedent" });
      return { ...others, weapon: ANTECEDENT };
    },
  },
  HIT_THIS_PHASE,
  /**
   * Weapon-qualified attack references: a hit-by-attacks leaf can name the unit hit by the
   * unit-filter before it (in the before-form "those attacks made with its Doomweaver scored a hit
   * against an enemy unit"). Every earlier leaf keeps its meaning.
   */
  {
    // "scored a hit against an enemy unit" (object) in place of "was hit by … units" (subject).
    family: "hit-by-attacks",
    version: 4,
    description: "As the previous version, but subject is optional: object following-filter names the unit hit as the unit-filter right after this leaf (\"those attacks made with its Doomweaver scored a hit against an enemy unit\"). It takes no by, and not with subject.",
    schema: (previous) => {
      const { required: _required, ...rest } = previous;
      return withProperties({ ...rest, required: [] }, {
        subject: optional(properties(previous).subject!),
        object: optional({ enum: [FOLLOWING_FILTER] }),
      });
    },
    normalize: (input, previous) => {
      if (input.object === undefined) {
        if (input.subject === undefined) throw new TypeError("hit-by-attacks names the unit hit: subject, or object following-filter.");
        return previous(input);
      }
      const { object, ...rest } = input;
      enumValue(object, [FOLLOWING_FILTER], "hit-by-attacks.object");
      if (rest.subject !== undefined) throw new TypeError("hit-by-attacks names the unit hit by subject or by object, not both.");
      if (rest.by !== undefined) throw new TypeError("hit-by-attacks names the following unit-filter as both the unit hit and the attacks' attacker; it can be only one.");
      // The previous version checks the rest with a subject standing in; the subject is then removed.
      const { subject: _subject, ...normalized } = previous({ ...rest, subject: "this-unit" });
      return { ...normalized, object: FOLLOWING_FILTER };
    },
  },
  {
    // "that enemy unit suffers D3+1 mortal wounds", "2D3 mortal wounds".
    family: "mortal-wounds",
    version: 3,
    description: "As the previous version, and a count can be any dice amount plus a number (2D3, D3+1).",
    schema: (previous) => withProperties(previous, { count: { anyOf: [properties(previous).count!, { type: "string", pattern: DICE.source }] } }),
    normalize: (input, previous) => {
      // The previous version's own counts first; only a count it does not list is a new dice amount.
      if (typeof input.count !== "string" || !DICE.test(input.count.trim().toUpperCase())) return previous(input);
      try {
        return previous(input);
      } catch {
        // Not one of the previous version's counts: a dice amount, with the rest checked below.
      }
      return { ...standIn(input, "count", "D3", previous), count: input.count.trim().toUpperCase() };
    },
  },
  {
    // "Each time an enemy unit ends a Charge move, … that unit suffers D3 mortal wounds": the unit
    // whose action fired the trigger, which the DSL's mortal-wounds target names as event-subject.
    family: "mortal-wounds",
    version: 4,
    description: "As the previous version, and the recipient can be event-subject: the unit whose action fired the trigger (\"that unit suffers D3 mortal wounds\" after \"each time an enemy unit ends a Charge move\").",
    schema: (previous) => withProperties(previous, { recipient: widenedEnum(previous, "recipient", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => input.recipient === EVENT_SUBJECT ? standIn(input, "recipient", "this-unit", previous) : previous(input),
  },
  {
    // "(to a maximum of 6 mortal wounds)": a cap on the total.
    family: "mortal-wounds",
    version: 5,
    description: "As the previous version, plus max: no more than this many mortal wounds in total (\"to a maximum of 6 mortal wounds\").",
    schema: (previous) => withProperties(previous, { max: optional({ type: "integer", minimum: 1, maximum: 20 }) }),
    normalize: (input, previous) => {
      if (input.max === undefined) return previous(input);
      const { max, ...rest } = input;
      if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 20) throw new TypeError("mortal-wounds max is a whole number from 1 to 20.");
      return { ...previous(rest), max };
    },
  },
  printedKeywordsExtension("destroy-models", 3),
  printedKeywordsExtension("return-models", 3),
  RETURN_MODELS_WOUNDS,
];
