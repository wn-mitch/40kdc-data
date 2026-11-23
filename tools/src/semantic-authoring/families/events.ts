import { ANTECEDENT } from "../antecedent-families.js";
import { booleanValue, enumSet, enumValue, exactKeys } from "../family-validation.js";
import { DESIGNATION_IDS, refuseListBuildingTag } from "../../translate/designations.js";
import type { FlatFamily } from "./types.js";

/**
 * Moments and the history conditions bound to them: event, history-window, ability-use-history,
 * ability-selection-override, army-state, targeted and hit-by-attacks.
 */

type Schema = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// event
// ---------------------------------------------------------------------------------------------

const EVENT_KINDS = [
  "charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end", "after-shooting", "selected-to-shoot", "selected-to-fight",
  "enemy-selected-targets", "enemy-ended-move", "enemy-has-shot", "enemy-declared-charge", "this-model-destroyed", "battle-started",
  "deployment-ended", "round-ended", "turn-ended", "step-started", "disembarked", "before-roll", "damage-allocated", "used", "state-changed",
  "designation-changed", "designation-resolved", "after-roll", "battle-formations-declared", "marker-removed", "objective-gained",
  "resource-gained", "resource-spent", "move-ended", "selected", "targets-selected", "attacks-resolved", "set-up", "move-started",
  "army-selected", "unit-or-model-destroyed",
] as const;
const PHASES = ["command", "movement", "shooting", "charge", "fight", "any"] as const;
const TURNS = ["your", "opponent", "either"] as const;
const STEPS = ["battle-shock", "reinforcements"] as const;
/** What a used moment, or the spend a resource-spent moment enables, can be. */
const ACTIVITIES = ["stratagem", "ability", "action", "manoeuvre", "order", "ritual", "dark-pact", "act-of-faith", "doctrine", "contract"] as const;
/** Activities a used moment can name one member of by id; the rest are named only as a kind. */
const NAMED_ACTIVITIES = ["ability", "manoeuvre", "stratagem", "action"] as const;
const CHANGED_STATES = ["engaged", "battle-shocked", "embarked", "in-strategic-reserves", "on-battlefield", "hidden", "fights-first", "benefit-of-cover"] as const;
/** The strength thresholds a unit can fall past, in place of a state. */
const STRENGTHS = ["below-half", "below-starting"] as const;
/** A single roll a before-roll or after-roll moment names. */
const ROLLS = [
  "hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage", "attacks", "psychic", "surge", "hazard", "any",
  "resource-die", "blessings-of-khorne", "desperate-escape", "deadly-demise", "all", "channelling",
] as const;
/** The roll kinds a DSL trigger can name: the only kinds a rolls list takes. */
const TRIGGER_ROLLS = [
  "hit", "wound", "save", "damage", "charge", "advance", "battle-shock", "leadership", "hazard", "psychic", "desperate-escape",
  "blessings-of-khorne", "deadly-demise", "channelling",
] as const;
const MOVE_TYPES = ["normal", "advance", "fall-back", "charge", "pile-in", "consolidation", "surge", "scout", "ingress", "disembark", "embark", "pulse-jet"] as const;
const SELECTED_TO = ["move", "shoot", "fight", "charge", "attack"] as const;
const DISEMBARK_MODES = ["rapid", "tactical", "combat", "emergency", "assault", "shock"] as const;
/** Who made a moment, or who used a rule or made a roll. */
const SUBJECTS = ["this-unit", "this-model", "selected-unit", "event-subject", ANTECEDENT] as const;
/** Who destroyed the unit or model; enemy is any enemy unit. */
const DESTROYERS = ["this-unit", "this-model", "selected-unit", ANTECEDENT, "enemy"] as const;
const OBJECT_OWNERS = ["friendly", "enemy"] as const;
/**
 * When a destruction moment resolves: before the destroyed model is removed, or before its Deadly
 * Demise roll ("just after … is destroyed, before making its Deadly Demise roll"), which is made
 * before it is removed.
 */
const DESTRUCTION_TIMINGS = ["before-removal", "before-deadly-demise"] as const;
/** A move that ends near markers resolves before those markers are removed ("before removing those markers"). */
const MOVE_TIMINGS = ["before-marker-removal"] as const;
/** Who changed a unit's strength: the unit whose attacks did it. */
const STATE_CAUSES = ["this-unit", "this-model", "selected-unit", ANTECEDENT] as const;
const ATTACK_TYPES = ["ranged", "melee", "psychic", "mortal", "any"] as const;
const FILTERED_UNITS = "filtered-units";
const SPEND_FOR = ["used", "resource-spent"] as const;
/** The objects each kind that takes one accepts. */
const OBJECTS: Readonly<Record<string, readonly string[]>> = {
  "targets-selected": ["this-unit", "this-model", ANTECEDENT, "selected-unit"],
  "damage-allocated": ["this-unit", "this-model", "selected-unit"],
  "resource-spent": ["this-unit", ANTECEDENT, "selected-unit"],
  used: ["this-unit", "this-model", FILTERED_UNITS, "selected-unit"],
};
/** The action kinds each kind that takes one accepts. */
const ACTION_KINDS: Readonly<Record<string, readonly string[]>> = {
  "targets-selected": ["charge", "shoot", "attack", "stratagem", "ability"],
  "attacks-resolved": ["charge", "shoot", "attack", "stratagem", "fight"],
};
const BINDING = /^[a-z][a-z0-9_-]*$/u;
/** The kinds whose exact event a later leaf can name (bind_as); a used moment only when it names an ability. */
const BINDABLE_KINDS = ["used", "attacks-resolved", "resource-gained", "before-roll", "after-roll"] as const;
const NAMED_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
const DESIGNATION_PATTERN = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
/** A keyword printed after one apostrophe ('ARDMOB): the apostrophe, then a keyword starting with a capital. */
const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;

/** The designations a destroyed unit can carry (object_designated). */
const OBJECT_DESIGNATIONS = [
  "a-trap-well-laid", "acquisition", "affected-by-order", "afflicted", "aflame", "analysed", "assailed", "assemblage-of-might",
  "auspex-scanned", "bastion-shield-yp-spent", "battle-shock-auto-succeed", "bio-stimulus-target", "blessed", "blight-bombardment-target",
  "bloody-vengeance", "bondsman-affected", "breaching-fire-target", "busted", "chronosorcerous-bleed", "claw-of-ascension-crossfire-target",
  "claw-of-ascension-priority-target", "claw-of-ascension-survey-augur-target", "cleansed", "condemned", "conqueror-imperative-active",
  "consecrated", "contract-unit", "corrupted", "counterstrategist-target", "covered-in-squigs", "cyberstimm-infusion-yp-spent",
  "daring-recon-target", "death-begets-vengeance-hated", "decoyed", "designated", "detected", "disrupted", "dreadherder-target", "dual-melee",
  "eliminate-at-all-costs", "empowered", "enfeebled", "enhancement-expended", "ensnared", "entrenched", "exposed-flaws-yp-spent",
  "eye-of-spite-pain-spent", "favoured-champions", "flame-wreathed", "focus-of-hatred", "grav-pinned", "grounded", "guidance-of-the-ancients",
  "guidance-of-the-ancients-crowes-sanctifiers", "guided", "hated-foe", "held", "hidden", "honour-of-the-hold-yp-spent", "hunted", "illuminated",
  "infested-with-snotlings", "instinctive-spite-pain-spent", "losing-the-wager", "machine-vengeance-target", "malevolent", "mark", "marked",
  "marked-prey", "mutated", "nethershriek-mind-eater", "no-benefit-of-cover", "nulled", "oath-fulfilled", "oath-of-moment", "oath-of-moment-target",
  "observer", "octagram-battle-shock", "optimal-expenditure-yp-spent", "over-there-target", "overlapping-fire", "pinned", "pinpoint-counter-offensive",
  "pledge-of-mortal-pain", "plundered", "poisoned", "prey", "prey-marked", "priority-target", "privateer-arsenal-yp-spent", "prosecuted",
  "protector-imperative-active", "pulsa-rokkit-target", "pulse-onslaught-shaken", "quarry", "remains-under-your-control", "righteous", "riled-up", "riven",
  "sabotaged", "scanned", "scattered", "scornful-analysis-designated", "secured", "servo-designated", "shadow-of-chaos", "shaken", "shocked",
  "signal-fire-target", "singular-purpose-enemy", "singular-purpose-marker", "slayer-of-champions", "slayers-oath", "slowed", "smashed", "snared",
  "spirit-mark", "split-into-single-model-units", "spotted", "staggered", "stormwracked", "strategic-conqueror", "struck-by-arcing-energies",
  "struck-by-concussive-wave", "struck-by-explosive-debris", "struck-by-spores", "stunned", "suppressed", "suppressing-fire-pinned", "surveilled",
  "symbiotic-target", "tethered", "throne-tyrannicus", "titanic-duel-target", "trapped", "triangulated", "trivarg-yp-spent", "unbridled-ardour-slayer",
  "unhideable", "unmasked", "unravelling", "vendetta-target", "vengeful-dead", "victim", "warlord", "whispering-web", "wholly-within-flow-of-magic",
  "winning-the-wager", "wobbled", "worthy-foes", "wracked-with-agonies", "yp-spent-this-use", "zapped", "warded",
] as const;

/** Keys each kind takes besides kind and bind_as; `required` keys must be present. */
const KIND_KEYS: Readonly<Record<string, { required?: readonly string[]; optional?: readonly string[] }>> = {
  "unit-destroyed": { optional: ["by", "object_owner", "timing", "object_designated", "object_any_keywords"] },
  "model-destroyed": { optional: ["by", "object_owner", "timing", "attack_type", "object_keywords", "object_any_keywords", "last"] },
  "unit-or-model-destroyed": { optional: ["by", "object_owner", "timing", "attack_type", "object_keywords"] },
  "phase-start": { required: ["phase", "turn"] },
  "phase-end": { required: ["phase", "turn"] },
  "turn-ended": { optional: ["turn"] },
  "step-started": { required: ["step"], optional: ["turn"] },
  disembarked: { optional: ["transport"] },
  "before-roll": { optional: ["roll", "rolls"] },
  "after-roll": { optional: ["roll", "rolls", "subject", "result", "channelled", "before_resolving_activity"] },
  "damage-allocated": { optional: ["object", "attack_type"] },
  used: { required: ["activity"], optional: ["owner", "subject", "id", "ids", "object", "source", "usage", "ability_keyword", "targets_level", "passed"] },
  "state-changed": { optional: ["state", "strength", "owner", "by"] },
  "designation-changed": { required: ["tag"] },
  "designation-resolved": { required: ["tag"] },
  "marker-removed": { required: ["marker"] },
  "resource-gained": { required: ["pool"], optional: ["caused_by_destruction", "owner", "source"] },
  "resource-spent": { required: ["pool"], optional: ["activity", "tag", "object", "object_owner"] },
  "move-ended": { optional: ["owner", "subject", "move_types", "also", "through", "timing"] },
  "move-started": { optional: ["owner", "subject", "move_types", "also"] },
  selected: { optional: ["owner", "subject", "move_types", "to", "mode"] },
  "targets-selected": { optional: ["owner", "subject", "action_kind", "object", "id"] },
  "attacks-resolved": { optional: ["owner", "subject", "action_kind", "phase", "turn", "attack_type", "same_subject_targeted", "causes_destruction"] },
  "set-up": { optional: ["owner", "subject", "from"] },
};

const KEYWORD_ITEMS: Schema = { type: "string", pattern: "^'?[A-Z][A-Z0-9' -]*[A-Z0-9]$" };
const DESTRUCTION_FILTER: Schema = {
  type: "object",
  required: ["owner"],
  additionalProperties: false,
  properties: {
    owner: { enum: ["friendly", "enemy", "any"] },
    all_of: { type: "array", minItems: 1, uniqueItems: true, items: KEYWORD_ITEMS, "x-optional": true },
    within: {
      type: "object",
      required: ["inches", "of"],
      additionalProperties: false,
      properties: {
        inches: { type: "number", exclusiveMinimum: 0 },
        of: { enum: ["this-model", "this-unit"] },
      },
      "x-optional": true,
    },
  },
};
const DESTRUCTION_RELATION: Schema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: { unit: DESTRUCTION_FILTER, model: DESTRUCTION_FILTER },
  "x-optional": true,
};

/** Every string value anywhere in a parameter value. */
function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) strings(item, into);
  return into;
}

/**
 * The keywords a leaf prints after a leading apostrophe, by their spelling without it. A leaf that
 * names one both with and without the apostrophe is refused, since the two could not be told apart.
 */
function printedKeywords(input: Record<string, unknown>): Map<string, string> {
  const all = strings(input);
  const printed = new Map<string, string>();
  for (const value of all) if (LEADING_APOSTROPHE.test(value)) printed.set(value.slice(1), value);
  for (const plain of printed.keys()) if (all.includes(plain)) throw new TypeError(`event names ${plain} both with and without a leading apostrophe.`);
  return printed;
}

const canonicalKeyword = (text: string) => text.replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();

/**
 * A sorted, duplicate-free unit-keyword list. A keyword may carry one leading apostrophe as the
 * rules print it ('ARDMOB), which it keeps; it sorts by its spelling without the apostrophe. A
 * keyword written without the apostrophe that the leaf prints with one elsewhere is refused.
 */
function keywords(value: unknown, label: string, printed: Map<string, string>): string[] {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label} must list at least 1 keyword.`);
  const list = value.map((item) => {
    const apostrophe = typeof item === "string" && LEADING_APOSTROPHE.test(item);
    const plain = apostrophe ? (item as string).slice(1) : String(item);
    const keyword = canonicalKeyword(plain);
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    if (apostrophe && keyword !== plain) throw new TypeError(`event could not keep the leading apostrophe of ${String(item)}.`);
    if (!apostrophe && printed.has(keyword)) throw new TypeError(`event names ${keyword} both with and without a leading apostrophe.`);
    return { keyword, spelling: apostrophe ? item as string : keyword };
  });
  if (new Set(list.map(({ keyword }) => keyword)).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort((a, b) => (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0)).map(({ spelling }) => spelling);
}

/** unit and/or model destruction, each with an owner and optional keywords and distance. */
function destructionRelation(value: unknown, label: string, printed: Map<string, string>): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must name unit and/or model destruction.`);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length === 0 || Object.keys(input).some((key) => key !== "unit" && key !== "model")) throw new TypeError(`${label} must contain only unit and/or model.`);
  const result: Record<string, unknown> = {};
  for (const level of ["unit", "model"]) {
    if (input[level] === undefined) continue;
    const filter = input[level];
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) throw new TypeError(`${label}.${level} must be an object.`);
    const fields = filter as Record<string, unknown>;
    if (Object.keys(fields).some((key) => key !== "owner" && key !== "all_of" && key !== "within")) throw new TypeError(`${label}.${level} contains an unknown key.`);
    const owner = enumValue(fields.owner, ["friendly", "enemy", "any"], `${label}.${level}.owner`);
    const within = fields.within as Record<string, unknown> | null | undefined;
    if (within !== undefined && (within === null || typeof within !== "object" || Array.isArray(within)
      || Object.keys(within).length !== 2 || typeof within.inches !== "number" || within.inches <= 0 || !["this-model", "this-unit"].includes(String(within.of)))) {
      throw new TypeError(`${label}.${level}.within must contain positive inches and this-model or this-unit.`);
    }
    result[level] = {
      owner,
      ...(fields.all_of !== undefined ? { all_of: keywords(fields.all_of, `${label}.${level}.all_of`, printed) } : {}),
      ...(within !== undefined ? { within: { inches: within.inches, of: within.of } } : {}),
    };
  }
  return result;
}

/** A designation a designation moment names: a registered id or a printed keyword, never a list-building one. */
function designationTag(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("event.tag must be a registered designation id.");
  const tag = value;
  const plain = LEADING_APOSTROPHE.test(tag) ? tag.slice(1) : tag;
  if (!DESIGNATION_IDS.has(plain) && !DESIGNATION_PATTERN.test(plain)) throw new TypeError("event.tag must be a registered designation id.");
  refuseListBuildingTag(plain, "event.tag");
  return tag;
}

/** The designation a spend applies: a registered id only. */
function spendTag(value: unknown): string {
  if (typeof value !== "string" || !DESIGNATION_IDS.has(value)) throw new TypeError("event.tag on a resource-spent must be a registered designation id.");
  refuseListBuildingTag(value, "event.tag");
  return value;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TypeError(`${label} must be a nonempty string.`);
}

function namedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAMED_ID.test(value)) throw new TypeError(`${label} is a kebab-case ability, Stratagem, manoeuvre or action id.`);
  return value;
}

function bindingName(value: unknown): string {
  if (typeof value !== "string" || !BINDING.test(value)) throw new TypeError("event.bind_as must be a lower-case event variable.");
  return value;
}

function usage(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("event.usage must be {frequency: \"n-per-battle\", count: 1}.");
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 2) throw new TypeError("event.usage must contain only frequency and count.");
  if (fields.frequency !== "n-per-battle" || fields.count !== 1) throw new TypeError("event.usage must be {frequency: \"n-per-battle\", count: 1}.");
  return { frequency: "n-per-battle", count: 1 };
}

function normalizeEvent(input: Record<string, unknown>): Record<string, unknown> {
  const printed = printedKeywords(input);
  const kind = enumValue(input.kind, EVENT_KINDS, "event.kind");
  const spec = KIND_KEYS[kind] ?? {};
  const allowed = new Set(["kind", "bind_as", ...(spec.required ?? []), ...(spec.optional ?? [])]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`event.${key} does not apply to kind ${kind}.`);
  if ("bind_as" in input && !(BINDABLE_KINDS as readonly string[]).includes(kind)) throw new TypeError(`event.bind_as does not apply to kind ${kind}.`);
  const has = (key: string) => key in input;
  const result: Record<string, unknown> = { kind };

  // Required, or exactly one of a pair.
  for (const key of spec.required ?? []) if (!has(key)) throw new TypeError(`event kind ${kind} needs ${key}.`);
  if (kind === "before-roll" || kind === "after-roll") {
    if (has("roll") && has("rolls")) throw new TypeError("event names roll or rolls, not both.");
    if (!has("roll") && !has("rolls")) throw new TypeError(`event kind ${kind} needs roll or rolls.`);
  }
  if (kind === "state-changed") {
    if (has("state") && has("strength")) throw new TypeError("event.strength stands in place of state; give one of them.");
    if (!has("state") && !has("strength")) throw new TypeError("event kind state-changed needs state or strength.");
  }
  if (has("subject") && has("owner")) throw new TypeError("event names its unit by subject or by owner, not both.");
  if (has("id") && has("ids")) throw new TypeError("event.ids lists the rules instead of id; name one or the other.");
  if (kind === "resource-spent" && has("activity") && has("tag")) throw new TypeError("event resource-spent names what the spend is for by activity or by tag, not both.");
  if (kind === "resource-spent" && has("object") && has("object_owner")) throw new TypeError("event resource-spent names the unit it serves by object or by object_owner, not both.");

  // The moment's own filter fields.
  if (has("phase")) result.phase = enumValue(input.phase, PHASES, "event.phase");
  if (has("turn")) result.turn = enumValue(input.turn, TURNS, "event.turn");
  if (has("step")) result.step = enumValue(input.step, STEPS, "event.step");
  if (has("activity")) result.activity = enumValue(input.activity, ACTIVITIES, "event.activity");
  if (has("state")) result.state = enumValue(input.state, CHANGED_STATES, "event.state");
  if (has("strength")) result.strength = enumValue(input.strength, STRENGTHS, "event.strength");
  if (has("tag")) result.tag = (SPEND_FOR as readonly string[]).includes(kind) ? spendTag(input.tag) : designationTag(input.tag);
  if (has("roll")) result.roll = enumValue(input.roll, ROLLS, "event.roll");
  if (has("rolls")) {
    const rolls = enumSet(input.rolls, TRIGGER_ROLLS, "event.rolls");
    if (rolls.length < 2) throw new TypeError("event.rolls lists two or more roll kinds; a single kind is event.roll.");
    result.rolls = rolls;
  }
  if (has("marker")) result.marker = nonEmpty(input.marker, "event.marker");
  if (has("pool")) result.pool = nonEmpty(input.pool, "event.pool");

  // Who made the moment.
  if (has("owner")) result.owner = enumValue(input.owner, kind === "targets-selected" ? ["friendly", "enemy", "any"] : OBJECT_OWNERS, "event.owner");
  if (has("subject")) result.subject = enumValue(input.subject, SUBJECTS, "event.subject");
  if (has("move_types")) result.move_types = enumSet(input.move_types, MOVE_TYPES, "event.move_types");
  if (has("to")) result.to = enumValue(input.to, SELECTED_TO, "event.to");
  if (has("mode")) {
    const moves = input.move_types;
    if (!Array.isArray(moves) || moves.length !== 1 || moves[0] !== "disembark") {
      throw new TypeError("event.mode names a disembark mode, so it needs kind selected with move_types [disembark].");
    }
    result.mode = enumValue(input.mode, DISEMBARK_MODES, "event.mode");
  }
  if (has("action_kind")) result.action_kind = enumValue(input.action_kind, ACTION_KINDS[kind]!, "event.action_kind");
  if (has("result")) result.result = enumValue(input.result, ["success", "failure"], "event.result");
  if (has("also")) {
    const other = enumValue(input.also, ["move-started", "move-ended"], "event.also");
    if (other === kind) throw new TypeError("event.also names the other end of a move-started or move-ended moment.");
    result.also = other;
  }
  if (has("through")) result.through = enumValue(input.through, ["tall-terrain"], "event.through");
  if (has("from")) result.from = enumValue(input.from, ["strategic-reserves"], "event.from");
  if (has("transport")) result.transport = enumValue(input.transport, ["this-unit"], "event.transport");

  // What the moment was done to.
  if (has("object")) result.object = enumValue(input.object, OBJECTS[kind]!, "event.object");
  if (has("by")) result.by = enumValue(input.by, kind === "state-changed" ? STATE_CAUSES : DESTROYERS, "event.by");
  if (has("object_owner")) result.object_owner = enumValue(input.object_owner, OBJECT_OWNERS, "event.object_owner");
  if (has("object_keywords")) {
    // Without object_owner, the model is one of this unit's ("the last Guardian Defender model in this unit").
    if (!has("object_owner") && kind !== "model-destroyed") throw new TypeError("event.object_keywords needs object_owner: whose model was destroyed.");
    result.object_keywords = keywords(input.object_keywords, "event.object_keywords", printed);
  }
  if (has("object_any_keywords")) {
    if (!has("object_owner")) throw new TypeError("event.object_any_keywords needs object_owner: whose unit or model was destroyed.");
    if (has("object_keywords")) throw new TypeError("event names the destroyed object's keywords as all of object_keywords or any of object_any_keywords, not both.");
    const any = keywords(input.object_any_keywords, "event.object_any_keywords", printed);
    if (any.length < 2) throw new TypeError("event.object_any_keywords lists two or more keywords, any one of which the object has; one keyword is object_keywords.");
    result.object_any_keywords = any;
  }
  // "When the last Guardian Defender model in this unit is destroyed": the last model of the named keywords.
  if (has("last")) {
    if (input.last !== true) throw new TypeError("event.last must be true.");
    if (!has("object_keywords") && !has("object_any_keywords")) throw new TypeError("event.last names the last model with the object's keywords; give object_keywords.");
    result.last = true;
  }
  if (has("object_designated")) result.object_designated = enumValue(input.object_designated, OBJECT_DESIGNATIONS, "event.object_designated");
  if (has("timing")) result.timing = enumValue(input.timing, kind === "move-ended" ? MOVE_TIMINGS : DESTRUCTION_TIMINGS, "event.timing");
  if (has("attack_type")) result.attack_type = enumValue(input.attack_type, ATTACK_TYPES, "event.attack_type");
  if (has("same_subject_targeted")) result.same_subject_targeted = enumValue(input.same_subject_targeted, ["stratagem-target"], "event.same_subject_targeted");

  // Which rule was used, and how.
  if (has("id")) {
    if (kind === "used" && !(NAMED_ACTIVITIES as readonly string[]).includes(result.activity as string)) {
      throw new TypeError(`event.id names one ${NAMED_ACTIVITIES.join(", ")}; a ${String(result.activity)} is named only as a kind.`);
    }
    if (kind === "targets-selected" && result.action_kind !== "ability" && result.action_kind !== "stratagem") {
      throw new TypeError("event.id on targets-selected names the ability or Stratagem that selected; action_kind must be ability or stratagem.");
    }
    result.id = namedId(input.id, "event.id");
  }
  if (has("ids")) {
    if (!(NAMED_ACTIVITIES as readonly string[]).includes(result.activity as string)) {
      throw new TypeError(`event.ids names ${NAMED_ACTIVITIES.join(", ")}; a ${String(result.activity)} is named only as a kind.`);
    }
    if (!Array.isArray(input.ids) || input.ids.length < 2) throw new TypeError("event.ids lists two or more rules; one rule is id.");
    const ids = input.ids.map((id) => namedId(id, "event.ids"));
    if (new Set(ids).size !== ids.length) throw new TypeError("event.ids names a rule twice.");
    result.ids = ids;
  }
  // A Dark Pact or contract is bound for a later change to that same use ("add 1 to the number of mortal wounds it suffers").
  const bindsPact = has("bind_as") && (result.activity === "dark-pact" || result.activity === "contract");
  if (kind === "used" && ["source", "usage", "ability_keyword", "targets_level"].some(has) && result.activity !== "ability") {
    throw new TypeError("event source, usage, ability_keyword and targets_level qualify a used ability, not another used activity.");
  }
  if (kind === "used" && has("bind_as") && result.activity !== "ability" && !bindsPact) {
    throw new TypeError("event bind_as on a used moment names a used ability, Dark Pact or contract.");
  }
  // "Makes a Dark Pact and does not fail the resulting Leadership test": the test's outcome.
  if (has("passed")) {
    if (result.activity !== "dark-pact") throw new TypeError("event.passed is the outcome of a Dark Pact's Leadership test; its activity is dark-pact.");
    if (has("bind_as")) throw new TypeError("event.passed binds the Dark Pact's test, not the use; it takes no bind_as.");
    if (typeof input.passed !== "boolean") throw new TypeError("event.passed must be true or false.");
    result.passed = input.passed;
  }
  if (has("source")) {
    // A resource gained "as the result of an ability".
    result.source = kind === "resource-gained" ? enumValue(input.source, ["ability"], "event.source") : enumSet(input.source, ["unit", "enhancement"], "event.source");
  }
  if (has("usage")) result.usage = usage(input.usage);
  if (has("ability_keyword")) {
    if (typeof input.ability_keyword !== "string" || !input.ability_keyword.trim()) throw new TypeError("event.ability_keyword must be a nonempty reviewed keyword.");
    result.ability_keyword = input.ability_keyword;
  }
  if (has("targets_level")) result.targets_level = enumValue(input.targets_level, ["unit"], "event.targets_level");

  // A Psychic test's own qualifiers.
  if (has("channelled") || has("before_resolving_activity")) {
    if (result.roll !== "psychic") throw new TypeError("event channelled and before_resolving_activity qualify an after-Psychic-test moment.");
    if (has("channelled")) {
      if (input.channelled !== true) throw new TypeError("event.channelled must be true.");
      result.channelled = true;
    }
    if (has("before_resolving_activity")) result.before_resolving_activity = enumValue(input.before_resolving_activity, ["ritual"], "event.before_resolving_activity");
  }

  // The event's binding, and the destructions it is exactly related to.
  if (has("bind_as")) result.bind_as = bindingName(input.bind_as);
  if (has("caused_by_destruction") || has("causes_destruction")) {
    if (!has("bind_as")) throw new TypeError("An exact destruction relation requires bind_as.");
    if (has("caused_by_destruction")) result.caused_by_destruction = destructionRelation(input.caused_by_destruction, "event.caused_by_destruction", printed);
    if (has("causes_destruction")) result.causes_destruction = destructionRelation(input.causes_destruction, "event.causes_destruction", printed);
  }
  return result;
}

const EVENT: FlatFamily = {
  id: "event",
  version: 43,
  role: "EVENT",
  label: "At an event",
  description: [
    "Marks when the mechanic triggers; kind names the moment. Attacks are the separate attack leaf.",
    "Fixed moments: a charge; after shooting; this unit selected to shoot or to fight; a Stratagem moment (just after an enemy unit selects its targets, ends a move, has shot, or declares a charge); the start of the battle; army selection; the end of deployment; Battle Formations declared; an objective newly gained.",
    "Destruction: a unit destroyed, a model in a unit destroyed, this model destroyed (before it is removed), or either a unit or a model destroyed (unit-or-model-destroyed). unit-destroyed, model-destroyed and unit-or-model-destroyed take by (who destroyed it: this unit, this model, the selected unit, an earlier leaf's unit, or enemy for any enemy unit), object_owner (whose unit or model it was) and timing (before-removal, or before-deadly-demise: after the destruction, before its Deadly Demise roll and so before it is removed); model-destroyed and unit-or-model-destroyed also take object_keywords (the destroyed model's unit keywords, with object_owner; on model-destroyed without object_owner, a model of this unit) and attack_type; unit-destroyed and model-destroyed take object_any_keywords (two or more keywords, any one of which the destroyed unit or model has: \"destroys a DIRE AVENGERS or GUARDIANS unit\"); model-destroyed takes last (the last model with those keywords in its unit: \"the last Guardian Defender model in this unit\"); unit-destroyed takes object_designated (the destroyed unit carried that designation).",
    "Turn structure: the start or end of a phase (phase and turn, both required); the end of the battle round; the end of a turn (optional turn); the start of the Battle-shock or Reinforcements step (step, optional turn).",
    "Moments a unit makes take owner (friendly or enemy, and on targets-selected also any) or subject (this unit by default, this model, the selected unit, the triggering unit, or antecedent: an earlier leaf's unit), never both: move-started and move-ended (move_types; also, the other end of the same move, so one leaf fires at the start or end of a move; through on move-ended, the move passed through the named terrain, written by the move-passthrough-used fold); selected (to move, shoot, fight, charge or attack, narrowed by move_types; mode, the disembark mode, when move_types is [disembark]); targets-selected (action_kind charge, shoot, attack, stratagem or ability; object, what was selected as the target: this unit, this model, the selected unit, or antecedent; id, the ability or Stratagem that selected, with action_kind ability or stratagem); attacks-resolved (action_kind charge, shoot, attack, stratagem, or fight for a fight only; optional phase and turn; attack_type; same_subject_targeted stratagem-target); set-up (from strategic-reserves: set up from Reserves or as Reinforcements). move-ended also takes timing before-marker-removal (\"ends a move within 8\" of your markers, before removing those markers\").",
    "A disembarkation takes transport this-unit (the Transport left). damage-allocated takes object (this unit, this model or the selected unit: the attack is allocated to a model in it) and attack_type.",
    "Rolls: before-roll and after-roll name roll, or rolls (two or more roll kinds a DSL trigger can name, lowered to one trigger per kind). after-roll also takes subject (who made the roll), result (success or failure), and, after a Psychic test (roll psychic), channelled and before_resolving_activity ritual.",
    "used names the activity used (ability, Stratagem, action, manoeuvre, order, ritual, Dark Pact, Act of Faith, doctrine or contract), with owner (whose army) or subject (who used it); id names which ability, manoeuvre, Stratagem or action, or ids lists two or more rules any one of which was used; object is the unit the rule is aimed at (this unit, this model, the selected unit, or filtered-units: the unit-filter right before names it). A used ability also takes source (unit or enhancement definitions), usage (once per battle), ability_keyword and targets_level unit. passed, on a used Dark Pact, is the outcome of its Leadership test (true: \"does not fail the resulting Leadership test\"); a later roll-total dark-pact-test reads that test's result. A used Dark Pact or contract also takes bind_as, for a later change to that same use.",
    "state-changed names the core-rules state that changed, or strength: the unit becomes Below Half-strength (below-half) or falls below its Starting Strength (below-starting), with owner (whose unit) and by (the unit that caused it: \"caused an enemy unit … to become Below Half-strength\"). designation-changed and designation-resolved name the designation (tag). marker-removed names the marker. resource-gained and resource-spent name the pool; a gain takes owner (whose: enemy is your opponent) and source ability (\"as the result of an ability\"); a spend can name what it is for, by activity or by tag (not both), and the unit it serves: object (this unit, the selected unit, or antecedent) or object_owner (any unit of that side: \"Empower units from your army … by spending Pain tokens\").",
    "bind_as names the exact event for a later leaf to refer to; an exact destruction relation needs it: caused_by_destruction on resource-gained, causes_destruction on attacks-resolved, each naming unit and/or model destruction by owner, keywords and distance. A keyword can start with an apostrophe as the rules print it ('ARDMOB).",
  ].join(" "),
  starter: { kind: "" },
  parameterSchema: {
    type: "object",
    required: ["kind"],
    properties: {
      kind: { enum: EVENT_KINDS },
      phase: { enum: PHASES, "x-only-when": { kind: ["phase-start", "phase-end", "attacks-resolved"] } },
      turn: { enum: TURNS, "x-only-when": { kind: ["phase-start", "phase-end", "attacks-resolved", "turn-ended", "step-started"] } },
      step: { enum: STEPS, "x-only-when": { kind: ["step-started"] } },
      activity: { enum: ACTIVITIES, "x-only-when": { kind: ["used", "resource-spent"] }, "x-optional": true },
      state: { enum: CHANGED_STATES, "x-only-when": { kind: ["state-changed"] } },
      tag: { type: "string", minLength: 1, "x-only-when": { kind: ["designation-changed", "designation-resolved", "resource-spent"] }, "x-optional": true },
      roll: { enum: ROLLS, "x-only-when": { kind: ["before-roll", "after-roll"] } },
      marker: { type: "string", minLength: 1, "x-only-when": { kind: ["marker-removed"] } },
      pool: { type: "string", minLength: 1, "x-only-when": { kind: ["resource-gained", "resource-spent"] } },
      owner: { enum: ["friendly", "enemy", "any"], "x-only-when": { kind: ["move-ended", "move-started", "selected", "targets-selected", "attacks-resolved", "set-up", "used", "state-changed", "resource-gained"] } },
      move_types: { type: "array", items: { enum: MOVE_TYPES }, minItems: 1, uniqueItems: true, "x-only-when": { kind: ["move-ended", "move-started", "selected"] } },
      to: { enum: SELECTED_TO, "x-only-when": { kind: ["selected"] } },
      action_kind: { enum: ["charge", "shoot", "attack", "stratagem", "ability", "fight"], "x-only-when": { kind: ["targets-selected", "attacks-resolved"] } },
      subject: { enum: SUBJECTS, "x-only-when": { kind: ["move-ended", "move-started", "selected", "targets-selected", "attacks-resolved", "set-up", "after-roll", "used"] }, "x-optional": true },
      result: { enum: ["success", "failure"], "x-only-when": { kind: ["after-roll"] }, "x-optional": true },
      by: { enum: DESTROYERS, "x-only-when": { kind: ["unit-destroyed", "model-destroyed", "unit-or-model-destroyed", "state-changed"] }, "x-optional": true },
      object_owner: { enum: OBJECT_OWNERS, "x-only-when": { kind: ["unit-destroyed", "model-destroyed", "unit-or-model-destroyed", "resource-spent"] }, "x-optional": true },
      also: { enum: ["move-started", "move-ended"], "x-only-when": { kind: ["move-started", "move-ended"] }, "x-optional": true },
      object: { enum: ["this-unit", "this-model", ANTECEDENT, FILTERED_UNITS, "selected-unit"], "x-only-when": { kind: ["targets-selected", "damage-allocated", "resource-spent", "used"] }, "x-optional": true },
      from: { enum: ["strategic-reserves"], "x-only-when": { kind: ["set-up"] }, "x-optional": true },
      id: { type: "string", pattern: NAMED_ID.source, "x-only-when": { kind: ["used", "targets-selected"] }, "x-optional": true },
      transport: { enum: ["this-unit"], "x-only-when": { kind: ["disembarked"] }, "x-optional": true },
      rolls: { type: "array", items: { enum: TRIGGER_ROLLS }, minItems: 2, uniqueItems: true, "x-only-when": { kind: ["before-roll", "after-roll"] }, "x-optional": true },
      attack_type: { enum: ATTACK_TYPES, "x-only-when": { kind: ["damage-allocated", "model-destroyed", "unit-or-model-destroyed", "attacks-resolved"] }, "x-optional": true },
      through: { enum: ["tall-terrain"], "x-optional": true, "x-only-when": { kind: ["move-ended"] } },
      object_keywords: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { kind: ["model-destroyed", "unit-or-model-destroyed"] }, "x-optional": true },
      source: {
        anyOf: [{ type: "array", minItems: 1, uniqueItems: true, items: { enum: ["unit", "enhancement"] } }, { const: "ability" }],
        "x-only-when": { kind: ["used", "resource-gained"] }, "x-optional": true,
      },
      bind_as: { type: "string", pattern: BINDING.source, minLength: 1, "x-only-when": { kind: BINDABLE_KINDS }, "x-optional": true },
      usage: {
        type: "object",
        required: ["frequency", "count"],
        additionalProperties: false,
        properties: { frequency: { const: "n-per-battle" }, count: { const: 1 } },
        "x-only-when": { kind: ["used"] },
        "x-optional": true,
      },
      ability_keyword: { type: "string", minLength: 1, "x-only-when": { kind: ["used"] }, "x-optional": true },
      targets_level: { enum: ["unit"], "x-only-when": { kind: ["used"] }, "x-optional": true },
      passed: { type: "boolean", "x-only-when": { kind: ["used"] }, "x-optional": true },
      timing: { enum: [...DESTRUCTION_TIMINGS, ...MOVE_TIMINGS], "x-only-when": { kind: ["unit-destroyed", "model-destroyed", "unit-or-model-destroyed", "move-ended"] }, "x-optional": true },
      object_any_keywords: { type: "array", items: KEYWORD_ITEMS, minItems: 2, uniqueItems: true, "x-only-when": { kind: ["unit-destroyed", "model-destroyed"] }, "x-optional": true },
      last: { const: true, "x-only-when": { kind: ["model-destroyed"] }, "x-optional": true },
      object_designated: { enum: OBJECT_DESIGNATIONS, "x-only-when": { kind: ["unit-destroyed"] }, "x-optional": true },
      same_subject_targeted: { enum: ["stratagem-target"], "x-only-when": { kind: ["attacks-resolved"] }, "x-optional": true },
      channelled: { const: true, "x-only-when": { kind: ["after-roll"] }, "x-optional": true },
      before_resolving_activity: { enum: ["ritual"], "x-only-when": { kind: ["after-roll"] }, "x-optional": true },
      caused_by_destruction: { ...DESTRUCTION_RELATION, "x-only-when": { kind: ["resource-gained"] } },
      causes_destruction: { ...DESTRUCTION_RELATION, "x-only-when": { kind: ["attacks-resolved"] } },
      ids: { type: "array", items: { type: "string", pattern: NAMED_ID.source }, minItems: 2, uniqueItems: true, "x-only-when": { kind: ["used"] }, "x-optional": true },
      mode: { enum: DISEMBARK_MODES, "x-only-when": { kind: ["selected"] }, "x-optional": true },
      strength: { enum: STRENGTHS, "x-only-when": { kind: ["state-changed"] }, "x-optional": true },
    },
    additionalProperties: false,
  },
  normalize: normalizeEvent,
};

// ---------------------------------------------------------------------------------------------
// Ability-use history, army state and history window
// ---------------------------------------------------------------------------------------------

const HISTORY_WINDOWS = ["phase", "turn", "battle"] as const;
const USE_OWNERS = ["friendly", "enemy", "any"] as const;
const USE_LEVELS = ["model", "unit"] as const;
const USE_WINDOWS = ["phase", "turn", "battle-round", "battle", "previous-turn"] as const;
const EVENT_VAR: Schema = { type: "string", pattern: "^[a-z][a-z0-9-]*$" };

function eventVar(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]*$/u.test(value)) throw new TypeError(`${label} must be a binding name.`);
  return value;
}

const HISTORY_WINDOW: FlatFamily = {
  id: "history-window",
  version: 1,
  role: "CONDITION",
  label: "History window",
  description: "The window of the history condition before it: \"this phase\", \"this turn\", \"this battle\", \"during the battle\". Folds into a windowed destruction (destroyed-units-in-window) or a set-up activity; for a set-up activity it must agree with the window the activity already names.",
  starter: { window: "phase" },
  parameterSchema: {
    type: "object",
    required: ["window"],
    properties: { window: { enum: HISTORY_WINDOWS } },
    additionalProperties: false,
  },
  normalize: (input) => {
    const stray = Object.keys(input).filter((key) => key !== "window");
    if (stray.length) throw new TypeError(`history-window has no parameter ${stray[0]}.`);
    return { window: enumValue(input.window, HISTORY_WINDOWS, "history-window.window") };
  },
};

const ABILITY_USE_HISTORY: FlatFamily = {
  id: "ability-use-history",
  version: 1,
  role: "CONDITION",
  label: "Compare an ability use with history",
  description: "Tests prior uses in a window against the bound use's exact ability and actor. Other excludes the bound actor; same selects only it. Any ability does not constrain rule identity.",
  starter: { event_var: "ability-use", owner: "friendly", level: "model", actor: "other", ability: "same", window: "turn", negated: true },
  parameterSchema: {
    type: "object",
    properties: {
      event_var: EVENT_VAR,
      owner: { enum: USE_OWNERS },
      level: { enum: USE_LEVELS },
      actor: { enum: ["same", "other", "any"] },
      ability: { enum: ["same", "any"] },
      window: { enum: USE_WINDOWS },
      negated: { type: "boolean" },
    },
    required: ["event_var", "owner", "level", "actor", "ability", "window", "negated"],
    additionalProperties: false,
  },
  normalize: (input) => {
    const family = "ability-use-history";
    exactKeys(input, ["event_var", "owner", "level", "actor", "ability", "window", "negated"], family);
    return {
      event_var: eventVar(input.event_var, `${family}.event_var`),
      owner: enumValue(input.owner, USE_OWNERS, `${family}.owner`),
      level: enumValue(input.level, USE_LEVELS, `${family}.level`),
      actor: enumValue(input.actor, ["same", "other", "any"], `${family}.actor`),
      ability: enumValue(input.ability, ["same", "any"], `${family}.ability`),
      window: enumValue(input.window, USE_WINDOWS, `${family}.window`),
      negated: booleanValue(input.negated, `${family}.negated`),
    };
  },
};

const ABILITY_SELECTION_OVERRIDE: FlatFamily = {
  id: "ability-selection-override",
  version: 1,
  role: "EFFECT",
  label: "Replace the triggering ability's selection",
  description: "The preceding selection supplies recipients of the exact bound ability use, replacing that use's selection rather than activating it again. Separate leaves supply count, recipient filter, distance, exclusions and recipient duration.",
  starter: { event_var: "ability-use" },
  parameterSchema: {
    type: "object",
    properties: { event_var: EVENT_VAR },
    required: ["event_var"],
    additionalProperties: false,
  },
  normalize: (input) => {
    exactKeys(input, ["event_var"], "ability-selection-override");
    return { event_var: eventVar(input.event_var, "ability-selection-override.event_var") };
  },
};

const ARMY_STATE: FlatFamily = {
  id: "army-state",
  version: 1,
  role: "CONDITION",
  label: "An army has a rules state",
  description: "Tests the named army's state, not a keyword of a unit in that army.",
  starter: { owner: "friendly", state: "honoured" },
  parameterSchema: {
    type: "object",
    properties: { owner: { enum: ["friendly", "enemy"] }, state: { enum: ["honoured"] } },
    required: ["owner", "state"],
    additionalProperties: false,
  },
  normalize: (input) => {
    exactKeys(input, ["owner", "state"], "army-state");
    return { owner: enumValue(input.owner, ["friendly", "enemy"], "army-state.owner"), state: enumValue(input.state, ["honoured"], "army-state.state") };
  },
};

// ---------------------------------------------------------------------------------------------
// targeted and hit-by-attacks
// ---------------------------------------------------------------------------------------------

const FOLLOWING_FILTER = "following-filter";
const TARGETED_SUBJECTS = ["this-unit", "this-model", "event-subject", "selected-unit", ANTECEDENT] as const;
const TARGETED_OBJECTS = ["this-unit", FOLLOWING_FILTER] as const;
const TARGETED_WINDOWS = ["phase", "event"] as const;
const TARGETED_ATTACK_TYPES = ["ranged", "melee", "psychic"] as const;

const TARGETED: FlatFamily = {
  id: "targeted",
  version: 1,
  role: "CONDITION",
  label: "Unit targeted another unit",
  description: "The subject selected the object as a target of its attacks: within the moment the ability names (window event: \"an enemy unit that targeted a\" + \"friendly unengaged X unit\" + \"has shot\") or at any time this phase (window phase: \"that made one or more attacks that targeted your unit this phase\"). object following-filter is any unit the unit-filter right after this leaf, in the same clause, matches; this-unit is the ability's own unit (a Stratagem's target). attack_type: only its ranged (or melee, psychic) attacks count.",
  starter: { subject: "", object: "", window: "" },
  parameterSchema: {
    type: "object",
    required: ["subject", "object", "window"],
    properties: {
      subject: { enum: TARGETED_SUBJECTS },
      object: { enum: TARGETED_OBJECTS },
      window: { enum: TARGETED_WINDOWS },
      attack_type: { enum: TARGETED_ATTACK_TYPES, "x-optional": true },
    },
    additionalProperties: false,
  },
  normalize: (input) => {
    exactKeys(input, ["subject", "object", "window", ...(input.attack_type !== undefined ? ["attack_type"] : [])], "targeted");
    const subject = enumValue(input.subject, TARGETED_SUBJECTS, "targeted.subject");
    const object = enumValue(input.object, TARGETED_OBJECTS, "targeted.object");
    if ((subject === "this-unit" || subject === "this-model") && object === "this-unit") {
      throw new TypeError("targeted: a unit does not target itself; the subject is this unit (or its model) and so is the object.");
    }
    const window = enumValue(input.window, TARGETED_WINDOWS, "targeted.window");
    return { subject, object, window, ...(input.attack_type !== undefined ? { attack_type: enumValue(input.attack_type, TARGETED_ATTACK_TYPES, "targeted.attack_type") } : {}) };
  },
};

const HIT_SUBJECTS = ["this-unit", "this-model", "target", "attacker", "event-subject", "recipient", "selected-unit", ANTECEDENT] as const;

const HIT_BY_ATTACKS: FlatFamily = {
  id: "hit-by-attacks",
  version: 4,
  role: "CONDITION",
  label: "Hit by those attacks",
  description: "A unit was hit by the attacks the ability's moment names (\"select one enemy unit hit by one or more of those attacks\"): after a selection it says which units can be selected, so if nothing was hit nothing can be. Those attacks are the ones the triggering moment's unit or model made (\"after this model has shot\"). The unit hit is subject (antecedent: the unit an earlier leaf of the record introduced, \"that enemy unit\", bound when the record compiles), or object following-filter: the unit-filter right after this leaf (\"those attacks made with its Doomweaver scored a hit against an enemy unit\"), never both. window phase: hit at any time this phase, not only by the attacks of the ability's moment; with it, by following-filter says the attacks were made by any unit or model the unit-filter right after this leaf matches (not with object). Without by, the attacker is the unit of the ability's moment.",
  starter: { subject: "" },
  parameterSchema: {
    type: "object",
    properties: {
      subject: { enum: HIT_SUBJECTS, "x-optional": true },
      window: { enum: ["phase"], "x-optional": true },
      by: { enum: [FOLLOWING_FILTER], "x-only-when": { window: ["phase"] }, "x-optional": true },
      object: { enum: [FOLLOWING_FILTER], "x-optional": true },
    },
    additionalProperties: false,
    required: [],
  },
  normalize: (input) => {
    const stray = Object.keys(input).filter((key) => !["subject", "window", "by", "object"].includes(key));
    if (stray.length) throw new TypeError(`hit-by-attacks has no parameter ${stray[0]}.`);
    const result: Record<string, unknown> = {};
    if (input.object !== undefined) {
      result.object = enumValue(input.object, [FOLLOWING_FILTER], "hit-by-attacks.object");
      if (input.subject !== undefined) throw new TypeError("hit-by-attacks names the unit hit by subject or by object, not both.");
      if (input.by !== undefined) throw new TypeError("hit-by-attacks names the following unit-filter as both the unit hit and the attacks' attacker; it can be only one.");
    } else {
      if (input.subject === undefined) throw new TypeError("hit-by-attacks names the unit hit: subject, or object following-filter.");
      result.subject = enumValue(input.subject, HIT_SUBJECTS, "hit-by-attacks.subject");
    }
    if (input.by !== undefined && input.window === undefined) throw new TypeError("hit-by-attacks.by names who made the attacks of a window phase hit.");
    if (input.window !== undefined) result.window = enumValue(input.window, ["phase"], "hit-by-attacks.window");
    if (input.by !== undefined) result.by = enumValue(input.by, [FOLLOWING_FILTER], "hit-by-attacks.by");
    return result;
  },
};

export const EVENTS_FAMILIES: readonly FlatFamily[] = [
  EVENT, HISTORY_WINDOW, ABILITY_USE_HISTORY, ABILITY_SELECTION_OVERRIDE, ARMY_STATE, TARGETED, HIT_BY_ATTACKS,
];
