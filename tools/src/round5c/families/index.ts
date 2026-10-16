import type { SemanticFamilyDefinition } from "../contracts.js";
import type { FamilyExtension } from "../family-extension-helpers.js";
import { ABILITY_EXTENSIONS } from "./abilities.js";
import { ARMY_EXTENSIONS } from "./army.js";
import { ATTACK_EXTENSIONS } from "./attacks.js";
import { CHARACTERISTIC_EXTENSIONS } from "./characteristics.js";
import { CHOICE_AND_DICE_EXTENSIONS } from "./choices-and-dice.js";
import { DURATION_AND_DESIGNATION_EXTENSIONS } from "./durations-and-designations.js";
import { ELIGIBILITY_EXTENSIONS } from "./eligibility.js";
import { EVENT_EXTENSIONS } from "./events.js";
import { LEAF_STRUCTURE_EXTENSIONS } from "./leaf-structure.js";
import { MOVE_EXTENSIONS } from "./moves.js";
import { POSITION_EXTENSIONS } from "./positions.js";
import { REGION_EXTENSIONS } from "./regions.js";
import { REGISTRY_ORDER } from "./registry-order.js";
import { ROLL_EXTENSIONS } from "./rolls.js";
import { SELECTION_EXTENSIONS } from "./selections.js";
import { SET_UP_EXTENSIONS } from "./set-up.js";
import { UNIT_ACTIVITY_EXTENSIONS } from "./unit-activity.js";
import { UNIT_FILTER_EXTENSIONS } from "./unit-filters.js";
import { UNIT_NAME_EXTENSIONS } from "./unit-names.js";
import { UNIT_STATE_EXTENSIONS } from "./unit-states.js";
import { WEAPON_EXTENSIONS } from "./weapons.js";

/**
 * Families that gained versions after the antecedent versions, each widening what the previous
 * version could say without changing anything it already said. A version checks only its own
 * additions and hands the rest of a leaf to the previous version, so every earlier leaf still fits
 * it unchanged and `family-versions.ts` moves leaves across by identity. Each subject file holds
 * whole version chains, and each extension names the version it creates.
 */

export type { FamilyExtension } from "../family-extension-helpers.js";

/** Every extension, by subject. A family's extensions apply in ascending `version`, wherever they are listed. */
export const FAMILY_EXTENSIONS: readonly FamilyExtension[] = [
  ...POSITION_EXTENSIONS,
  ...REGION_EXTENSIONS,
  ...EVENT_EXTENSIONS,
  ...UNIT_ACTIVITY_EXTENSIONS,
  ...UNIT_FILTER_EXTENSIONS,
  ...UNIT_NAME_EXTENSIONS,
  ...UNIT_STATE_EXTENSIONS,
  ...CHARACTERISTIC_EXTENSIONS,
  ...ROLL_EXTENSIONS,
  ...CHOICE_AND_DICE_EXTENSIONS,
  ...WEAPON_EXTENSIONS,
  ...ATTACK_EXTENSIONS,
  ...MOVE_EXTENSIONS,
  ...SET_UP_EXTENSIONS,
  ...ELIGIBILITY_EXTENSIONS,
  ...SELECTION_EXTENSIONS,
  ...ARMY_EXTENSIONS,
  ...ABILITY_EXTENSIONS,
  ...DURATION_AND_DESIGNATION_EXTENSIONS,
  ...LEAF_STRUCTURE_EXTENSIONS,
];

const extensionVersions = new Map<string, FamilyExtension>();

/**
 * The registry with each family's extensions applied in ascending version; each one retires the
 * version before it. A family's versions must run from its current version + 1 without a gap, and
 * no two extensions may create the same version. The new versions follow the registry in
 * `REGISTRY_ORDER`, which must list exactly the versions the extensions create.
 */
export function withFamilyExtensions(registry: readonly SemanticFamilyDefinition[]): SemanticFamilyDefinition[] {
  const chains = new Map<string, FamilyExtension[]>();
  for (const extension of FAMILY_EXTENSIONS) {
    const chain = chains.get(extension.family) ?? [];
    if (chain.some((other) => other.version === extension.version)) throw new Error(`Two extensions create ${extension.family}@${extension.version}.`);
    chains.set(extension.family, [...chain, extension]);
  }
  const result = [...registry];
  const created = new Map<string, { definition: SemanticFamilyDefinition; extension: FamilyExtension }>();
  for (const [family, chain] of chains) {
    const at = result.flatMap((definition, index) => definition.id === family && !definition.deprecated ? [index] : []);
    if (at.length !== 1) throw new Error(`Family ${family} has ${at.length} current versions; an extension needs exactly one.`);
    let current = result[at[0]!]!;
    let retire = (definition: SemanticFamilyDefinition) => { result[at[0]!] = definition; };
    for (const extension of [...chain].sort((left, right) => left.version - right.version)) {
      if (extension.version !== current.version + 1) {
        throw new Error(`Family ${family}'s extensions skip from version ${current.version} to ${extension.version}; versions run from the current version + 1 without a gap.`);
      }
      const { deprecated: _deprecated, ...rest } = current;
      retire({ ...current, deprecated: true });
      const next: SemanticFamilyDefinition = { ...rest, version: extension.version, description: extension.description, parameterSchema: extension.schema(current.parameterSchema) };
      const key = `${family}@${extension.version}`;
      created.set(key, { definition: next, extension });
      retire = (definition) => { created.set(key, { definition, extension }); };
      current = next;
    }
  }
  const unlisted = [...created.keys()].filter((key) => !REGISTRY_ORDER.includes(key));
  const unknown = REGISTRY_ORDER.filter((key) => !created.has(key));
  if (unlisted.length || unknown.length || new Set(REGISTRY_ORDER).size !== REGISTRY_ORDER.length) {
    throw new Error(`REGISTRY_ORDER must list each extension version once (not listed: ${unlisted.join(", ") || "none"}; no such extension: ${unknown.join(", ") || "none"}).`);
  }
  for (const key of REGISTRY_ORDER) {
    const { definition, extension } = created.get(key)!;
    result.push(definition);
    extensionVersions.set(key, extension);
  }
  return result;
}

/** The extension that defines one family version, if any. */
export function familyExtension(family: string, version: number): FamilyExtension | undefined {
  return extensionVersions.get(`${family}@${version}`);
}

/** Each extension's previous → new version, for the identity migration. */
export function extensionVersionPairs(): Array<{ family: string; from: number; to: number }> {
  return [...extensionVersions.values()].map(({ family, version }) => ({ family, from: version - 1, to: version }));
}
