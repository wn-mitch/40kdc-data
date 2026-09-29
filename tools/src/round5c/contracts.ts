import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { sourceQualified } from "./family-validation.js";
import { BUFF_FAMILIES, normalizeBuffParameters } from "./buff-families.js";
import { CORE_FAMILIES, normalizeCoreParameters } from "./core-families.js";
import { EFFECT_FAMILIES, normalizeEffectParameters } from "./effect-families.js";
import { DICE_FAMILIES, normalizeDiceParameters } from "./dice-families.js";
import { normalizeRestrictionParameters, RESTRICTION_FAMILIES } from "./restriction-families.js";
import { normalizeTargetingParameters, TARGETING_FAMILIES } from "./targeting-families.js";
import { MOVEMENT_FAMILIES, normalizeMovementParameters } from "./movement-families.js";
import { ECONOMY_FAMILIES, normalizeEconomyParameters } from "./economy-families.js";
import { normalizeUnitStateParameters, UNIT_STATE_EFFECT_FAMILIES } from "./unit-state-families.js";
import { normalizeWeaponBuffParameters, WEAPON_BUFF_FAMILIES } from "./weapon-buff-families.js";
import { ABILITY_MODIFIER_FAMILIES, normalizeAbilityModifierParameters } from "./ability-modifier-families.js";
import { CONTAINER_FAMILIES, normalizeContainerParameters } from "./container-families.js";
import { NAMED_REGION_FAMILIES, normalizeNamedRegionParameters } from "./named-region-family.js";
import { normalizePredicateParameters, PREDICATE_FAMILIES } from "./predicate-families.js";
import { normalizePredicateParameters2, PREDICATE_FAMILIES_2 } from "./predicate-families-2.js";
import { normalizePredicateSubjectParameters, PREDICATE_SUBJECT_FAMILIES } from "./predicate-subject-families.js";

export const SEMANTIC_ROLES = ["EFFECT", "DURATION", "EVENT", "CONDITION"] as const;
export type SemanticRole = (typeof SEMANTIC_ROLES)[number];
/** Leaf roles: the proposal roles, combinators (which join leaves), and restrictions (limits on when and by whom an ability is used). */
export const LEAF_ROLES = [...SEMANTIC_ROLES, "COMBINATOR", "RESTRICTION"] as const;
export type LeafRole = (typeof LEAF_ROLES)[number];

type FamilyParameters = Record<string, unknown>;

export type SemanticFamilyDefinition = {
  id: string;
  version: number;
  role: LeafRole;
  label: string;
  description: string;
  starter: Record<string, unknown>;
  parameterSchema: Record<string, unknown>;
  /**
   * A superseded version. Its existing fingerprints stay readable, but no new fingerprint or
   * model request may use it; `upgradeFamilyVersions` moves its leaves to the current version.
   */
  deprecated?: true;
};

export { PHASE_EVENT_KINDS } from "./core-families.js";
export type * from "./stamp-types.js";

/** Versioned, human-reviewed semantic families available to local tooling. */
export const REVIEWED_FAMILY_REGISTRY: readonly SemanticFamilyDefinition[] = [
  ...CORE_FAMILIES,
  ...BUFF_FAMILIES,
  ...TARGETING_FAMILIES,
  ...EFFECT_FAMILIES,
  ...RESTRICTION_FAMILIES,
  ...DICE_FAMILIES,
  ...MOVEMENT_FAMILIES,
  ...ECONOMY_FAMILIES,
  ...UNIT_STATE_EFFECT_FAMILIES,
  ...WEAPON_BUFF_FAMILIES,
  ...ABILITY_MODIFIER_FAMILIES,
  ...CONTAINER_FAMILIES,
  ...NAMED_REGION_FAMILIES,
  ...PREDICATE_FAMILIES,
  ...PREDICATE_FAMILIES_2,
  ...PREDICATE_SUBJECT_FAMILIES,
] as const;

/** The version new fingerprints and model requests use for a family. */
export function currentFamilyVersion(id: string): number {
  const current = REVIEWED_FAMILY_REGISTRY.filter((family) => family.id === id && !family.deprecated);
  if (current.length !== 1) throw new RangeError(`Reviewed family ${id} has ${current.length} current versions.`);
  return current[0]!.version;
}

const familiesByKey: Record<string, SemanticFamilyDefinition> = Object.fromEntries(
  REVIEWED_FAMILY_REGISTRY.map((family) => [`${family.id}@${family.version}`, family]),
);

function requiredObject(parameters: FamilyParameters): Record<string, unknown> {
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new TypeError("Fingerprint parameters must be a JSON object.");
  }
  return parameters;
}

/** Return one reviewed family definition or fail rather than inventing a family. */
export function reviewedFamily(id: string, version = 1): SemanticFamilyDefinition {
  const family = familiesByKey[`${id}@${version}`];
  if (!family) throw new RangeError(`Unknown reviewed semantic family ${id}@${version}.`);
  return family;
}

/** Resolve a family's semantic role from the reviewed registry. */
export function familyRole(id: string, version = 1): LeafRole {
  return reviewedFamily(id, version).role;
}

/** Validate and canonicalise parameters for a reviewed semantic family. */
export function normalizeFingerprintParameters(
  family: string,
  parameters: FamilyParameters,
  version = 1,
): Record<string, unknown> {
  reviewedFamily(family, version);
  const input = requiredObject(parameters);

  const normalized = normalizeCoreParameters(family, input, version)
    ?? normalizeBuffParameters(family, input, version)
    ?? normalizeTargetingParameters(family, input, version)
    ?? normalizeEffectParameters(family, input, version)
    ?? normalizeRestrictionParameters(family, input, version)
    ?? normalizeDiceParameters(family, input, version)
    ?? normalizeMovementParameters(family, input)
    ?? normalizeEconomyParameters(family, input)
    ?? normalizeUnitStateParameters(family, input)
    ?? normalizeWeaponBuffParameters(family, input, version)
    ?? normalizeAbilityModifierParameters(family, input, version)
    ?? normalizeContainerParameters(family, input)
    ?? normalizeNamedRegionParameters(family, input)
    ?? normalizePredicateParameters(family, input)
    ?? normalizePredicateParameters2(family, input)
    ?? normalizePredicateSubjectParameters(family, input, version);
  if (normalized) return normalized;
  throw new RangeError(`Unknown reviewed semantic family ${family}@${version}.`);
}

/** Decode an exact UTF-8 byte span and reject boundaries that split a code point. */
export function exactSpan(source: string, start: number, end: number): string {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    throw new RangeError("Source span offsets must be ordered, non-negative UTF-8 byte integers.");
  }
  const bytes = Buffer.from(source, "utf8");
  if (end > bytes.length) throw new RangeError(`Source span ends at ${end}, beyond ${bytes.length} UTF-8 bytes.`);
  const selected = bytes.subarray(start, end);
  const text = selected.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(selected)) {
    throw new RangeError("Source span offsets split a UTF-8 code point.");
  }
  return text;
}

/** Seed every registry version once and reject drift in a reviewed definition. */
export function seedReviewedFamilies(db: DatabaseSync): void {
  const select = db.prepare(
    "SELECT role, parameter_schema_json, status FROM semantic_families WHERE id = ? AND version = ?",
  );
  const insert = db.prepare(
    "INSERT INTO semantic_families (id, version, role, parameter_schema_json, status) VALUES (?, ?, ?, ?, ?)",
  );
  const deprecate = db.prepare("UPDATE semantic_families SET status = 'deprecated' WHERE id = ? AND version = ? AND status = 'active'");

  {
    for (const family of REVIEWED_FAMILY_REGISTRY) {
      const schemaJson = JSON.stringify(family.parameterSchema);
      const status = family.deprecated ? "deprecated" : "active";
      const existing = select.get(family.id, family.version) as
        | { role: string; parameter_schema_json: string; status: string }
        | undefined;
      if (!existing) {
        insert.run(family.id, family.version, family.role, schemaJson, status);
        continue;
      }
      if (
        existing.role !== family.role ||
        hashJson(JSON.parse(existing.parameter_schema_json)) !== hashJson(family.parameterSchema)
      ) {
        throw new Error(`Reviewed registry drift for ${family.id}@${family.version}.`);
      }
      // Deprecation is one-way: a version the registry retires stops accepting new leaves.
      if (existing.status !== status) {
        if (existing.status === "deprecated") throw new Error(`Reviewed family ${family.id}@${family.version} was deprecated and cannot return.`);
        deprecate.run(family.id, family.version);
      }
    }
  }
}

/** Require the granted ability name in the exact source-backed effect span. */
export function validateFamilySource(family: string, parameters: Record<string, unknown>, exactText: string): void {
  if (family === "weapon-ability-grant" && !exactText.toLowerCase().includes(String(parameters.keyword).toLowerCase())) {
    throw new TypeError("The granted weapon ability must occur in the exact source span.");
  }
}

/**
 * Insert or return the canonical fingerprint for one reviewed family version.
 *
 * Legacy IDs remain separate historical evidence; callers map them through
 * `legacy_fingerprint_id` instead of reproducing their old hash recipe.
 */
export function validateFingerprint(
  db: DatabaseSync,
  family: string,
  parameters: Record<string, unknown>,
  version = 1,
  exactText?: string,
): string {
  const definition = reviewedFamily(family, version);
  const normalized = normalizeFingerprintParameters(family, parameters, version);
  if (exactText !== undefined && (!exactText || exactText !== exactText.trim())) {
    throw new TypeError("Fingerprint exact text must be nonblank and preserve its source boundaries.");
  }
  if (exactText !== undefined) {
    for (const value of Object.values(normalized)) {
      const source = sourceQualified(value, "Fingerprint parameter");
      if (source && !exactText.includes(source.source)) {
        throw new TypeError("A source-qualified fingerprint value must occur in the exact source span.");
      }
    }
  }
  if (exactText !== undefined) validateFamilySource(family, normalized, exactText);

  const familyRow = db.prepare(
    "SELECT role, parameter_schema_json, status FROM semantic_families WHERE id = ? AND version = ?",
  );
  const stored = familyRow.get(family, version) as
    | { role: string; parameter_schema_json: string; status: string }
    | undefined;
  if (!stored || stored.status !== "active" || stored.role !== definition.role) {
    throw new Error(`Reviewed family ${family}@${version} is not active in this workbench.`);
  }
  if (hashJson(JSON.parse(stored.parameter_schema_json)) !== hashJson(definition.parameterSchema)) {
    throw new Error(`Reviewed family ${family}@${version} does not match the local registry.`);
  }

  const canonicalHash = hashJson({ family, version, parameters: normalized });
  const id = `fp_${canonicalHash}`;
  const parametersJson = JSON.stringify(normalized);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO fingerprints (id, family_id, family_version, parameters_json, canonical_hash, legacy_fingerprint_id, status) VALUES (?, ?, ?, ?, ?, NULL, 'active')",
  );
  const select = db.prepare("SELECT id, family_id, family_version, parameters_json FROM fingerprints WHERE canonical_hash = ?");
  {
    insert.run(id, family, version, parametersJson, canonicalHash);
    const fingerprint = select.get(canonicalHash) as
      | { id: string; family_id: string; family_version: number; parameters_json: string }
      | undefined;
    if (!fingerprint || fingerprint.id !== id || fingerprint.family_id !== family || fingerprint.family_version !== version) {
      throw new Error(`Fingerprint canonical-hash conflict for ${family}@${version}.`);
    }
    if (hashJson(JSON.parse(fingerprint.parameters_json)) !== hashJson(normalized)) {
      throw new Error(`Fingerprint parameter conflict for ${family}@${version}.`);
    }
    return fingerprint.id;
  }
}
