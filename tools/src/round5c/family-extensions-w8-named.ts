import { ANTECEDENT } from "./antecedent-families.js";
import { EVENT_SUBJECT, type FamilyExtension, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * Family extensions for a named ability, manoeuvre, Stratagem or action being used: which one was
 * used, and who used it. As in the earlier rounds, a version checks only its own additions and
 * hands the rest to the previous one.
 */

/** A kebab-case entity id: an enrichment ability record, a core Stratagem or a menu action. */
export const NAMED_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
/** Activities a `used` moment can name one member of. Dark Pacts, Acts of Faith, Rituals and the rest are named only as a kind. */
export const NAMED_ACTIVITIES = ["ability", "manoeuvre", "stratagem", "action"] as const;
/** Targetings a `targets-selected` moment can name the source of. */
const NAMED_ACTION_KINDS = ["ability", "stratagem"] as const;
/** Unit-refs that can say who used a rule (event@16's subject values). */
const USED_SUBJECTS = ["this-unit", "this-model", "selected-unit", EVENT_SUBJECT, ANTECEDENT] as const;

/** A property that now also applies to more event kinds. */
function widenedKinds(property: Schema, kinds: readonly string[]): Schema {
  const only = property["x-only-when"] as { kind: string[] };
  return { ...property, "x-only-when": { kind: [...only.kind, ...kinds.filter((kind) => !only.kind.includes(kind))] } };
}

/** A named entity id, or a TypeError naming the key. */
export function namedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAMED_ID.test(value)) throw new TypeError(`${label} is a kebab-case ability, Stratagem, manoeuvre or action id.`);
  return value;
}

const EVENT_NAMED_USE: FamilyExtension = {
  // "When this model uses its Foo ability", "performs the Bar Agile Manoeuvre", "each time that
  // model Channels the Warp", "selected by a friendly X unit's Baz ability".
  family: "event",
  description: "As the previous version, plus id: which one was used (used with activity ability, manoeuvre, Stratagem or action: \"when this model uses its Foo ability\"; targets-selected with action_kind ability or stratagem); subject on used: who used it (this unit, this model, the selected or triggering unit, or an earlier leaf's unit), never with owner; action_kind ability: a unit was selected by another ability; and roll channelling: the Channel the Warp roll of a Psychic test.",
  schema: (previous) => withProperties(previous, {
    id: optional({ type: "string", pattern: NAMED_ID.source, "x-only-when": { kind: ["used", "targets-selected"] } }),
    subject: widenedKinds(properties(previous).subject!, ["used"]),
    action_kind: widenedEnum(previous, "action_kind", ["ability"]),
    roll: widenedEnum(previous, "roll", ["channelling"]),
  }),
  normalize: (input, previous) => {
    const { id, ...rest } = input;
    const kind = String(rest.kind);
    // Each new value is checked as a value the previous version knows, then put back.
    const restore: Record<string, unknown> = {};
    let staged: Record<string, unknown> = { ...rest };
    if (staged.roll === "channelling") {
      staged = { ...staged, roll: "psychic" };
      restore.roll = "channelling";
    }
    if (staged.action_kind === "ability") {
      if (kind !== "targets-selected") throw new TypeError("event.action_kind ability describes a targets-selected only: a unit selected by another ability.");
      staged = { ...staged, action_kind: "attack" };
      restore.action_kind = "ability";
    }
    if (kind === "used" && "subject" in staged) {
      if ("owner" in staged) throw new TypeError("event names who used a rule by subject or by owner, not both.");
      const { subject, ...withoutSubject } = staged;
      restore.subject = enumValue(subject, USED_SUBJECTS, "event.subject");
      staged = withoutSubject;
    }
    const normalized = { ...previous(staged), ...restore };
    if (id === undefined) return normalized;
    if (kind === "used") {
      if (!(NAMED_ACTIVITIES as readonly unknown[]).includes(normalized.activity)) throw new TypeError(`event.id names one ${NAMED_ACTIVITIES.join(", ")}; a ${String(normalized.activity)} is named only as a kind.`);
    } else if (kind === "targets-selected") {
      if (!(NAMED_ACTION_KINDS as readonly unknown[]).includes(normalized.action_kind)) throw new TypeError("event.id on targets-selected names the ability or Stratagem that selected; action_kind must be ability or stratagem.");
    } else {
      throw new TypeError("event.id applies only to used and targets-selected.");
    }
    return { ...normalized, id: namedId(id, "event.id") };
  },
};

export const FAMILY_EXTENSIONS_W8_NAMED: readonly FamilyExtension[] = [EVENT_NAMED_USE];
