import { ANTECEDENT } from "./antecedent-families.js";
import { ENTITY_ID_PATTERN } from "./core-families.js";
import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Fifteenth round of family extensions: named army regions (an army rule defines the region, such
 * as "your army's Power Matrix"). A region is named by its `region_id` and the `owner_faction` whose
 * army rule defines it. It is never a terrain piece on the board.
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

export const FAMILY_EXTENSIONS_15_NAMED_REGION: readonly FamilyExtension[] = [
  {
    // "wholly within your army's Power Matrix": the army rule's own region, not a terrain piece.
    family: "in-region",
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
  {
    // "that unit is within your army's Hallowed Ground until the end of the phase": a granted region.
    // The counts-as grant names the region; the within form and the subject antecedent are as before.
    family: "counts-as",
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
];
