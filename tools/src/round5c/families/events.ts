import { DESIGNATION_IDS, refuseListBuildingTag } from "../../translate/designations.js";
import { ANTECEDENT } from "../antecedent-families.js";
import { TRIGGER_ROLL_KINDS } from "../dice-families.js";
import { PHASE_EVENT_KINDS, PHASES, TURNS } from "../event-family.js";
import { EVENT_SUBJECT, type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumSet, enumValue } from "../family-validation.js";
import { NAMED_ID, PASSTHROUGH_USED_VALUES, namedId } from "./shared.js";
// Family schemas are immutable; later designation registrations cannot change event@32.
import eventV32Designations from "./event-v32-designations.json";

/**
 * Versions of the event family: the moments a rule happens at. Each version checks only its own
 * additions and hands the rest of a leaf to the previous version, so every earlier leaf still fits
 * it unchanged.
 */

const DESTRUCTION_RELATION: Schema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    unit: {
      type: "object",
      required: ["owner"],
      additionalProperties: false,
      properties: {
        owner: { enum: ["friendly", "enemy", "any"] },
        all_of: optional({ type: "array", minItems: 1, uniqueItems: true, items: KEYWORD_ITEMS }),
        within: optional({
          type: "object",
          required: ["inches", "of"],
          additionalProperties: false,
          properties: {
            inches: { type: "number", exclusiveMinimum: 0 },
            of: { enum: ["this-model", "this-unit"] },
          },
        }),
      },
    },
    model: {
      type: "object",
      required: ["owner"],
      additionalProperties: false,
      properties: {
        owner: { enum: ["friendly", "enemy", "any"] },
        all_of: optional({ type: "array", minItems: 1, uniqueItems: true, items: KEYWORD_ITEMS }),
        within: optional({
          type: "object",
          required: ["inches", "of"],
          additionalProperties: false,
          properties: {
            inches: { type: "number", exclusiveMinimum: 0 },
            of: { enum: ["this-model", "this-unit"] },
          },
        }),
      },
    },
  },
};

function destructionRelation(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must name unit and/or model destruction.`);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length === 0 || Object.keys(input).some((key) => key !== "unit" && key !== "model")) throw new TypeError(`${label} must contain only unit and/or model.`);
  const result: Record<string, unknown> = {};
  for (const kind of ["unit", "model"]) {
    if (input[kind] === undefined) continue;
    if (input[kind] === null || typeof input[kind] !== "object" || Array.isArray(input[kind])) throw new TypeError(`${label}.${kind} must be an object.`);
    const filter = input[kind] as Record<string, unknown>;
    if (Object.keys(filter).some((key) => key !== "owner" && key !== "all_of" && key !== "within")) throw new TypeError(`${label}.${kind} contains an unknown key.`);
    const owner = enumValue(filter.owner, ["friendly", "enemy", "any"], `${label}.${kind}.owner`);
    const within = filter.within;
    if (within !== undefined && (within === null || typeof within !== "object" || Array.isArray(within))) throw new TypeError(`${label}.${kind}.within must be an object.`);
    const proximity = within as Record<string, unknown> | undefined;
    if (proximity !== undefined && (Object.keys(proximity).length !== 2 || typeof proximity.inches !== "number" || proximity.inches <= 0 || !["this-model", "this-unit"].includes(String(proximity.of)))) throw new TypeError(`${label}.${kind}.within must contain positive inches and this-model or this-unit.`);
    result[kind] = {
      owner,
      ...(filter.all_of !== undefined ? { all_of: keywordList(filter.all_of, `${label}.${kind}.all_of`, 1) } : {}),
      ...(proximity !== undefined ? { within: { inches: proximity.inches, of: proximity.of } } : {}),
    };
  }
  return result;
}

const AFTER_ROLL_SUBJECTS = ["this-unit", "this-model", "selected-unit", EVENT_SUBJECT, ANTECEDENT] as const;

/** Who destroyed the unit ("each time this unit destroys an enemy unit"). */
const DESTROYERS = ["this-unit", "this-model", "selected-unit", ANTECEDENT] as const;

/** Kinds whose moment can name this unit or model as what it was done to. */
const OBJECT_KINDS = ["targets-selected", "damage-allocated"];

const EVENT_OBJECT: FamilyExtension = {
  // "Each time you target the bearer with a Stratagem", "each time an attack is allocated to the bearer".
  family: "event",
  version: 15,
  description: "As the previous version, plus object: this-unit or this-model is what the moment was done to (\"each time you target the bearer with a Stratagem\" = targets-selected, action_kind stratagem, owner friendly, object this-model; \"each time an attack is allocated to this model\" = damage-allocated, object this-model); and action_kind stratagem: a Stratagem's targets were selected.",
  schema: (previous) => withProperties(previous, {
    action_kind: widenedEnum(previous, "action_kind", ["stratagem"]),
    object: optional({ enum: ["this-unit", "this-model"], "x-only-when": { kind: OBJECT_KINDS } }),
  }),
  normalize: (input, previous) => {
    const { object, ...rest } = input;
    const normalized = rest.action_kind === "stratagem" ? standIn(rest, "action_kind", "attack", previous) : previous(rest);
    if (object === undefined) return normalized;
    if (!OBJECT_KINDS.includes(String(normalized.kind))) throw new TypeError(`event.object applies only to ${OBJECT_KINDS.join(", ")}.`);
    return { ...normalized, object: enumValue(object, ["this-unit", "this-model"], "event.object") };
  },
};

const EVENT_MODEL_DESTROYER: FamilyExtension = {
  // "Each time this model's unit destroys an enemy CHARACTER model", "destroyed as the result of an enemy unit's attacks".
  family: "event",
  version: 16,
  description: "As the previous version, plus by and object_owner on model-destroyed (who destroyed the model, and whose model it was), and by enemy: an enemy unit destroyed it.",
  schema: (previous) => {
    const props = properties(previous);
    const only = { kind: ["unit-destroyed", "model-destroyed"] };
    return withProperties(previous, {
      by: { ...widenedEnum(previous, "by", ["enemy"]), "x-only-when": only },
      object_owner: { ...props.object_owner!, "x-only-when": only },
    });
  },
  normalize: (input, previous) => {
    const model = input.kind === "model-destroyed" && ("by" in input || "object_owner" in input);
    const enemy = input.by === "enemy";
    const normalized = previous({ ...input, ...(model ? { kind: "unit-destroyed" } : {}), ...(enemy ? { by: "this-unit" } : {}) });
    return { ...normalized, ...(model ? { kind: "model-destroyed" } : {}), ...(enemy ? { by: "enemy" } : {}) };
  },
};

/** Where a set-up moment brings a unit from. */
export const SET_UP_SOURCES = ["strategic-reserves"] as const;

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

const EVENT_NAMED_USE: FamilyExtension = {
  // "When this model uses its Foo ability", "performs the Bar Agile Manoeuvre", "each time that
  // model Channels the Warp", "selected by a friendly X unit's Baz ability".
  family: "event",
  version: 18,
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

/** The Transport a disembarked moment leaves: the unit's own Transport, the only value the wording names. */
export const DISEMBARK_TRANSPORTS = ["this-unit"] as const;

/** The moments a roll names: a roll before it is made, or after it is made. */
const ROLL_MOMENTS = ["before-roll", "after-roll"] as const;

const EVENT_ROLLS: FamilyExtension = {
  // One leaf for a list of roll kinds; triggerLeaves() (compile-triggers.ts) lowers it to one trigger per kind.
  family: "event",
  version: 21,
  description: "As the previous version, plus rolls: two or more roll kinds one before-roll or after-roll moment covers (\"after making a Hit roll, Wound roll or saving throw\"), which lowers to one trigger per kind; the list takes only the kinds a DSL trigger can name (no any, all, attacks, surge or resource-die). A single roll is unchanged.",
  schema: (previous) => withProperties(previous, {
    rolls: optional({ type: "array", items: { enum: TRIGGER_ROLL_KINDS }, minItems: 2, uniqueItems: true, "x-only-when": { kind: ROLL_MOMENTS } }),
  }),
  normalize: (input, previous) => {
    if (!("rolls" in input)) {
      // A single roll keeps the previous version's whole enum (any, attacks, all, surge, …): a widening never
      // rejects a leaf the previous version accepted. Only the rolls list is limited to trigger-nameable kinds.
      return previous(input);
    }
    const { rolls, ...rest } = input;
    if (rest.roll !== undefined) throw new TypeError("event names roll or rolls, not both.");
    if (!ROLL_MOMENTS.includes(rest.kind as typeof ROLL_MOMENTS[number])) throw new TypeError("event.rolls applies to a before-roll or after-roll moment.");
    const kinds = enumSet(rolls, TRIGGER_ROLL_KINDS, "event.rolls");
    if (kinds.length < 2) throw new TypeError("event.rolls lists two or more roll kinds; a single kind is event.roll.");
    // The previous version checks kind and subject with one roll; the list replaces that roll afterwards.
    const { roll: _roll, ...normalized } = previous({ ...rest, roll: kinds[0] });
    return { ...normalized, rolls: kinds };
  },
};

/**
 * Destroyer filter after a destruction, in two versions (event@23 and unit-activity@18):
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
  version: 23,
  description: "As the previous version, plus action_kind fight on attacks-resolved: the moment a unit's attacks in a fight have been resolved (lowers to the fight attack-resolved filter, not attack, which would also cover shooting).",
  schema: (previous) => withProperties(previous, { action_kind: widenedEnum(previous, "action_kind", ["fight"]) }),
  normalize: (input, previous) => {
    if (input.action_kind !== "fight") return previous(input);
    if (input.kind !== "attacks-resolved") throw new TypeError("event.action_kind fight applies only to attacks-resolved.");
    return standIn(input, "action_kind", "attack", previous);
  },
};

const ATTACK_TYPES_DAMAGE = ["ranged", "melee", "any"] as const;

const EVENT_DAMAGE_ATTACK_TYPE: FamilyExtension = {
  family: "event",
  version: 24,
  description: "As the previous version, plus attack_type on damage-allocated: the allocated attack is ranged, melee or any. Lowers to an attack-is condition on the trigger; any adds none.",
  schema: (previous) => withProperties(previous, {
    attack_type: optional({ enum: [...ATTACK_TYPES_DAMAGE], "x-only-when": { kind: ["damage-allocated"] } }),
  }),
  normalize: (input, previous) => {
    if (!("attack_type" in input)) return previous(input);
    const { attack_type: attackType, ...rest } = input;
    if (rest.kind !== "damage-allocated") throw new TypeError("event.attack_type applies only to a damage-allocated moment.");
    if (!ATTACK_TYPES_DAMAGE.includes(attackType as typeof ATTACK_TYPES_DAMAGE[number])) throw new TypeError("event.attack_type is ranged, melee or any.");
    return { ...previous(rest), attack_type: attackType };
  },
};

const EVENT_OBJECT_KEYWORDS: FamilyExtension = {
  family: "event",
  version: 26,
  description: "As the previous version, plus object_keywords on model-destroyed: the destroyed model carries these unit keywords (needs object_owner, whose model it was).",
  schema: (previous) => withProperties(previous, {
    object_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { kind: ["model-destroyed"] } }),
  }),
  normalize: (input, previous) => {
    if (!("object_keywords" in input)) return previous(input);
    if (input.kind !== "model-destroyed") throw new TypeError("event.object_keywords applies only to model-destroyed.");
    if (input.object_owner === undefined) throw new TypeError("event.object_keywords needs object_owner: whose model was destroyed.");
    const { object_keywords: keywords, ...rest } = input;
    return { ...previous(rest), object_keywords: keywordList(keywords, "event.object_keywords", 1) };
  },
};

/** What a resource-spent moment can be done for: the same activities a used moment names. */
export const SPEND_ACTIVITIES = ["stratagem", "ability", "action", "manoeuvre", "order", "ritual", "dark-pact", "act-of-faith", "doctrine", "contract"] as const;

/** The unit a spend serves: this unit, or the unit an earlier leaf named. */
export const SPEND_OBJECTS = ["this-unit", ANTECEDENT] as const;

const SPEND_KINDS = ["resource-spent"] as const;

/** The kinds a key already applies to, plus resource-spent. */
function withSpendKinds(schema: Schema): string[] {
  const kinds = ((schema["x-only-when"] as { kind: string[] }).kind);
  return kinds.includes("resource-spent") ? kinds : [...kinds, ...SPEND_KINDS];
}

function spendTag(tag: unknown): string {
  if (typeof tag !== "string" || !DESIGNATION_IDS.has(tag)) throw new TypeError("event.tag on a resource-spent must be a registered designation id.");
  refuseListBuildingTag(tag, "event.tag");
  return tag;
}

export const EVENT_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "each time that unit makes a Normal, Advance or Fall Back move": whose move it is.
    family: "event",
    version: 10,
    description: "As the previous version, plus an optional subject for a moment a unit makes (move-ended, selected, targets-selected, attacks-resolved, set-up): this unit (the default), this model, the selected unit, the triggering unit, or an earlier leaf's unit (antecedent). A subject and an owner never go together.",
    schema: (previous) => withProperties(previous, {
      subject: optional({ enum: ["this-unit", "this-model", "selected-unit", EVENT_SUBJECT, ANTECEDENT], "x-only-when": { kind: ["move-ended", "selected", "targets-selected", "attacks-resolved", "set-up"] } }),
    }),
    normalize: (input, previous) => {
      if (!("subject" in input)) return previous(input);
      const { subject, ...rest } = input;
      const normalized = previous(rest);
      if (!["move-ended", "selected", "targets-selected", "attacks-resolved", "set-up"].includes(String(normalized.kind))) {
        throw new TypeError(`event.subject does not apply to kind ${String(normalized.kind)}.`);
      }
      if ("owner" in normalized) throw new TypeError("event names its unit by subject or by owner, not both.");
      return { ...normalized, subject: enumValue(subject, ["this-unit", "this-model", "selected-unit", EVENT_SUBJECT, ANTECEDENT], "event.subject") };
    },
  },
  {
    // "in the Battle-shock step of your opponent's Command phase", "when your opponent uses a
    // Stratagem", "each time that unit fails a Battle-shock test".
    family: "event",
    version: 11,
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
  {
    // "each time this unit destroys an enemy unit", "when this unit is selected to attack".
    family: "event",
    version: 12,
    description: "As the previous version, plus by: the unit that destroyed the unit (unit-destroyed), with object_owner saying whose unit was destroyed; and selected can be to attack (to shoot or to fight).",
    schema: (previous) => withProperties(previous, {
      to: widenedEnum(previous, "to", ["attack"]),
      by: optional({ enum: DESTROYERS, "x-only-when": { kind: ["unit-destroyed"] } }),
      object_owner: optional({ enum: ["friendly", "enemy"], "x-only-when": { kind: ["unit-destroyed"] } }),
    }),
    normalize: (input, previous) => {
      const { by, object_owner: objectOwner, ...rest } = input;
      const added: Record<string, unknown> = {};
      if ("by" in input || "object_owner" in input) {
        if (rest.kind !== "unit-destroyed") throw new TypeError("event.by and event.object_owner describe a unit-destroyed only.");
        if ("by" in input) added.by = enumValue(by, DESTROYERS, "event.by");
        if ("object_owner" in input) added.object_owner = enumValue(objectOwner, ["friendly", "enemy"], "event.object_owner");
      }
      const normalized = rest.kind === "selected" && rest.to === "attack" ? standIn(rest, "to", "shoot", previous) : previous(rest);
      return { ...normalized, ...added };
    },
  },
  {
    // "At the start of this unit's move", "just before it Consolidates": the DSL's move-started.
    family: "event",
    version: 13,
    description: "As the previous version, plus move-started: a unit starts a move (with move_types, owner and subject as move-ended takes them).",
    schema: (previous) => withProperties(previous, { kind: widenedEnum(previous, "kind", ["move-started"]) }),
    normalize: (input, previous) => input.kind === "move-started" ? standIn(input, "kind", "move-ended", previous) : previous(input),
  },
  {
    // "At the start or end of this unit's move": one leaf, either moment.
    family: "event",
    version: 14,
    description: "As the previous version, plus also: the other end of the same move (move-started with also move-ended, or the reverse), so \"at the start or end of this unit's move\" is one leaf that fires at either moment.",
    schema: (previous) => withProperties(previous, { also: optional({ enum: ["move-started", "move-ended"], "x-only-when": { kind: ["move-started", "move-ended"] } }) }),
    normalize: (input, previous) => {
      if (input.also === undefined) return previous(input);
      const { also, ...rest } = input;
      const other = enumValue(also, ["move-started", "move-ended"], "event.also");
      if (!["move-started", "move-ended"].includes(String(rest.kind)) || rest.kind === other) throw new TypeError("event.also names the other end of a move-started or move-ended moment.");
      return { ...previous(rest), also: other };
    },
  },
  EVENT_OBJECT,
  EVENT_MODEL_DESTROYER,
  /**
   * The set-up moment's source.
   */
  {
    // "Enemy units that are set up on the battlefield from Reserves" (or "as Reinforcements").
    family: "event",
    version: 17,
    description: "As the previous version, plus from on a set-up moment: strategic-reserves (\"set up … from Reserves\", \"set up … as Reinforcements\", \"arrive on the battlefield from Reserves\").",
    schema: (previous) => withProperties(previous, { from: optional({ enum: [...SET_UP_SOURCES], "x-only-when": { kind: ["set-up"] } }) }),
    normalize: (input, previous) => {
      if (input.from === undefined) return previous(input);
      const { from, ...rest } = input;
      if (rest.kind !== "set-up") throw new TypeError("event.from names where a set-up moment brings the unit from; kind must be set-up.");
      if (!(SET_UP_SOURCES as readonly unknown[]).includes(from)) throw new TypeError(`event.from is one of ${SET_UP_SOURCES.join(", ")}.`);
      return { ...previous(rest), from };
    },
  },
  /**
   * A named ability, manoeuvre, Stratagem or action being used: which one was used, and who used
   * it.
   */
  EVENT_NAMED_USE,
  /**
   * Opponent Stratagem targeting: a targets-selected moment can name the unit it was done to as the
   * antecedent of an earlier leaf ("chosen by a Gadget", "picked for a Gadget") and an owner of any
   * player (owner any).
   */
  {
    // "chosen by a Gadget", "picked for a Gadget": the unit as the moment's object.
    family: "event",
    version: 19,
    description: "As the previous version, plus, for targets-selected only: object antecedent (the unit an earlier leaf named is the one selected as the target), and owner any (any player's unit, for wording that names no owner).",
    schema: (previous) => withProperties(previous, {
      object: widenedEnum(previous, "object", [ANTECEDENT]),
      owner: widenedEnum(previous, "owner", ["any"]),
    }),
    normalize: (input, previous) => {
      const antecedent = input.object === ANTECEDENT;
      const any = input.owner === "any";
      if (!antecedent && !any) return previous(input);
      if (input.kind !== "targets-selected") throw new TypeError("event.object antecedent and event.owner any describe a targets-selected only.");
      // Each new value is checked as the value the previous version knows, then put back.
      const staged = { ...input, ...(antecedent ? { object: "this-unit" } : {}), ...(any ? { owner: "friendly" } : {}) };
      const normalized = previous(staged);
      return { ...normalized, ...(antecedent ? { object: ANTECEDENT } : {}), ...(any ? { owner: "any" } : {}) };
    },
  },
  /**
   * Disembark moments: which Transport a unit disembarked from ("disembarks from this model", "from
   * this TRANSPORT", "from the bearer").
   */
  {
    // "Each time a unit disembarks from this model": the Transport the moment leaves.
    family: "event",
    version: 20,
    description: "As the previous version, plus transport on a disembarked moment: the Transport the unit disembarked from (this-unit, \"disembarks from this model\" or \"from this TRANSPORT\"). Never with subject or owner.",
    schema: (previous) => withProperties(previous, {
      transport: optional({ enum: [...DISEMBARK_TRANSPORTS], "x-only-when": { kind: ["disembarked"] } }),
    }),
    normalize: (input, previous) => {
      if (!("transport" in input)) return previous(input);
      const { transport, ...rest } = input;
      if (rest.kind !== "disembarked") throw new TypeError("event.transport names the Transport a disembarked moment leaves; kind must be disembarked.");
      if (!(DISEMBARK_TRANSPORTS as readonly unknown[]).includes(transport)) throw new TypeError(`event.transport is one of ${DISEMBARK_TRANSPORTS.join(", ")}.`);
      return { ...previous(rest), transport };
    },
  },
  /**
   * Multi-roll events: one moment over a list of roll kinds ("after making a Hit roll, Wound roll
   * or saving throw").
   */
  EVENT_ROLLS,
  {
    family: "event",
    version: 22,
    description: "As the previous version, and an attacks-resolved moment may name the phase and whose turn it is (\"in your opponent's Shooting phase\"), lowered to the trigger's condition.",
    schema: (previous) => {
      const props = properties(previous);
      if (!props.phase || !props.turn) throw new Error("event schema has no phase or turn to widen.");
      const kinds = [...PHASE_EVENT_KINDS, "attacks-resolved"];
      return withProperties(previous, {
        phase: { ...props.phase, "x-only-when": { kind: kinds } },
        turn: { ...props.turn, "x-only-when": { kind: kinds } },
      });
    },
    normalize: (input, previous) => {
      if (input.kind !== "attacks-resolved" || (!("phase" in input) && !("turn" in input))) return previous(input);
      const { phase, turn, ...rest } = input;
      const canonical = previous(rest);
      return {
        ...canonical,
        ...(phase !== undefined ? { phase: enumValue(phase, PHASES, "event.phase") } : {}),
        ...(turn !== undefined ? { turn: enumValue(turn, TURNS, "event.turn") } : {}),
      };
    },
  },
  EVENT_FIGHT,
  /**
   * attack_type on damage-allocated ("each time a ranged attack is allocated to a model"). Lowers
   * to an attack-is condition on the trigger (compile-triggers.ts trigger).
   */
  EVENT_DAMAGE_ATTACK_TYPE,
  {
    // "…, but if it does, after it has moved, …": the moment's move passed through the named terrain.
    family: "event",
    version: 25,
    description: "As the previous version, plus through on a move-ended moment: the move passed through the named terrain. Written by the move-passthrough-used fold, not authored directly.",
    schema: (previous) => withProperties(previous, {
      through: { enum: PASSTHROUGH_USED_VALUES, "x-optional": true, "x-only-when": { kind: ["move-ended"] } },
    }),
    normalize: (input, previous) => {
      if (!("through" in input)) return previous(input);
      if (input.kind !== "move-ended") throw new TypeError("event.through describes a move-ended moment only.");
      // The previous version rejects keys it does not know, so the new one is checked and removed first.
      const { through, ...rest } = input;
      return { ...previous(rest), through: enumValue(through, PASSTHROUGH_USED_VALUES, "event.through") };
    },
  },
  /**
   * object_keywords on model-destroyed. "When this unit destroys a **Character** model" names the
   * destroyed model's keywords after the event; with object_owner it lowers to the trigger's object
   * `{owner, all_of, level: model}`. The keywords need the owner, so the object is whole.
   */
  EVENT_OBJECT_KEYWORDS,
  /**
   * Purpose-qualified spends: "when you spend 1 Foo token to Empower a friendly unit", "spend a Bar
   * token to enable this unit to perform a Baz Manoeuvre". A resource-spent moment can name what
   * the spend was for: activity (an activity the spend enables) or tag (a designation the spend
   * applies), not both, and object (the unit it serves). Lowered to the trigger's filter.kind,
   * filter.tag and object (compile-triggers.ts).
   */
  {
    family: "event",
    version: 27,
    description: "As the previous version, plus, for resource-spent only: activity (the activity the spend enables, e.g. a manoeuvre) or tag (the designation the spend applies, e.g. empowered), not both, and object (this-unit, or antecedent: the unit an earlier leaf named) for the unit the spend serves.",
    schema: (previous) => {
      const props = properties(previous);
      return withProperties(previous, {
        // Optional for the samplers: a resource-spent names at most one of them, and a used or designation moment still refuses it absent.
        activity: optional({ ...props.activity!, "x-only-when": { kind: withSpendKinds(props.activity!) } }),
        tag: optional({ ...props.tag!, "x-only-when": { kind: withSpendKinds(props.tag!) } }),
        object: { ...props.object!, "x-only-when": { kind: withSpendKinds(props.object!) } },
      });
    },
    normalize: (input, previous) => {
      const { activity, tag, object, ...rest } = input;
      const named = activity !== undefined || tag !== undefined || object !== undefined;
      // Another kind keeps the previous version's rules for these keys.
      if (input.kind !== "resource-spent" || !named) return previous(input);
      if (activity !== undefined && tag !== undefined) throw new TypeError("event resource-spent names what the spend is for by activity or by tag, not both.");
      const canonical = previous(rest);
      return {
        ...canonical,
        ...(activity !== undefined ? { activity: enumValue(activity, SPEND_ACTIVITIES, "event.activity") } : {}),
        ...(tag !== undefined ? { tag: spendTag(tag) } : {}),
        ...(object !== undefined ? { object: enumValue(object, SPEND_OBJECTS, "event.object") } : {}),
      };
    },
  },
  {
    // Army selection is a real game event, not a display-only trigger alias.
    family: "event",
    version: 28,
    description: "As the previous version, plus army-selected: the army selection event emitted by the game clock.",
    schema: (previous) => withProperties(previous, { kind: widenedEnum(previous, "kind", ["army-selected"]) }),
    normalize: (input, previous) => input.kind === "army-selected"
      ? standIn(input, "kind", "battle-started", previous)
      : previous(input),
  },
  {
    family: "event",
    version: 29,
    description: "As the previous version, plus attack_type on model-destroyed: the attack that destroyed the event's model has that classification; any adds no classification restriction.",
    schema: (previous) => withProperties(previous, {
      attack_type: optional({ enum: ["ranged", "melee", "any"], "x-only-when": { kind: ["damage-allocated", "model-destroyed"] } }),
    }),
    normalize: (input, previous) => {
      if (input.kind !== "model-destroyed" || input.attack_type === undefined) return previous(input);
      const { attack_type: attackType, ...rest } = input;
      return { ...previous(rest), attack_type: enumValue(attackType, ["ranged", "melee", "any"], "event.attack_type") };
    },
  },
  {
    // A used ability can be qualified by the source definitions and cadence named by the rule.
    // `bind_as` supplies the exact event identity consumed by an ability-modifier effect.
    family: "event",
    version: 30,
    description: "As the previous version, plus source, bind_as and usage on a used ability moment: source lists the ability definitions (unit for a datasheet ability, enhancement for an Enhancement ability), usage is its once-per-battle cadence, and bind_as names the exact used event for a following ability-modifier.",
    schema: (previous) => withProperties(previous, {
      source: optional({
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { enum: ["unit", "enhancement"] },
        "x-only-when": { kind: ["used"] },
      }),
      bind_as: optional({
        type: "string",
        pattern: "^[a-z][a-z0-9_-]*$",
        minLength: 1,
        "x-only-when": { kind: ["used"] },
      }),
      usage: optional({
        type: "object",
        required: ["frequency", "count"],
        additionalProperties: false,
        properties: {
          frequency: { const: "n-per-battle" },
          count: { const: 1 },
        },
        "x-only-when": { kind: ["used"] },
      }),
    }),
    normalize: (input, previous) => {
      const qualified = input.kind === "used" && (input.source !== undefined || input.bind_as !== undefined || input.usage !== undefined);
      if (!qualified) return previous(input);
      if (input.activity !== "ability") throw new TypeError("event source, bind_as and usage qualify a used ability, not another used activity.");
      const { source, bind_as: bindAs, usage, ...rest } = input;
      const normalized = previous(rest);
      return {
        ...normalized,
        ...(source !== undefined ? { source: enumSet(source, ["unit", "enhancement"], "event.source") } : {}),
        ...(bindAs !== undefined ? { bind_as: enumValue(bindAs, ["used-ability"], "event.bind_as") } : {}),
        ...(usage !== undefined ? { usage: (() => {
          if (usage === null || typeof usage !== "object" || Array.isArray(usage)) throw new TypeError("event.usage must be {frequency: \"n-per-battle\", count: 1}.");
          const value = usage as Record<string, unknown>;
          if (Object.keys(value).length !== 2) throw new TypeError("event.usage must contain only frequency and count.");
          if (value.frequency !== "n-per-battle" || value.count !== 1) throw new TypeError("event.usage must be {frequency: \"n-per-battle\", count: 1}.");
          return { frequency: "n-per-battle", count: 1 };
        })() } : {}),
      };
    },
  },
  {
    family: "event",
    version: 31,
    description: "As the previous version, plus source-reviewed event identity and qualifiers: bind_as on non-use events; mortal/psychic attack classification; Psychic ability use targeting a unit; before-removal destruction timing; and a destroyed designated unit. These fields preserve exact event identity and never infer causation from a shared actor.",
    schema: (previous) => withProperties(previous, {
      attack_type: optional({
        enum: ["ranged", "melee", "psychic", "mortal", "any"],
        "x-only-when": { kind: ["damage-allocated", "model-destroyed", "attacks-resolved"] },
      }),
      ability_keyword: optional({
        enum: ["psychic"],
        "x-only-when": { kind: ["used"] },
      }),
      targets_level: optional({
        enum: ["unit"],
        "x-only-when": { kind: ["used"] },
      }),
      timing: optional({
        enum: ["before-removal"],
        "x-only-when": { kind: ["unit-destroyed", "model-destroyed"] },
      }),
      object_designated: optional({
        enum: DESIGNATION_IDS,
        "x-only-when": { kind: ["unit-destroyed"] },
      }),
      same_subject_targeted: optional({
        enum: ["stratagem-target"],
        "x-only-when": { kind: ["attacks-resolved"] },
      }),
      channelled: optional({
        const: true,
        "x-only-when": { kind: ["after-roll"] },
      }),
      before_resolving_activity: optional({
        enum: ["ritual"],
        "x-only-when": { kind: ["after-roll"] },
      }),
      bind_as: optional({
        type: "string",
        pattern: "^[a-z][a-z0-9_-]*$",
        minLength: 1,
        "x-only-when": { kind: ["used", "attacks-resolved", "resource-gained", "after-roll"] },
      }),
    }),
    normalize: (input, previous) => {
      const { attack_type: attackType, ability_keyword: abilityKeyword, targets_level: targetsLevel, timing, object_designated: objectDesignated, bind_as: bindAs, same_subject_targeted: sameSubjectTargeted, channelled, before_resolving_activity: beforeResolvingActivity, ...rest } = input;
      const kind = String(input.kind);
      const newAttackType = attackType === "psychic" || attackType === "mortal" || (kind === "attacks-resolved" && attackType !== undefined);
      const nonUseBinding = bindAs !== undefined && kind !== "used";
      const staged = {
        ...rest,
        ...(attackType !== undefined && !newAttackType ? { attack_type: attackType } : {}),
        ...(bindAs !== undefined && !nonUseBinding ? { bind_as: bindAs } : {}),
      };
      const normalized = previous(staged);
      if (attackType !== undefined) {
        const value = enumValue(attackType, ["ranged", "melee", "psychic", "mortal", "any"], "event.attack_type");
        if (!["damage-allocated", "model-destroyed", "attacks-resolved"].includes(kind)) throw new TypeError("event.attack_type qualifies allocated damage, a destroyed model, or resolved attacks.");
        normalized.attack_type = value;
      }
      if (abilityKeyword !== undefined || targetsLevel !== undefined) {
        if (kind !== "used" || normalized.activity !== "ability") throw new TypeError("event ability_keyword and targets_level qualify a used ability.");
        if (abilityKeyword !== undefined) normalized.ability_keyword = enumValue(abilityKeyword, ["psychic"], "event.ability_keyword");
        if (targetsLevel !== undefined) normalized.targets_level = enumValue(targetsLevel, ["unit"], "event.targets_level");
      }
      if (timing !== undefined) {
        if (!["unit-destroyed", "model-destroyed"].includes(kind)) throw new TypeError("event.timing before-removal qualifies a destruction.");
        normalized.timing = enumValue(timing, ["before-removal"], "event.timing");
      }
      if (objectDesignated !== undefined) {
        if (kind !== "unit-destroyed") throw new TypeError("event.object_designated qualifies a destroyed unit.");
        normalized.object_designated = enumValue(objectDesignated, DESIGNATION_IDS as unknown as readonly string[], "event.object_designated");
      }
      if (sameSubjectTargeted !== undefined) {
        if (kind !== "attacks-resolved") throw new TypeError("event.same_subject_targeted qualifies resolved attacks.");
        normalized.same_subject_targeted = enumValue(sameSubjectTargeted, ["stratagem-target"], "event.same_subject_targeted");
      }
      if (channelled !== undefined || beforeResolvingActivity !== undefined) {
        if (kind !== "after-roll" || normalized.roll !== "psychic") throw new TypeError("event channelled and before_resolving_activity qualify an after-Psychic-test moment.");
        if (channelled !== undefined && channelled !== true) throw new TypeError("event.channelled must be true.");
        if (channelled !== undefined) normalized.channelled = true;
        if (beforeResolvingActivity !== undefined) normalized.before_resolving_activity = enumValue(beforeResolvingActivity, ["ritual"], "event.before_resolving_activity");
      }
      if (nonUseBinding) {
        if (!/^[a-z][a-z0-9_-]*$/.test(String(bindAs))) throw new TypeError("event.bind_as must be a lower-case event variable.");
        normalized.bind_as = String(bindAs);
      }
      return normalized;
    },
  },
  {
    family: "event",
    version: 32,
    description: "As the previous version, plus exact same-actor targeting, same-test Ritual ordering, and exact caused-by/causes destruction relations. A union destruction is one source event with unit/model alternatives. This version also repairs designation validation without rewriting event@31.",
    schema: (previous) => withProperties(previous, {
      kind: widenedEnum(previous, "kind", ["unit-or-model-destroyed"]),
      object_designated: optional({
        enum: eventV32Designations,
        "x-only-when": { kind: ["unit-destroyed"] },
      }),
      same_subject_targeted: optional({
        enum: ["stratagem-target"],
        "x-only-when": { kind: ["attacks-resolved"] },
      }),
      channelled: optional({
        const: true,
        "x-only-when": { kind: ["after-roll"] },
      }),
      before_resolving_activity: optional({
        enum: ["ritual"],
        "x-only-when": { kind: ["after-roll"] },
      }),
      caused_by_destruction: {
        ...optional(DESTRUCTION_RELATION),
        "x-only-when": { kind: ["resource-gained"] },
      },
      causes_destruction: {
        ...optional(DESTRUCTION_RELATION),
        "x-only-when": { kind: ["attacks-resolved"] },
      },
    }),
    normalize: (input, previous) => {
      const {
        object_designated: objectDesignated,
        same_subject_targeted: sameSubjectTargeted,
        channelled,
        before_resolving_activity: beforeResolvingActivity,
        caused_by_destruction: causedByDestruction,
        causes_destruction: causesDestruction,
        ...rest
      } = input;
      const kind = String(input.kind);
      const unionDestruction = kind === "unit-or-model-destroyed";
      const normalized = previous({ ...rest, ...(unionDestruction ? { kind: "model-destroyed" } : {}) });
      if (unionDestruction) normalized.kind = "unit-or-model-destroyed";
      if (objectDesignated !== undefined) {
        if (kind !== "unit-destroyed") throw new TypeError("event.object_designated qualifies a destroyed unit.");
        normalized.object_designated = enumValue(objectDesignated, eventV32Designations, "event.object_designated");
      }
      if (sameSubjectTargeted !== undefined) {
        if (kind !== "attacks-resolved") throw new TypeError("event.same_subject_targeted qualifies resolved attacks.");
        normalized.same_subject_targeted = enumValue(sameSubjectTargeted, ["stratagem-target"], "event.same_subject_targeted");
      }
      if (channelled !== undefined || beforeResolvingActivity !== undefined) {
        if (kind !== "after-roll" || normalized.roll !== "psychic") throw new TypeError("event channelled and before_resolving_activity qualify an after-Psychic-test moment.");
        if (channelled !== undefined && channelled !== true) throw new TypeError("event.channelled must be true.");
        if (channelled !== undefined) normalized.channelled = true;
        if (beforeResolvingActivity !== undefined) normalized.before_resolving_activity = enumValue(beforeResolvingActivity, ["ritual"], "event.before_resolving_activity");
      }
      if (causedByDestruction !== undefined || causesDestruction !== undefined) {
        if (normalized.bind_as === undefined) throw new TypeError("An exact destruction relation requires bind_as.");
        if (causedByDestruction !== undefined) {
          if (kind !== "resource-gained") throw new TypeError("event.caused_by_destruction qualifies a resource-gained event.");
          normalized.caused_by_destruction = destructionRelation(causedByDestruction, "event.caused_by_destruction");
        }
        if (causesDestruction !== undefined) {
          if (kind !== "attacks-resolved") throw new TypeError("event.causes_destruction qualifies an attacks-resolved event.");
          normalized.causes_destruction = destructionRelation(causesDestruction, "event.causes_destruction");
        }
      }
      return normalized;
    },
  },
];
