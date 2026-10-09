import { type FamilyExtension, optional, type Schema, withProperties } from "./family-extension-helpers.js";

/**
 * The eighteenth round of family extensions: an antecedent frame. A weapon-ability-grant or a
 * weapon-property-scope with `frame: "antecedent"` names no recipient or weapon type of its own. The
 * binder (compile-weapon-antecedent.ts bindFrameAntecedents) copies them from the nearest earlier
 * frame or scope before any fold runs, so "Or: If X, [K] and +1 AP" inherits the branch's weapons
 * from the sentence before it. Each version checks only its own key and hands the rest to the
 * previous version, with stand-in values the previous version requires and this one does not.
 */

const FRAME = "frame";
const ANTECEDENT_FRAME = "antecedent";

/** Keys that name a recipient or weapon scope: an antecedent frame may not state them, the binder supplies them. */
const GRANT_SCOPE_KEYS = ["subject", "weapon_type", "keyword", "keywords", "weapon", "weapon_name", "weapon_keyword", "incoming"];
const SCOPE_KEYS = ["subject", "weapon_type", "weapon", "weapon_keyword", "weapon_name", "incoming"];

/** Remove a key from a family's required list. */
function withoutRequired(schema: Schema, keys: readonly string[]): Schema {
  return { ...schema, required: (schema.required as string[]).filter((item) => !keys.includes(item)) };
}

/** Stand-ins the previous version requires for a frame; the binder replaces them before lowering. */
const STAND_IN = { subject: "this-unit", weapon_type: "all" } as const;

export const FAMILY_EXTENSIONS_18_FRAME_ANTECEDENT: readonly FamilyExtension[] = [
  {
    // "Or: If the doctrine is active, [K]": the keyword frame takes its recipient from the branch before it.
    family: "weapon-ability-grant",
    description: "As the previous version, and frame: antecedent makes a keyword-less frame with no subject or weapon_type: the binder copies both from the nearest earlier frame or scope. A frame with frame antecedent names no keyword, weapon name, weapon keyword or incoming attacks.",
    schema: (previous) => withoutRequired(withProperties(previous, { [FRAME]: optional({ enum: [ANTECEDENT_FRAME] }) }), ["subject", "weapon_type"]),
    normalize: (input, previous) => {
      if (!(FRAME in input)) return previous(input);
      if (input[FRAME] !== ANTECEDENT_FRAME) throw new TypeError(`weapon-ability-grant.frame is ${ANTECEDENT_FRAME} or absent.`);
      for (const key of GRANT_SCOPE_KEYS) {
        if (key in input) throw new TypeError(`weapon-ability-grant antecedent frame cannot also name ${key}; the binder takes it from an earlier frame.`);
      }
      const { [FRAME]: _frame, ...rest } = input;
      const { subject: _subject, weapon_type: _type, ...others } = previous({ ...rest, ...STAND_IN });
      return { ...others, [FRAME]: ANTECEDENT_FRAME };
    },
  },
  {
    // "Or: If the doctrine is active, … +1 AP": the stat scope takes its recipient and weapon type from the branch before it.
    family: "weapon-property-scope",
    description: "As the previous version, and frame: antecedent makes a scope with no subject or weapon_type: the binder copies both from the nearest earlier frame or scope. It names no weapon, weapon_keyword, weapon_name or incoming attacks.",
    schema: (previous) => withoutRequired(withProperties(previous, { [FRAME]: optional({ enum: [ANTECEDENT_FRAME] }) }), ["subject", "weapon_type"]),
    normalize: (input, previous) => {
      if (!(FRAME in input)) return previous(input);
      if (input[FRAME] !== ANTECEDENT_FRAME) throw new TypeError(`weapon-property-scope.frame is ${ANTECEDENT_FRAME} or absent.`);
      for (const key of SCOPE_KEYS) {
        if (key in input) throw new TypeError(`weapon-property-scope antecedent frame cannot also name ${key}; the binder takes it from an earlier frame or scope.`);
      }
      const { [FRAME]: _frame, ...rest } = input;
      const { subject: _subject, weapon_type: _type, ...others } = previous({ ...rest, ...STAND_IN });
      return { ...others, [FRAME]: ANTECEDENT_FRAME };
    },
  },
];
