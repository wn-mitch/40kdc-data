import { type FamilyExtension, optional, withProperties } from "../family-extension-helpers.js";
import { foldName } from "../compile-weapon-names.js";

/** Datasheet identities are not keywords, and never identify individual model profiles. */
export const UNIT_NAME_EXTENSIONS: readonly FamilyExtension[] = [
  { family: "unit-filter", version: 17 },
  { family: "triggering-target", version: 4 },
].map<FamilyExtension>(({ family, version }) => ({
  family,
  version,
  description: "As the previous version, plus unit_names: exact named unit datasheets, resolved within the owning faction to stable unit IDs. These are unit-level identities, not keywords or model names.",
  schema: (previous) => withProperties(previous, {
    unit_names: optional({ type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } }),
  }),
  normalize: (input, previous) => {
    if (input.unit_names === undefined) return previous(input);
    const { unit_names: names, ...rest } = input;
    if (rest.level === "model" || (rest.selects !== undefined && rest.selects !== "unit")) {
      throw new TypeError(`${family}.unit_names identifies units, not models.`);
    }
    if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || !name.trim())) {
      throw new TypeError(`${family}.unit_names must list exact nonblank datasheet names.`);
    }
    const normalized = (names as string[]).map((name) => name.replaceAll("*", "").replace(/\s+/gu, " ").trim());
    if (new Set(normalized.map(foldName)).size !== normalized.length) throw new TypeError(`${family}.unit_names repeats a datasheet name.`);
    return { ...previous(rest), unit_names: normalized.sort() };
  },
}));
