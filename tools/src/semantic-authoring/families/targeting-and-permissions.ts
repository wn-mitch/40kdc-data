import { ANTECEDENT } from "../antecedent-families.js";
import { booleanValue, boundedInteger, enumSet, enumValue, exactKeys } from "../family-validation.js";
import { ASCII_KEYWORD, KEBAB_ID, KEBAB_ID_PATTERN, MATCHED_UNITS, SELECTION_NAME_SCHEMA, selectionName, STRING_LIST_SCHEMA, withLeadingApostrophes, type Params } from "./unit-filters-and-targeting-shared.js";
import type { FlatFamily } from "./types.js";

/**
 * The attack moment, and the effects that change who may target or act: eligibility-permission,
 * targeting-restriction, counts-as, rule-state and damage-reduction.
 */

// ---------------------------------------------------------------------------------------------
// attack

const ATTACK_DIRECTIONS = ["makes", "targeted"] as const;
const ATTACK_UNITS = ["this-model", "this-unit", "bearers-unit", "that-unit", "recipient", "friendly-unit", "enemy-unit"] as const;
const ATTACK_TYPES = ["any", "melee", "ranged", "psychic"] as const;
/** The attack types a back-reference can print ("those ranged attacks"). */
const PRINTED_ATTACK_TYPES = ["melee", "ranged", "psychic"];

function normalizeAttack(input: Params): Params {
  const { selection, ...rest } = input;
  if (selection !== undefined && String(rest.unit) !== "that-unit") throw new TypeError("attack.selection names which selected unit unit that-unit is; it takes no other unit.");
  if (rest.target === "following-filter") {
    if (rest.direction !== "makes") throw new TypeError("attack.target following-filter names the defender, so the attack's direction must be makes.");
    if (rest.unit === "that-unit") throw new TypeError("attack.target following-filter cannot go with unit that-unit: one unit would both make and receive the attack.");
  }
  if (rest.refers !== undefined) {
    if (rest.refers !== "earlier-attack" && rest.refers !== "earlier-permission") throw new TypeError("attack.refers must be earlier-attack or earlier-permission.");
    const extra = Object.keys(rest).filter((key) => key !== "refers" && key !== "attack_type");
    // Who attacks and which way are the earlier attack's; a back-reference that also names them borrows wording from outside its span.
    if (extra.length) throw new TypeError(`attack with refers takes only attack_type besides it; drop ${extra.join(", ")}: the earlier attack already says them.`);
    if (rest.attack_type === undefined) return { refers: rest.refers };
    if (!PRINTED_ATTACK_TYPES.includes(String(rest.attack_type))) throw new TypeError("attack with refers prints only melee, ranged or psychic as its attack_type; leave it out otherwise.");
    return { refers: rest.refers, attack_type: rest.attack_type };
  }
  for (const key of ["direction", "unit", "attack_type"]) {
    if (rest[key] === undefined) throw new TypeError(`attack.${key} is required unless the leaf refers to an earlier attack.`);
  }
  const { target, ...base } = rest;
  if (target !== undefined) {
    if (target !== "that-unit" && target !== "following-filter") throw new TypeError("attack.target must be that-unit or following-filter.");
    if (base.direction !== "makes") throw new TypeError("attack.target names what the attack targets, so the attack's direction must be makes.");
    if (base.unit === "that-unit") throw new TypeError("attack.target cannot go with unit that-unit: one unit would both make and receive the attack.");
  }
  exactKeys(base, ["direction", "unit", "attack_type"], "attack");
  return {
    direction: enumValue(base.direction, ATTACK_DIRECTIONS, "attack.direction"),
    unit: enumValue(base.unit, ATTACK_UNITS, "attack.unit"),
    attack_type: enumValue(base.attack_type, ATTACK_TYPES, "attack.attack_type"),
    ...(target !== undefined ? { target } : {}),
    ...(selection !== undefined ? { selection: selectionName(selection, "attack.selection") } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// eligibility-permission

const PERMISSION_SUBJECTS = ["this-unit", "this-model", ANTECEDENT, "event-subject", "filtered-units"] as const;
const PERMISSION_ACTIVITIES = [
  "shoot", "declare-charge", "fight", "start-action", "embark", "disembark", "fall-back",
  "advance", "use-stratagem", "issue-order", "attempt-ritual", "use-enhancement", "move", "observe",
] as const;
const PERMISSION_DESPITE = [
  "engaged", "battle-shocked", "shot-this-phase", "fought-this-phase", "disembarked-this-turn",
  "stratagem-used-this-phase", "performing-action", "advanced", "fell-back", "destroyed", "transport-advanced",
] as const;
const PERMISSION_AS_IF = ["shooting-phase", "snap-shooting", "fight-phase"] as const;
const PERMISSION_INTO = ["antecedent", "following-filter", "selection", "this-unit"] as const;
const TRANSPORT_ADVANCED = "transport-advanced";
const MAX_REACH = 12;

function normalizeEligibilityPermission(input: Params): Params {
  const {
    engaged_with_move_end: engagedWithMoveEnd, into, reach, next, model_name: modelName, weapon_names: weaponNames, ...base
  } = input;
  if (Array.isArray(input.despite) && input.despite.includes(TRANSPORT_ADVANCED)) {
    if (input.activity !== "disembark") throw new TypeError("eligibility-permission.despite transport-advanced applies only to activity: disembark.");
    if (input.despite.filter((value) => value === TRANSPORT_ADVANCED).length !== 1) throw new TypeError("eligibility-permission.despite lists transport-advanced twice.");
  }
  if (modelName !== undefined || weaponNames !== undefined) {
    if (input.allow !== true) throw new TypeError("eligibility-permission.model_name and weapon_names need allow: true.");
  }
  if (reach !== undefined || next !== undefined) {
    if (input.activity !== "fight") throw new TypeError("eligibility-permission.reach and next apply only to activity: fight.");
    if (input.allow !== true) throw new TypeError("eligibility-permission.reach and next need allow: true.");
  }
  if ("into" in input && input.activity !== "embark") throw new TypeError("eligibility-permission.into applies only to activity: embark.");
  exactKeys(base, ["subject", "activity", "allow", ...["despite", "as_if", "stratagem"].filter((key) => key in base)], "eligibility-permission");
  const result: Params = {
    subject: enumValue(base.subject, PERMISSION_SUBJECTS, "eligibility-permission.subject"),
    activity: enumValue(base.activity, PERMISSION_ACTIVITIES, "eligibility-permission.activity"),
    allow: booleanValue(base.allow, "eligibility-permission.allow"),
  };
  if ("despite" in base) result.despite = enumSet(base.despite, PERMISSION_DESPITE, "eligibility-permission.despite");
  if ("as_if" in base) result.as_if = enumValue(base.as_if, PERMISSION_AS_IF, "eligibility-permission.as_if");
  const needsStratagem = ((result.despite as string[] | undefined) ?? []).includes("stratagem-used-this-phase");
  if (needsStratagem !== ("stratagem" in base)) {
    throw new TypeError("eligibility-permission.stratagem is required exactly when despite includes stratagem-used-this-phase.");
  }
  if ("stratagem" in base) {
    const stratagem = String(base.stratagem ?? "");
    if (!KEBAB_ID.test(stratagem)) throw new TypeError("eligibility-permission.stratagem must be a kebab-case id.");
    result.stratagem = stratagem;
  }
  if (engagedWithMoveEnd !== undefined) {
    if (engagedWithMoveEnd !== true) throw new TypeError("eligibility-permission.engaged_with_move_end must be true.");
    if (!((result.despite as string[] | undefined) ?? []).includes("engaged")) throw new TypeError("eligibility-permission.engaged_with_move_end needs despite to include engaged.");
    result.engaged_with_move_end = true;
  }
  if ("into" in input) result.into = enumValue(into, PERMISSION_INTO, "eligibility-permission.into");
  if (reach !== undefined) result.reach = boundedInteger(reach, 1, MAX_REACH, "eligibility-permission.reach");
  if (next !== undefined) {
    if (next !== true) throw new TypeError("eligibility-permission.next must be true.");
    result.next = true;
  }
  if (modelName !== undefined) {
    // Only a unit has models to pick from.
    if (result.subject === "this-model") throw new TypeError("eligibility-permission.model_name picks models of a unit; its subject cannot be this-model.");
    if (typeof modelName !== "string" || modelName.trim().length === 0) throw new TypeError("eligibility-permission.model_name is the model's profile name as its datasheet prints it.");
    result.model_name = modelName.trim();
  }
  if (weaponNames !== undefined) {
    if (result.activity !== "shoot") throw new TypeError("eligibility-permission.weapon_names apply only to activity: shoot.");
    if (!Array.isArray(weaponNames) || weaponNames.length === 0) throw new TypeError("eligibility-permission.weapon_names lists at least one weapon.");
    const names = weaponNames.map((name) => {
      if (typeof name !== "string" || name.trim().length === 0) throw new TypeError("eligibility-permission.weapon_names are weapon names as their datasheets print them.");
      return name.trim().toLowerCase();
    });
    if (new Set(names).size !== names.length) throw new TypeError("eligibility-permission.weapon_names lists a weapon twice.");
    result.weapon_names = names;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// targeting-restriction

const RESTRICTION_SUBJECTS = ["this-unit", "this-model", "enemy-units", ANTECEDENT] as const;
const TARGETING_MAY = ["target", "cannot-target", "must-target"] as const;
const TARGETING_KINDS = ["attack", "shoot", "fight", "charge", "stratagem"] as const;
const RESTRICTION_KINDS = [...TARGETING_KINDS, "ability"] as const;
const WEAPON_SCOPES = ["all", "melee", "ranged"] as const;
/** The units a targeting restriction can name on either side of the by form. */
const TARGETING_UNITS = ["this-unit", "this-model", "selected-unit", "event-subject", "enemy-units", "friendly-units", ANTECEDENT] as const;
const TARGET_HISTORY = ["engaged-with-by-at-turn-start", "attacked-by-another-unit-this-phase", "charged-by-another-unit-this-phase", "fell-back-this-phase"] as const;
const AFTER_MOVES = ["advance", "fall-back"] as const;
const RESELECT_KINDS = ["charge", "attack", "shoot", "fight"] as const;
const MAX_INCHES = 48;

function normalizeTargetingRestriction(input: Params): Params {
  if (input.may === "reselect") {
    exactKeys(input, ["subject", "may", "kind", "weapon_type"], "targeting-restriction");
    enumValue(input.kind, RESELECT_KINDS, "targeting-restriction.kind with may reselect");
    if (input.weapon_type !== "all") throw new TypeError("targeting-restriction with may reselect takes weapon_type all.");
    const subject = enumValue(input.subject, ["this-unit", "event-subject"], "targeting-restriction.subject with may reselect");
    return { subject, may: "reselect", kind: input.kind, weapon_type: "all" };
  }
  const byForm = "by" in input || "target" in input;
  const added: Params = {};
  const history = input.target_history;
  if (Array.isArray(history) && history.includes("fell-back-this-phase") && !("by" in input)) {
    throw new TypeError("targeting-restriction.target_history is relative to the unit that targets; it needs the by form.");
  }
  const { target_history: _history, kinds, after_moves: afterMoves, not_engaged_with: notEngagedWith, ...rest } = input;
  if (history !== undefined || kinds !== undefined || afterMoves !== undefined) {
    if (!("by" in input)) throw new TypeError("targeting-restriction.target_history, kinds and after_moves are relative to the unit that targets; they need the by form.");
    if (history !== undefined) added.target_history = enumSet(history, TARGET_HISTORY, "targeting-restriction.target_history");
    if (afterMoves !== undefined) added.after_moves = enumSet(afterMoves, AFTER_MOVES, "targeting-restriction.after_moves");
  }
  if (kinds !== undefined) {
    if ("kind" in input) throw new TypeError("targeting-restriction names either kind or kinds, not both.");
    const list = enumSet(kinds, RESTRICTION_KINDS, "targeting-restriction.kinds");
    if (list.length < 2) throw new TypeError("targeting-restriction.kinds names two or more kinds; one kind is kind.");
    if ("stratagem" in input || "ability" in input || "except" in input) throw new TypeError("targeting-restriction.kinds names no one Stratagem or ability.");
    added.kinds = list;
  } else if (input.kind === "ability") {
    if ("stratagem" in input || "except" in input) throw new TypeError("targeting-restriction of kind ability names no Stratagem.");
  } else if ("ability" in input) {
    throw new TypeError("targeting-restriction.ability names the ability of kind ability only.");
  }
  const { by, target, stratagem, except, ability, ...base } = rest;
  if (byForm) {
    if ("subject" in input) throw new TypeError("targeting-restriction names either subject or target and by, not both.");
    if (!("target" in input)) throw new TypeError("targeting-restriction.by needs a target: the unit being targeted.");
    added.target = enumValue(target, [...TARGETING_UNITS, MATCHED_UNITS], "targeting-restriction.target");
    if ("by" in input) {
      added.by = enumValue(by, TARGETING_UNITS, "targeting-restriction.by");
      if (added.by === added.target && added.by !== ANTECEDENT) throw new TypeError("targeting-restriction.by and target name the same unit.");
    }
  } else if ("stratagem" in input || "except" in input) {
    throw new TypeError("targeting-restriction.stratagem and except need target (and by), not subject.");
  }
  // The may, kind, weapon type and range every form shares.
  const may = enumValue(base.may, TARGETING_MAY, "targeting-restriction.may");
  exactKeys(base, [...(byForm ? [] : ["subject"]), "may", ...(kinds === undefined ? ["kind"] : []), "weapon_type", ...("range" in base ? ["range"] : [])], "targeting-restriction");
  if ("range" in base && may !== "cannot-target" && may !== "target") {
    throw new TypeError("targeting-restriction.range only applies when may is cannot-target or target.");
  }
  const result: Params = {
    ...(byForm ? {} : { subject: enumValue(base.subject, RESTRICTION_SUBJECTS, "targeting-restriction.subject") }),
    may,
    ...(kinds === undefined ? { kind: enumValue(base.kind, RESTRICTION_KINDS, "targeting-restriction.kind") } : {}),
    weapon_type: enumValue(base.weapon_type, WEAPON_SCOPES, "targeting-restriction.weapon_type"),
  };
  if ("range" in base) result.range = boundedInteger(base.range, 1, MAX_INCHES, "targeting-restriction.range");
  if ("stratagem" in input) {
    if (result.kind !== "stratagem") throw new TypeError("targeting-restriction.stratagem names the Stratagem of kind stratagem only.");
    if (typeof stratagem !== "string" || !KEBAB_ID.test(stratagem)) throw new TypeError("targeting-restriction.stratagem is the Stratagem's kebab-case id.");
    added.stratagem = stratagem;
  }
  if ("except" in input) {
    if (except !== "core-stratagems" || result.kind !== "stratagem" || may !== "cannot-target") throw new TypeError("targeting-restriction.except is core-stratagems, on a cannot-target of kind stratagem only.");
    if ("stratagem" in input) throw new TypeError("targeting-restriction.except leaves out Core Stratagems from all Stratagems; it cannot go with one named Stratagem.");
    added.except = except;
  }
  if (result.kind === "ability" && ability !== undefined) {
    if (!("target" in input)) throw new TypeError("targeting-restriction.ability needs target: the unit the ability would select.");
    if (typeof ability !== "string" || !KEBAB_ID.test(ability)) throw new TypeError("targeting-restriction.ability is the ability's kebab-case record id.");
    added.ability = ability;
  }
  if (notEngagedWith !== undefined) {
    if (may !== "target") throw new TypeError("targeting-restriction.not_engaged_with only applies when may is target.");
    added.not_engaged_with = enumValue(notEngagedWith, ["this-unit"], "targeting-restriction.not_engaged_with");
  }
  return { ...result, ...added };
}

// ---------------------------------------------------------------------------------------------
// counts-as, rule-state, damage-reduction

const SUBJECTS = ["this-unit", "this-model"] as const;
const REGION_KEYS = ["region_id", "owner_faction"] as const;

/** counts-as: within a range, inside an army rule's region, or inside a named range of your host. */
function normalizeCountsAs(input: Params): Params {
  const subject = input.subject;
  const grantable = subject === ANTECEDENT || subject === "this-unit" || subject === "this-model";
  if ("range_ref" in input) {
    if ("within" in input) throw new TypeError("counts-as takes within, region or range_ref, not within and range_ref.");
    if ("region" in input) throw new TypeError("counts-as takes within, region or range_ref, not region and range_ref.");
    if (input.range_ref !== "synapse") throw new TypeError(`counts-as.range_ref ${JSON.stringify(input.range_ref)} is not a grantable named range.`);
    if (input.of_side !== "friendly") throw new TypeError("counts-as.range_ref names whose units the range is measured to: of_side friendly.");
    if (!grantable) throw new TypeError(`counts-as.subject ${JSON.stringify(subject)} cannot take a named range.`);
    return { subject, range_ref: "synapse", of_side: "friendly" };
  }
  if ("of_side" in input) throw new TypeError("counts-as.of_side goes with range_ref.");
  if ("region" in input) {
    if ("within" in input) throw new TypeError("counts-as takes within or region, not both.");
    if (!grantable) throw new TypeError(`counts-as.subject ${JSON.stringify(subject)} cannot take a region.`);
    const region = input.region as Params | undefined;
    if (typeof region !== "object" || region === null || Array.isArray(region)) throw new TypeError("counts-as.region must be an object.");
    if (Object.keys(region).sort().join(",") !== [...REGION_KEYS].sort().join(",")) throw new TypeError("counts-as.region takes exactly region_id and owner_faction.");
    for (const key of REGION_KEYS) {
      if (typeof region[key] !== "string" || !KEBAB_ID.test(region[key] as string)) throw new TypeError(`counts-as.region.${key} must be a kebab-case entity id.`);
    }
    return { subject, region: { region_id: region.region_id, owner_faction: region.owner_faction } };
  }
  exactKeys(input, ["subject", "within"], "counts-as");
  return { subject: enumValue(subject, [...SUBJECTS, ANTECEDENT], "counts-as.subject"), within: boundedInteger(input.within, 1, MAX_INCHES, "counts-as.within") };
}

const RULE_KINDS = ["core-rule", "keyword", "ability", "faction-rule"] as const;
/** Subjects beyond this unit or model; any value whose text is one of these is accepted as written. */
const RULE_STATE_OTHER_SUBJECTS = ["selected-unit", "event-subject", "target", ANTECEDENT];

function ruleStateCore(input: Params): Params {
  exactKeys(input, ["subject", "direction", "rule_kind", "rule"], "rule-state");
  const ruleKind = enumValue(input.rule_kind, RULE_KINDS, "rule-state.rule_kind");
  const rule = String(input.rule ?? "");
  if (ruleKind === "keyword") {
    if (!ASCII_KEYWORD.test(rule)) throw new TypeError("rule-state.rule must be an uppercase keyword when rule_kind is keyword.");
  } else if (!KEBAB_ID.test(rule)) {
    throw new TypeError("rule-state.rule must be a kebab-case id when rule_kind is not keyword.");
  }
  // The subject is compared as text, so a value that prints as one of the other subjects stays as given.
  const subject = RULE_STATE_OTHER_SUBJECTS.includes(String(input.subject)) ? input.subject : enumValue(input.subject, SUBJECTS, "rule-state.subject");
  return {
    subject,
    direction: enumValue(input.direction, ["granted", "suppressed"], "rule-state.direction"),
    rule_kind: ruleKind,
    rule,
  };
}

function normalizeRuleState(input: Params): Params {
  const { any_army_faction: any, ...rest } = input;
  const result = withLeadingApostrophes("rule-state", rest, ruleStateCore);
  if (any === undefined) return result;
  if (any !== true) throw new TypeError("rule-state.any_army_faction is true or omitted.");
  if (result.direction !== "granted" || result.rule_kind !== "faction-rule") throw new TypeError("rule-state.any_army_faction goes with a granted faction rule.");
  return { ...result, any_army_faction: true };
}

function normalizeDamageReduction(input: Params): Params {
  exactKeys(input, ["subject", "reduction", "weapon_type"], "damage-reduction");
  return {
    subject: enumValue(input.subject, [...SUBJECTS, ANTECEDENT], "damage-reduction.subject"),
    reduction: enumValue(input.reduction, ["1", "2", "half", "to-zero"], "damage-reduction.reduction"),
    weapon_type: enumValue(input.weapon_type, WEAPON_SCOPES, "damage-reduction.weapon_type"),
  };
}
export const TARGETING_AND_PERMISSIONS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "damage-reduction",
    version: 2,
    role: "EFFECT",
    label: "Reduce Damage allocated to it",
    description: "Each time an attack (optionally only melee or ranged) is allocated to this unit or model, or to the unit or model an earlier leaf introduced (antecedent: \"… for a friendly X model within 6\", change the Damage of that attack to 0\"), reduce its Damage characteristic by 1, by 2, halve it, or change it to 0.",
    starter: { subject: "", reduction: "", weapon_type: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "reduction", "weapon_type"],
      properties: { subject: { enum: ["this-unit", "this-model", "antecedent"] }, reduction: { enum: ["1", "2", "half", "to-zero"] }, weapon_type: { enum: ["all", "melee", "ranged"] } },
      additionalProperties: false,
    },
    normalize: normalizeDamageReduction,
  },
  {
    id: "counts-as",
    version: 3,
    role: "EFFECT",
    label: "Counts as being within range",
    description: "This unit or model, or the unit an earlier leaf introduced, counts as being within a range of this model for the purposes of another rule (a Titan-killer's range, an aura counting itself); or counts as inside a region an army rule defines (region: \"that unit is within your army's Hallowed Ground\"); or counts as within a named range of your host (range_ref synapse with of_side friendly: \"that unit is inside Synapse Range of your host\"). Exactly one of within, region or range_ref is given.",
    starter: { subject: "", within: 1 },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "antecedent"] },
        within: { type: "integer", minimum: 1, maximum: 48 },
        region: {
          type: "object",
          required: ["region_id", "owner_faction"],
          properties: { region_id: { type: "string", pattern: KEBAB_ID_PATTERN }, owner_faction: { type: "string", pattern: KEBAB_ID_PATTERN } },
          additionalProperties: false,
        },
        range_ref: { enum: ["synapse"], "x-optional": true },
        of_side: { enum: ["friendly"], "x-only-when": { range_ref: ["synapse"] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeCountsAs,
  },
  {
    id: "rule-state",
    version: 4,
    role: "EFFECT",
    label: "Grant or suppress a named rule",
    description: "A unit or model gains or loses a core rule, keyword, ability, or faction rule (a core-rule slug such as the -1 to Hit for shooting in Engagement Range, or a keyword or ability by its own id). The subject is this unit or model, a selected unit, the triggering unit, the attack's target, or an earlier leaf's unit (antecedent): \"that enemy unit cannot have the Benefit of Cover\". A keyword can start with an apostrophe as the rules print it ('ARDMOB). any_army_faction: a granted faction rule the subject can use whatever your Army Faction is (\"even though your Army Faction is not X\").",
    starter: { subject: "", direction: "", rule_kind: "", rule: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "direction", "rule_kind", "rule"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "selected-unit", "event-subject", "target", "antecedent"] },
        direction: { enum: ["granted", "suppressed"] },
        rule_kind: { enum: ["core-rule", "keyword", "ability", "faction-rule"] },
        rule: { type: "string", minLength: 1 },
        any_army_faction: { const: true, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeRuleState,
  },
  {
    id: "eligibility-permission",
    version: 10,
    role: "EFFECT",
    label: "Allow or forbid an activity",
    description: "A unit or model is (or is not) eligible to shoot, charge, fight, embark, disembark, Fall Back, Advance, be targeted with Stratagems, issue Orders, attempt Rituals, use Enhancements, move, or act as an Observer, optionally even if something would normally block it (including being just destroyed, so a Stratagem can still target it, and, for a disembark, the Transport having Advanced: transport-advanced), or as if in a different phase. "
      + "The subject is this unit or model, the unit an earlier leaf of the record introduced (antecedent: \"that enemy unit\", \"it\"), the triggering unit (event-subject: the unit a move-ended event names), or the units a unit-filter names right before the permission (filtered-units: \"units cannot embark within this unit\"). "
      + "engaged_with_move_end: the permission applies within Engagement Range of the enemy unit the same ability's move ends nearest, not any engaged unit (despite includes engaged). into: the Transport an embark permission places the subject within (antecedent, following-filter, selection, this-unit), only with activity embark. "
      + "reach (1 to 12 inches: models that far from an enemy are eligible to fight) and next (true: the unit must be the next one selected to fight), only with activity fight and allow true. "
      + "model_name (only the subject's models with this profile name, \"the Tempestor Aquilon\") and weapon_names (a shoot permission allows only these weapons, any one of them, as their datasheets print them); both need allow true, and model_name needs a unit subject.",
    starter: { subject: "", activity: "", allow: true },
    parameterSchema: {
      type: "object",
      required: ["subject", "activity", "allow"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "antecedent", "event-subject", "filtered-units"] },
        activity: { enum: [...PERMISSION_ACTIVITIES] },
        allow: { type: "boolean" },
        despite: { type: "array", items: { enum: [...PERMISSION_DESPITE] }, minItems: 1, uniqueItems: true },
        as_if: { enum: ["shooting-phase", "snap-shooting", "fight-phase"] },
        stratagem: { type: "string", pattern: KEBAB_ID_PATTERN, "x-only-when": { despite: ["stratagem-used-this-phase"] } },
        engaged_with_move_end: { const: true, "x-only-when": { despite: ["engaged"] }, "x-optional": true },
        into: { enum: ["antecedent", "following-filter", "selection", "this-unit"], "x-only-when": { activity: ["embark"] }, "x-optional": true },
        reach: { type: "integer", minimum: 1, maximum: 12, "x-only-when": { activity: ["fight"] }, "x-optional": true },
        next: { const: true, "x-only-when": { activity: ["fight"] }, "x-optional": true },
        model_name: { type: "string", minLength: 1, "x-optional": true },
        weapon_names: { ...STRING_LIST_SCHEMA, "x-only-when": { activity: ["shoot"] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeEligibilityPermission,
  },
  {
    id: "attack",
    version: 9,
    role: "EVENT",
    label: "Each time an attack is made",
    description: "An attack made by the named model or unit, or an attack that targets it, optionally only melee, ranged or psychic. \"The bearer\" is this model; recipient is the unit an aura applies to; friendly-unit is any friendly unit (\"each time a friendly unit makes an attack that targets that enemy unit\"); enemy-unit is an enemy unit (\"each time an enemy model makes a ranged attack\"), whose units a unit-filter right before it names. What the attack targets is a separate condition, or, on direction makes, target: that-unit, a unit an earlier leaf introduced (\"an X unit … targets that unit\"), a designation's unit or else the selected unit; following-filter, any unit the unit-filter right after this attack matches (\"makes a ranged attack that targets an enemy unit\"); neither goes with unit that-unit. "
      + "refers earlier-attack: \"that attack\", \"those attacks\", \"such an attack\", \"the target of that attack\" name the attack an earlier attack leaf of the record introduced, so the leaf records only the back-reference (and attack_type when the anaphor prints one, \"those ranged attacks\"); refers earlier-permission: resolving the attacks made by the nearest preceding allowed shoot or fight permission in the same fragment, whose actor and attack type it takes and whose attack modifiers last only for that resolution. "
      + "selection: the bind_as of the select-unit the unit names when the record selects several units (\"each time a model in the selected Y unit makes an attack\"); only with unit that-unit.",
    starter: { direction: "", unit: "", attack_type: "" },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        direction: { enum: ["makes", "targeted"] },
        unit: { enum: [...ATTACK_UNITS] },
        attack_type: { enum: ["any", "melee", "ranged", "psychic"] },
        refers: { enum: ["earlier-attack", "earlier-permission"], "x-optional": true },
        target: { enum: ["that-unit", "following-filter"], "x-only-when": { direction: ["makes"] }, "x-optional": true },
        selection: { ...SELECTION_NAME_SCHEMA, "x-only-when": { unit: ["that-unit"] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeAttack,
  },
  {
    id: "targeting-restriction",
    version: 9,
    role: "EFFECT",
    label: "Who may target whom",
    description: "A unit may, may not, or must target something with an attack, a Stratagem, a selection by an ability, or a specific kind of attack, optionally only within a range or with a kind of weapon. "
      + "On the subject form, the subject is this unit, this model, enemy units, or the unit an earlier leaf of the record introduced (antecedent: \"that enemy unit\", \"it\"); may reselect: the subject (this unit, or event-subject: the unit whose selection triggered the ability) having selected targets of kind charge, attack, shoot or fight, can select new ones for that same action, with weapon_type all and no range, target or by. "
      + "On the by form, target (the unit being targeted, or matched-units: the units an earlier unit-position of matching-unit introduced) and optionally by (the unit that targets) replace subject: \"this unit can only target that enemy unit\" is by this unit, target that unit; \"this unit cannot be targeted by ranged attacks\" is target this unit with no by. With target, stratagem names the one Stratagem (kind stratagem), except: core-stratagems keeps Core Stratagems allowed (\"other than Core Stratagems\"), and ability names the one ability's record id whose selection this limits (kind ability: \"that unit cannot be selected as part of the Noospheric Transference Detachment rule\"). "
      + "With by: target_history (the restriction covers only targets with any of this history, relative to by: engaged-with-by-at-turn-start, attacked-by-another-unit-this-phase, charged-by-another-unit-this-phase, fell-back-this-phase), kinds (two or more kinds in place of kind: \"shoot and declare a charge … it cannot target\") and after_moves (the restriction holds only in a turn by made one of these moves: advance, fall-back). "
      + "not_engaged_with: this-unit, on a may target restriction: when targets are selected, the units it names are not considered to be within Engagement Range of this unit (ranged attacks can target enemy units engaged with it).",
    starter: { subject: "", may: "", kind: "", weapon_type: "" },
    parameterSchema: {
      type: "object",
      required: ["may", "weapon_type"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "enemy-units", "antecedent", "event-subject"], "x-optional": true },
        may: { enum: ["target", "cannot-target", "must-target", "reselect"] },
        kind: { enum: [...RESTRICTION_KINDS] },
        weapon_type: { enum: ["all", "melee", "ranged"] },
        range: { type: "integer", minimum: 1, maximum: 48, "x-only-when": { may: ["cannot-target", "target"] } },
        by: { enum: [...TARGETING_UNITS], "x-optional": true },
        target: { enum: [...TARGETING_UNITS, "matched-units"], "x-optional": true },
        stratagem: { type: "string", pattern: KEBAB_ID_PATTERN, "x-only-when": { kind: ["stratagem"] }, "x-optional": true },
        except: { const: "core-stratagems", "x-only-when": { kind: ["stratagem"], may: ["cannot-target"] }, "x-optional": true },
        ability: { type: "string", pattern: KEBAB_ID_PATTERN, "x-only-when": { kind: ["ability"] }, "x-optional": true },
        target_history: { type: "array", items: { enum: [...TARGET_HISTORY] }, minItems: 1, uniqueItems: true, "x-optional": true },
        kinds: { type: "array", items: { enum: [...RESTRICTION_KINDS] }, minItems: 2, uniqueItems: true, "x-optional": true },
        after_moves: { type: "array", items: { enum: ["advance", "fall-back"] }, minItems: 1, uniqueItems: true, "x-optional": true },
        not_engaged_with: { enum: ["this-unit"], "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeTargetingRestriction,
  },
];
