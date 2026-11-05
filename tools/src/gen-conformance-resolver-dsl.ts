/**
 * The abilities-resolver DSL corpora (`from-dsl.json`, `defensive-from-dsl.json`). Two generators
 * share each file and own disjoint rows: `refreshResolverDslCases` re-derives the seeded rows, and
 * `withCanonicalDslCases` replaces the fabricated canonical rows. Neither touches the other's rows,
 * so the result does not depend on which runs first.
 */

import type { Dataset } from "./data/dataset.js";
import { withRating } from "./data/ability-refs.js";
import { effectToBuffs } from "./cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "./cruncher/buffs.js";
import type { GrantedRecord } from "./cruncher/granted-records.js";
import {
  canonicalDesignationCases,
  canonicalMoveTypeCases,
  canonicalHalfWeaponRangeCases,
  canonicalNamedRegionBeneficiaryCases,
  canonicalRecipientCases,
  canonicalScenarioCases,
  canonicalStratagemModelCases,
  canonicalStratagemTargetCases,
  canonicalTriggerSubjectCases,
  DESIGNATION_CASE_PREFIX,
  MOVE_TYPE_CASE_PREFIX,
  HALF_WEAPON_RANGE_CASE_PREFIX,
  NAMED_REGION_BENEFICIARY_CASE_PREFIX,
  dslProjection,
  RECIPIENT_CASE_PREFIX,
  SCENARIO_CASE_PREFIX,
  STRATAGEM_MODEL_CASE_PREFIX,
  STRATAGEM_TARGET_CASE_PREFIX,
  TRIGGER_SUBJECT_CASE_PREFIX,
} from "./gen-conformance-cruncher-cases.js";
import { canonicalDamageZeroingCases, DAMAGE_ZEROING_CASE_PREFIX } from "./gen-conformance-zeroing-cases.js";
import { canonicalIgnoreModifiersCases, IGNORE_MODIFIERS_CASE_PREFIX } from "./gen-conformance-ignore-cases.js";
import { canonicalGrantedRecordCases, GRANTED_RECORD_CASE_PREFIX, withGrantedRecords } from "./gen-conformance-granted-cases.js";

export type ResolverDslCase = {
  caseId?: string;
  abilityId: string;
  rating?: string | number;
  effect?: unknown;
  /** Ability records the effect grants, resolved as printed definitions before translation. */
  grantedRecords?: Record<string, GrantedRecord>;
  source: BuffSource;
  context: EngineContext;
  perspective?: "attacker" | "target";
  expected?: {
    applied: unknown[];
    unsupportedReasons: string[];
    /** Each unsupported fragment's scope, parallel to `unsupportedReasons`. */
    unsupportedScopes?: string[];
    needKeys?: string[];
    activatable?: unknown[];
  };
};

/**
 * The caseId prefixes of the rows `withCanonicalDslCases` owns. A `canonical/` row outside these
 * (e.g. `canonical/save-characteristic/`) is a seeded row and is refreshed like any other.
 */
export const CANONICAL_DSL_CASE_PREFIXES: readonly string[] = [
  RECIPIENT_CASE_PREFIX, HALF_WEAPON_RANGE_CASE_PREFIX, SCENARIO_CASE_PREFIX, GRANTED_RECORD_CASE_PREFIX,
  DAMAGE_ZEROING_CASE_PREFIX, IGNORE_MODIFIERS_CASE_PREFIX, TRIGGER_SUBJECT_CASE_PREFIX, STRATAGEM_MODEL_CASE_PREFIX,
  STRATAGEM_TARGET_CASE_PREFIX, NAMED_REGION_BENEFICIARY_CASE_PREFIX, DESIGNATION_CASE_PREFIX, MOVE_TYPE_CASE_PREFIX,
];

/** Whether a corpus row is one the canonical generator writes (and the seeded refresh leaves alone). */
export function isCanonicalDslCase(row: { caseId?: unknown }): boolean {
  const id = row.caseId;
  return typeof id === "string" && CANONICAL_DSL_CASE_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** Every fabricated canonical row, both perspectives, with its expectation. */
export function canonicalDslCases(): Array<Record<string, unknown> & { perspective: "attacker" | "target" }> {
  return [
    ...canonicalRecipientCases(), ...canonicalHalfWeaponRangeCases(), ...canonicalScenarioCases(),
    ...canonicalGrantedRecordCases(), ...canonicalDamageZeroingCases(), ...canonicalIgnoreModifiersCases(),
    ...canonicalTriggerSubjectCases(), ...canonicalStratagemModelCases(), ...canonicalStratagemTargetCases(),
    ...canonicalNamedRegionBeneficiaryCases(), ...canonicalDesignationCases(), ...canonicalMoveTypeCases(),
  ];
}

/**
 * The seeded rows with their expectations re-derived through the same public translation boundary
 * adapters use. Canonical rows pass through unchanged: their builders project their own expectation
 * (the scenario rows also pin `applicableWhen`), and re-projecting them here would rewrite another
 * generator's goldens.
 */
export function refreshResolverDslCases<T extends ResolverDslCase>(cases: readonly T[], ds: Dataset): T[] {
  return cases.map((row) => {
    if (isCanonicalDslCase(row)) return row;
    const perspective = row.perspective ?? "attacker";
    const result = row.effect === undefined
      ? ds.abilities.getAny(row.abilityId)?.describeBuffs(row.source, row.context, perspective, row.rating)
      : effectToBuffs(withRating(withGrantedRecords(row), row.rating), row.source, row.context, perspective);
    if (!result) throw new Error(`resolver conformance references unknown ability ${row.abilityId}`);
    return { ...row, expected: dslProjection(result) };
  });
}

/** The corpus with its canonical rows replaced by `canonical`'s rows for this file's perspective, appended after the seeded rows. */
export function withCanonicalDslCases<T extends { caseId?: unknown }>(
  cases: readonly T[],
  perspective: "attacker" | "target",
  canonical: ReadonlyArray<Record<string, unknown> & { perspective: string }>,
): Array<T | Record<string, unknown>> {
  return [...cases.filter((row) => !isCanonicalDslCase(row)), ...canonical.filter((row) => row.perspective === perspective)];
}
