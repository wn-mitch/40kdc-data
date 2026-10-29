import type { ValidateFunction } from "ajv";
import { createValidator } from "../../schema-loader.js";
import { ANTECEDENT } from "../antecedent-families.js";
import type { SemanticFamilyDefinition } from "../contracts.js";
import { ENTITY_ID_PATTERN } from "../core-families.js";
import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";

const COMMON_SCHEMA = "https://40kdc.dev/schemas/defs/common.schema.json";
const EFFECT_SCHEMA = "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json";
type CanonicalValidator = ValidateFunction<unknown>;

let namedRegionRecipeValidators: { region: CanonicalValidator; phaseExtension: CanonicalValidator } | undefined;

/** Validate recipe fragments against the same closed contracts that accept compiled DSL output. */
function recipeValidators(): { region: CanonicalValidator; phaseExtension: CanonicalValidator } {
  if (namedRegionRecipeValidators) return namedRegionRecipeValidators;
  const ajv = createValidator();
  namedRegionRecipeValidators = {
    region: ajv.compile({ $ref: `${COMMON_SCHEMA}#/$defs/region-ref` }),
    phaseExtension: ajv.compile({ $ref: `${EFFECT_SCHEMA}#/$defs/named-region-phase-extension` }),
  };
  return namedRegionRecipeValidators;
}

function canonicalRecipeFragment(value: unknown, label: string, validate: CanonicalValidator): Record<string, unknown> {
  if (!validate(value)) throw new TypeError(`${label} must satisfy the canonical named-region contract: ${JSON.stringify(validate.errors ?? [])}`);
  return structuredClone(value) as Record<string, unknown>;
}

/**
 * Versions of the region, range-alias, membership and marker families (in-region, counts-as,
 * membership, battlefield-marker), and the engagement-exclusive base family. Each version checks
 * only its own additions and hands the rest of a leaf to the previous version, so every earlier
 * leaf still fits it unchanged.
 */

const REGION_KEYS = ["region_id", "owner_faction"] as const;

/** The region id and owner faction of a rule region, checked as entity ids. */
function ruleRegion(input: Record<string, unknown>, label: string): { region_id: string; owner_faction: string } {
  for (const key of REGION_KEYS) {
    const value = input[key];
    if (typeof value !== "string" || !ENTITY_ID_PATTERN.test(value)) throw new TypeError(`${label}.${key} must be a kebab-case entity id.`);
  }
  return { region_id: input.region_id as string, owner_faction: input.owner_faction as string };
}

const REGION_SCHEMA = {
  type: "object",
  required: [...REGION_KEYS],
  properties: {
    region_id: { type: "string", pattern: ENTITY_ID_PATTERN.source },
    owner_faction: { type: "string", pattern: ENTITY_ID_PATTERN.source },
  },
  additionalProperties: false,
};

/** The membership value that names the unit a moment names (compile-antecedent.ts binds it). */
export const MOMENT_UNIT = "antecedent";

/**
 * Engagement relations. "engaged with nothing except your FORTIFICATIONS" is a marker leaf,
 * `engagement-exclusive`, that qualifies the engaged state after it
 * (compile-engagement-exclusive.ts). "is within Engagement Range of one or more" takes the
 * Engagement Range itself as its distance: unit-position range_ref engagement (positions.ts).
 */

/** A base family: the leaf takes no parameters; the state it qualifies is its following unit-state. */
export const ENGAGEMENT_RELATION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "engagement-exclusive",
    version: 1,
    role: "CONDITION",
    label: "Engaged with only",
    description: "Qualifies the engaged state that follows: engaged with the named units and no others (\"only within Engagement Range of one or more FORTIFICATIONS from your army\"). Takes no parameters.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const REGION_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "if a friendly X unit is within a terrain area, that unit …": the units an earlier filter matches.
    family: "in-region",
    version: 2,
    description: "As the previous version, plus subject antecedent: the unit an earlier leaf introduced (\"if a friendly X unit is wholly within a terrain area, that unit …\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  /**
   * Named army regions (an army rule defines the region, such as "your army's Power Matrix"). A
   * region is named by its `region_id` and the `owner_faction` whose army rule defines it. It is
   * never a terrain piece on the board.
   */
  {
    // "wholly within your army's Power Matrix": the army rule's own region, not a terrain piece.
    family: "in-region",
    version: 3,
    description: "As the previous version, plus region_kind rule-region: a region an army rule defines (\"wholly within your army's Flow of Magic\"), named by region_id and owner_faction. Such a leaf takes no terrain_tag or territory.",
    schema: (previous) => withProperties(previous, {
      region_kind: widenedEnum(previous, "region_kind", ["rule-region"]),
      region_id: { type: "string", pattern: ENTITY_ID_PATTERN.source, "x-only-when": { region_kind: ["rule-region"] } },
      owner_faction: { type: "string", pattern: ENTITY_ID_PATTERN.source, "x-only-when": { region_kind: ["rule-region"] } },
    }),
    normalize: (input, previous) => {
      if (input.region_kind !== "rule-region") return previous(input);
      if ("terrain_tag" in input || "territory" in input) throw new TypeError("in-region with region_kind rule-region takes region_id and owner_faction, not terrain_tag or territory.");
      const region = ruleRegion(input, "in-region");
      const { region_id: _id, owner_faction: _owner, region_kind: _kind, ...rest } = input;
      // The previous version checks subject, wholly, models and negated with a terrain area standing in for the region.
      const { terrain_tag: _placeholder, ...checked } = previous({ ...rest, region_kind: "terrain-area", terrain_tag: "rule-region" });
      return { ...checked, region_kind: "rule-region", ...region };
    },
  },
  /**
   * A named army region, as in-region version 3 names it.
   */
  {
    // "that unit is within your army's Hallowed Ground until the end of the phase": a granted region.
    // The counts-as grant names the region; the within form and the subject antecedent are as before.
    family: "counts-as",
    version: 2,
    description: "As the previous version, plus region: the target counts as inside a region an army rule defines (\"that unit is within your army's Hallowed Ground\"), instead of a range. Exactly one of within or region is given. The subject may also be the unit an earlier leaf introduced.",
    schema: (previous) => ({
      ...withProperties(previous, {
        subject: widenedEnum(previous, "subject", [ANTECEDENT]),
        region: REGION_SCHEMA,
      }),
      required: ["subject"],
    }),
    normalize: (input, previous) => {
      if (!("region" in input)) {
        if (input.subject === ANTECEDENT) return standIn(input, "subject", "this-unit", previous);
        return previous(input);
      }
      if ("within" in input) throw new TypeError("counts-as takes within or region, not both.");
      const subject = input.subject;
      if (subject !== ANTECEDENT && subject !== "this-unit" && subject !== "this-model") throw new TypeError(`counts-as.subject ${JSON.stringify(subject)} cannot take a region.`);
      const region = input.region as Record<string, unknown> | undefined;
      if (typeof region !== "object" || region === null || Array.isArray(region)) throw new TypeError("counts-as.region must be an object.");
      const keys = Object.keys(region).sort();
      if (keys.join(",") !== [...REGION_KEYS].sort().join(",")) throw new TypeError("counts-as.region takes exactly region_id and owner_faction.");
      return { subject, region: ruleRegion(region, "counts-as.region") };
    },
  },
  /**
   * A named range's aura (`range_ref`) in place of inches, as unit-position version 15 takes it.
   */
  {
    // "that foe unit has the effect … and sits inside Contagion Range of your host" / "that unit is inside Synapse Range of your host".
    family: "counts-as",
    version: 3,
    description: "As the previous version, plus range_ref synapse with of_side friendly: the target counts as within a named range of your host (\"that unit is inside Synapse Range of your host\"). Takes no within and no region; the subject is the antecedent, this unit or this model.",
    schema: (previous) => withProperties(previous, {
      range_ref: optional({ enum: ["synapse"] }),
      of_side: optional({ enum: ["friendly"], "x-only-when": { range_ref: ["synapse"] } }),
    }),
    normalize: (input, previous) => {
      if (!("range_ref" in input)) {
        if ("of_side" in input) throw new TypeError("counts-as.of_side goes with range_ref.");
        return previous(input);
      }
      if ("within" in input) throw new TypeError("counts-as takes within, region or range_ref, not within and range_ref.");
      if ("region" in input) throw new TypeError("counts-as takes within, region or range_ref, not region and range_ref.");
      if (input.range_ref !== "synapse") throw new TypeError(`counts-as.range_ref ${JSON.stringify(input.range_ref)} is not a grantable named range.`);
      if (input.of_side !== "friendly") throw new TypeError("counts-as.range_ref names whose units the range is measured to: of_side friendly.");
      const subject = input.subject;
      if (subject !== ANTECEDENT && subject !== "this-unit" && subject !== "this-model") throw new TypeError(`counts-as.subject ${JSON.stringify(subject)} cannot take a named range.`);
      return { subject, range_ref: "synapse", of_side: "friendly" };
    },
  },
  /**
   * Membership of a Stratagem's target: "your unit" after a model-level unit-filter on a Stratagem
   * names the unit the Stratagem targets, which the selected model must share. Version 1 keeps
   * this-unit and this-model; the new value is a Stratagem's target only, and only "in" (a model of
   * that unit) can name it.
   */
  {
    family: "membership",
    version: 2,
    description: "As the previous version, plus of: stratagem-target, the Stratagem's target unit (\"in your unit\" on a Stratagem). Only relation in can name it; this-unit and this-model keep their meaning.",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", ["stratagem-target"]),
    }),
    normalize: (input, previous) => {
      if (input.of !== "stratagem-target") return previous(input);
      if (input.relation !== "in") throw new TypeError("membership of a Stratagem's target is only a model of that unit (relation in).");
      return standIn(input, "of", "this-unit", previous);
    },
  },
  /**
   * The membership leaf accepts the moment's unit as a value, for a model-level unit-filter's
   * `member_of`.
   */
  {
    // "Character models in that unit" after a moment: the membership names the moment's unit.
    family: "membership",
    version: 3,
    description: "As the previous version, plus of: antecedent, the unit the record's moment names (\"that unit's Character models\" after \"when a friendly X unit is selected\"). Only relation in can name it; the other values keep their meaning.",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", [MOMENT_UNIT]),
    }),
    normalize: (input, previous) => {
      if (input.of !== MOMENT_UNIT) return previous(input);
      if (input.relation !== "in") throw new TypeError("membership of the moment's unit is only a model of that unit (relation in).");
      return standIn(input, "of", "this-unit", previous);
    },
  },
  {
    // "select one of your Cult Ambush markers that … has not been moved this turn and move it".
    family: "battlefield-marker",
    version: 2,
    description: "As the previous version, plus not_moved_this_turn: a relocate takes only a marker that has not been moved this turn.",
    schema: (previous) => withProperties(previous, { not_moved_this_turn: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (input.not_moved_this_turn === undefined) return previous(input);
      const { not_moved_this_turn: unmoved, ...rest } = input;
      if (unmoved !== true) throw new TypeError("battlefield-marker.not_moved_this_turn is true or absent.");
      if (rest.operation !== "relocate") throw new TypeError("battlefield-marker.not_moved_this_turn qualifies a relocate.");
      return { ...previous(rest), not_moved_this_turn: true };
    },
  },
  {
    family: "named-region-state",
    version: 2,
    description: "As the previous version, with optional canonical baseline_region and phase_extensions recipe values for reviewed named-region variants.",
    schema: (previous) => withProperties(previous, {
      baseline_region: optional({ type: "object", required: ["territory"], properties: { territory: { type: "string", minLength: 1 } }, additionalProperties: false }),
      phase_extensions: optional({ type: "array", items: { type: "object", minProperties: 1 }, minItems: 1 }),
    }),
    normalize: (input, previous) => {
      const { baseline_region: baseline, phase_extensions: phases, ...rest } = input;
      if (baseline === undefined && phases === undefined) return previous(input);
      if (baseline !== undefined && (baseline === null || typeof baseline !== "object" || Array.isArray(baseline))) {
        throw new TypeError("named-region-state.baseline_region must be an object.");
      }
      if (phases !== undefined) {
        if (!Array.isArray(phases) || phases.length === 0) throw new TypeError("named-region-state.phase_extensions must be a non-empty array.");
        for (const item of phases) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) throw new TypeError("named-region-state.phase_extensions items must be objects.");
          const condition = (item as Record<string, unknown>).condition;
          const parameters = condition !== null && typeof condition === "object" && !Array.isArray(condition)
            ? (condition as Record<string, unknown>).parameters : undefined;
          const proportion = parameters !== null && typeof parameters === "object" && !Array.isArray(parameters)
            ? (parameters as Record<string, unknown>).proportion : undefined;
          const comparison = proportion !== null && typeof proportion === "object" && !Array.isArray(proportion)
            ? (proportion as Record<string, unknown>).comparison : undefined;
          if (comparison !== undefined && !["gt", "gte", "lt", "lte", "eq"].includes(String(comparison))) {
            throw new TypeError("named-region-state.phase_extensions condition proportion comparison must be gt, gte, lt, lte, or eq.");
          }
        }
      }
      return {
        ...previous(rest),
        ...(baseline !== undefined ? { baseline_region: baseline } : {}),
        ...(phases !== undefined ? { phase_extensions: phases } : {}),
      };
    },
  },
  {
    family: "named-region-state",
    version: 3,
    description: "As the previous version, with canonical closed named-region recipe fragments, canonical entity ids, and nonblank qualifying keywords.",
    schema: (previous) => withProperties(previous, {
      region_id: { type: "string", pattern: ENTITY_ID_PATTERN.source },
      owner_faction: { type: "string", pattern: ENTITY_ID_PATTERN.source },
      beneficiary_faction: optional({ type: "string", pattern: ENTITY_ID_PATTERN.source }),
      qualifies_by_keyword: optional({ type: "string", pattern: "\\S" }),
      baseline_region: optional({ $ref: `${COMMON_SCHEMA}#/$defs/region-ref` }),
      phase_extensions: optional({
        type: "array",
        items: { $ref: `${EFFECT_SCHEMA}#/$defs/named-region-phase-extension` },
        minItems: 1,
      }),
    }),
    normalize: (input, previous) => {
      const historical = previous(input);
      const validators = recipeValidators();
      const baseline = historical.baseline_region === undefined
        ? undefined
        : canonicalRecipeFragment(historical.baseline_region, "named-region-state.baseline_region", validators.region);
      const phases = historical.phase_extensions === undefined
        ? undefined
        : (historical.phase_extensions as unknown[]).map((item, index) =>
            canonicalRecipeFragment(item, `named-region-state.phase_extensions[${index}]`, validators.phaseExtension));
      const normalized = {
        ...historical,
        ...(baseline !== undefined ? { baseline_region: baseline } : {}),
        ...(phases !== undefined ? { phase_extensions: phases } : {}),
      };
      ruleRegion(normalized, "named-region-state");
      if ("beneficiary_faction" in normalized) {
        const value = normalized.beneficiary_faction;
        if (typeof value !== "string" || !ENTITY_ID_PATTERN.test(value)) {
          throw new TypeError("named-region-state.beneficiary_faction must be a kebab-case entity id.");
        }
      }
      if ("qualifies_by_keyword" in normalized) {
        const value = normalized.qualifies_by_keyword;
        if (typeof value !== "string" || value.trim() === "") {
          throw new TypeError("named-region-state.qualifies_by_keyword must be a nonblank keyword.");
        }
      }
      return normalized;
    },
  },
];
