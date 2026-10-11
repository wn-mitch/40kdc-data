import { type FamilyExtension, optional, properties, standIn, type Schema, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Destroyer filter after a destruction (tier 6). Two versions:
 *
 * event: action_kind fight on attacks-resolved, "after all the bearer's attacks have been
 * resolved" in a fight. Lowers to trigger filter kind fight, which the DSL's event-filter enum
 * already has. Shares the attack-moment path: the previous version reads it as attack, and the
 * fight kind is restored on the output. Refused on any other kind.
 *
 * unit-activity: destroyer this-model, for a destruction the holder's own model made ("each time
 * the bearer fights, if … enemy models are destroyed by those attacks"). The triggering-destruction
 * lowering (compile-triggering-destruction.ts) writes it as the happened filter's by.
 */
const EVENT_FIGHT: FamilyExtension = {
  family: "event",
  description: "As the previous version, plus action_kind fight on attacks-resolved: the moment a unit's attacks in a fight have been resolved (lowers to the fight attack-resolved filter, not attack, which would also cover shooting).",
  schema: (previous) => withProperties(previous, { action_kind: widenedEnum(previous, "action_kind", ["fight"]) }),
  normalize: (input, previous) => {
    if (input.action_kind !== "fight") return previous(input);
    if (input.kind !== "attacks-resolved") throw new TypeError("event.action_kind fight applies only to attacks-resolved.");
    return standIn(input, "action_kind", "attack", previous);
  },
};

const DESTROYER_THIS_MODEL: FamilyExtension = {
  family: "unit-activity",
  description: "As the previous version, plus destroyer this-model: the destruction was made by the attacks of this model (a destruction activity only).",
  schema: (previous) => {
    const destroyer = properties(previous).destroyer!;
    return withProperties(previous, { destroyer: optional({ ...destroyer, enum: [...(destroyer.enum as string[]), "this-model"] }) as Schema });
  },
  normalize: (input, previous) => input.destroyer === "this-model" ? standIn(input, "destroyer", "this-unit", previous) : previous(input),
};

export const FAMILY_EXTENSIONS_16_DESTROYER_FILTER_AFTER_DESTRUCTION: readonly FamilyExtension[] = [EVENT_FIGHT, DESTROYER_THIS_MODEL];
