/**
 * Bridge army-assist's two datasheet id-spaces. The wargear-option table
 * (`Datasheets_options.json`) and the unit-composition table
 * (`Datasheets_unit_composition.json`) key on a *numeric* datasheet id
 * (`000002627`) that never appears in the UUID-keyed `Datasheets.json` /
 * `Datasheets_models.json`. The link is **model names**: composition
 * descriptions name a datasheet's models (numeric side), and `Datasheets_models`
 * names them (UUID side).
 *
 * Globally the match is ambiguous (the same model name recurs across factions),
 * but the converter runs one faction at a time, so candidates are restricted to
 * that faction's ~50–90 datasheets where model-name sets are effectively unique.
 * Ties that survive are returned for the caller to report rather than guessed.
 */

/** Normalise a model name for matching: lowercase, keep alphanumerics + spaces. */
export function normModelName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Extract a model name from a unit-composition description by dropping the
 * leading count or range ("1 Khorne Berzerker Champion" → "khorne berzerker
 * champion"; "9-19 Khorne Berzerkers" → "khorne berzerkers").
 */
export function modelNameFromComposition(desc: string): string {
  return normModelName(desc.replace(/^\s*\d+\s*[-–]?\s*\d*\s+/, ""));
}

export interface BridgeResult {
  /** numeric datasheet id → UUID datasheet id (unique best model-name match). */
  byNumeric: Map<string, string>;
  /** numeric ids that overlap the faction but tie across ≥2 UUIDs. */
  ambiguous: string[];
}

/**
 * Resolve each numeric datasheet id that carries options to a faction UUID by
 * best model-name-set overlap. Numeric ids with no overlap are treated as
 * belonging to another faction and dropped silently; ties (overlap > 0 but no
 * unique winner) are returned in `ambiguous`.
 */
export function bridgeOptionsToUnits(
  factionUuids: readonly string[],
  modelsByUuid: Map<string, Set<string>>,
  compByNumeric: Map<string, Set<string>>,
  optionNumericIds: Iterable<string>,
): BridgeResult {
  const byNumeric = new Map<string, string>();
  const ambiguous: string[] = [];

  for (const numericId of optionNumericIds) {
    const numModels = compByNumeric.get(numericId);
    if (!numModels || numModels.size === 0) continue;

    let bestScore = 0;
    let winners: string[] = [];
    for (const uuid of factionUuids) {
      const uModels = modelsByUuid.get(uuid);
      if (!uModels) continue;
      let score = 0;
      for (const m of numModels) if (uModels.has(m)) score++;
      if (score > bestScore) {
        bestScore = score;
        winners = [uuid];
      } else if (score === bestScore && score > 0) {
        winners.push(uuid);
      }
    }

    if (bestScore === 0) continue; // another faction's datasheet
    if (winners.length === 1) byNumeric.set(numericId, winners[0]);
    else ambiguous.push(numericId);
  }

  return { byNumeric, ambiguous };
}
