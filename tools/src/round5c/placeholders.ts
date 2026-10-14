/**
 * The hit-train import (migration.ts) recorded some leaves with the placeholder `"source"` where
 * a value belonged ("the threshold the source states"). Such a leaf names its family but not its
 * meaning: lowering refuses it, so it must not count as resolved source, and no new decision may
 * create one. Values given as the source's own words (`{ source: "…" }`) are not placeholders.
 */

export const PLACEHOLDER = "source";

/** Top-level parameters still holding the placeholder. */
export function unresolvedParameters(parameters: Record<string, unknown>): string[] {
  return Object.entries(parameters).filter(([, value]) => value === PLACEHOLDER).map(([key]) => key);
}

/** Refuse a decision whose parameters still hold the placeholder. */
export function assertResolved(parameters: Record<string, unknown>): void {
  const unresolved = unresolvedParameters(parameters);
  if (unresolved.length > 0) {
    throw new Error(`${unresolved.join(", ")} still ${unresolved.length === 1 ? "holds" : "hold"} the placeholder "${PLACEHOLDER}"; give the value the source states.`);
  }
}

/** SQL: the joined `fingerprints` row has no top-level parameter holding the placeholder. */
export const RESOLVED_FINGERPRINT = `NOT EXISTS (
  SELECT 1 FROM json_each(fingerprints.parameters_json) AS parameter
  WHERE parameter.type = 'text' AND parameter.value = '${PLACEHOLDER}'
)`;
