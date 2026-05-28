/**
 * The linked, typed 40kdc dataset.
 *
 * The default {@link dataset} is built once from the data embedded in this
 * package; the top-level collections below are its accessors, re-exported for
 * the ergonomic one-liner form.
 *
 * @packageDocumentation
 *
 * @example
 * import { units } from "@alpaca-software/40kdc-data";
 *
 * units.find("Kharn")!.abilities
 *   .filter(a => a.phases.includes("shooting"))
 *   .map(a => a.id); // ["berzerker-frenzy"]
 *
 * @example
 * import { factions } from "@alpaca-software/40kdc-data";
 *
 * factions.find("World Eaters")!.units.length;
 */
export { Dataset } from "./dataset.js";
export type { StackableBuff, StackableBuffGroup } from "./dataset.js";
export { Collection } from "./collection.js";
export type { CollectionConfig } from "./collection.js";
export {
  UnitView,
  AbilityView,
  WeaponView,
  WeaponKeywordView,
  FactionView,
} from "./entities.js";
export { normalizeName } from "./normalize.js";
export { emptyRawData } from "./types.js";
export type { RawData } from "./types.js";

// The cruncher surface — buff types + the engine — re-exported from the data
// package so downstream callers can import their whole 40kdc API from
// `@alpaca-software/40kdc-data` without reaching into subpaths.
export * from "../cruncher/index.js";

// The DSL→Buff translator that powers AbilityView.getBuffs / describeBuffs.
export { effectToBuffs, parseKeywordGrant } from "../cruncher/from-dsl.js";
export type {
  ActivatableBuff,
  ActivatableGroupRef,
  EffectTranslation,
  TranslationPerspective,
  UnsupportedFragment,
} from "../cruncher/from-dsl.js";

// The eligible-abilities resolver (also reachable as Dataset.eligibleAbilities).
export * from "../abilities-resolver/index.js";

// Bridge helpers from the importer's RosterUnit → linked views.
export { resolveRosterUnit, resolveRosterWargear } from "./roster-resolve.js";

import { Dataset } from "./dataset.js";

/** The dataset built from this package's embedded data. */
export const dataset = Dataset.embedded();

/** All units, linked to their faction, weapons, and abilities. */
export const units = dataset.units;
/** All weapons, linked to the units that carry them. */
export const weapons = dataset.weapons;
/** Catalog of weapon keywords (Lethal Hits, Sustained Hits N, Anti-X N+, ...). */
export const weaponKeywords = dataset.weaponKeywords;
/** All factions, linked to their units, abilities, and weapons. */
export const factions = dataset.factions;
/** All abilities, linked to their phases and the units that have them. */
export const abilities = dataset.abilities;
/** All detachments. */
export const detachments = dataset.detachments;
/** All enhancements. */
export const enhancements = dataset.enhancements;
/** All stratagems. */
export const stratagems = dataset.stratagems;
/** All wargear options. */
export const wargearOptions = dataset.wargearOptions;
/** All missions. */
export const missions = dataset.missions;
/** All mission matchups. */
export const missionMatchups = dataset.missionMatchups;
/** All secondary mission cards. */
export const secondaryCards = dataset.secondaryCards;
/** All deployment patterns. */
export const deploymentPatterns = dataset.deploymentPatterns;
/** All force dispositions. */
export const forceDispositions = dataset.forceDispositions;
/** All resource pools. */
export const resourcePools = dataset.resourcePools;
