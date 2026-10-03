import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * The fourth round of family extensions, on top of the versions the earlier rounds made current.
 * As there, a version checks only its own additions and hands the rest of a leaf to the previous
 * version, so leaves move across by identity.
 */

/**
 * The units a targeting restriction can name on either side: the ability's own unit or model,
 * the selected unit, the triggering unit, every enemy or friendly unit, or an earlier leaf's unit.
 */
export const TARGETING_UNITS = ["this-unit", "this-model", "selected-unit", "event-subject", "enemy-units", "friendly-units", ANTECEDENT] as const;
/** A Stratagem's id, as its core or detachment record has it ("fire-overwatch"). */
const STRATAGEM_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export const FAMILY_EXTENSIONS_4: readonly FamilyExtension[] = [
  {
    // "this unit can only target that enemy unit" (by this unit, target that unit); "this unit
    // cannot be targeted by ranged attacks" (target this unit, by anyone).
    family: "targeting-restriction",
    description: "As the previous version, or, instead of subject, target (the unit being targeted) and optionally by (the unit that targets): \"this unit can only target that enemy unit\" is by this unit, target that unit; \"this unit cannot be targeted by ranged attacks\" is target this unit with no by. With target, stratagem names the one Stratagem (kind stratagem), and except: core-stratagems keeps Core Stratagems allowed (\"other than Core Stratagems\"). A leaf with subject reads as the previous version did.",
    schema: (previous) => {
      const schema = withProperties(previous, {
        subject: optional((previous.properties as Record<string, Record<string, unknown>>).subject!),
        by: optional({ enum: TARGETING_UNITS }),
        target: optional({ enum: TARGETING_UNITS }),
        stratagem: optional({ type: "string", pattern: STRATAGEM_ID.source, "x-only-when": { kind: ["stratagem"] } }),
        except: optional({ const: "core-stratagems", "x-only-when": { kind: ["stratagem"], may: ["cannot-target"] } }),
      });
      return { ...schema, required: (previous.required as string[]).filter((key) => key !== "subject") };
    },
    normalize: (input, previous) => {
      const { by, target, stratagem, except, ...rest } = input;
      if (!("by" in input) && !("target" in input)) {
        if ("stratagem" in input || "except" in input) throw new TypeError("targeting-restriction.stratagem and except need target (and by), not subject.");
        return previous(input);
      }
      if ("subject" in input) throw new TypeError("targeting-restriction names either subject (the previous reading) or target and by, not both.");
      if (!("target" in input)) throw new TypeError("targeting-restriction.by needs a target: the unit being targeted.");
      const added: Record<string, unknown> = { target: enumValue(target, TARGETING_UNITS, "targeting-restriction.target") };
      if ("by" in input) {
        added.by = enumValue(by, TARGETING_UNITS, "targeting-restriction.by");
        if (added.by === added.target && added.by !== ANTECEDENT) throw new TypeError("targeting-restriction.by and target name the same unit.");
      }
      const { subject: _stand, ...normalized } = previous({ ...rest, subject: "this-unit" });
      if ("stratagem" in input) {
        if (normalized.kind !== "stratagem") throw new TypeError("targeting-restriction.stratagem names the Stratagem of kind stratagem only.");
        if (typeof stratagem !== "string" || !STRATAGEM_ID.test(stratagem)) throw new TypeError("targeting-restriction.stratagem is the Stratagem's kebab-case id.");
        added.stratagem = stratagem;
      }
      if ("except" in input) {
        if (except !== "core-stratagems" || normalized.kind !== "stratagem" || normalized.may !== "cannot-target") throw new TypeError("targeting-restriction.except is core-stratagems, on a cannot-target of kind stratagem only.");
        if ("stratagem" in input) throw new TypeError("targeting-restriction.except leaves out Core Stratagems from all Stratagems; it cannot go with one named Stratagem.");
        added.except = except;
      }
      return { ...normalized, ...added };
    },
  },
];
