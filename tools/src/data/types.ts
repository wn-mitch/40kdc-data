/**
 * The shape of the embedded data bundle: one named array per entity collection.
 *
 * `RawData` is the boundary between the generated JSON-Schema types and the
 * linked view layer. The codegen ({@link file://../codegen-data.ts}) emits a
 * `RAW_DATA: RawData` constant; {@link Dataset} wraps it with linked accessors.
 *
 * @packageDocumentation
 */
import type {
  AbilityDSLEntry,
  DeploymentPattern,
  Detachment,
  Enhancement,
  Faction,
  ForceDisposition,
  GameVersion,
  InteractionFlag,
  LeaderAttachment,
  Mission,
  MissionMatchup,
  PhaseMapping,
  ResourcePool,
  SecondaryCard,
  Stratagem,
  TerrainLayout,
  TerrainTemplate,
  TimingFlag,
  Unit,
  UnitComposition,
  Wargear,
  WargearOption,
  Weapon,
  WeaponKeyword,
} from "../generated.js";

/**
 * Every entity collection in the dataset, keyed by camelCase collection name.
 *
 * Collections with no authored data yet (e.g. `interactionFlags`) are present
 * as empty arrays so the API surface is stable and new data flows through
 * automatically once authored.
 */
export interface RawData {
  units: Unit[];
  weapons: Weapon[];
  /** Catalog of weapon keywords (Lethal Hits, Sustained Hits N, Anti-X N+, ...). */
  weaponKeywords: WeaponKeyword[];
  factions: Faction[];
  /** Community-authored ability mechanics (key is `ability_id`, not `id`). */
  abilities: AbilityDSLEntry[];
  /** Phase assignments, joined to abilities/stratagems/etc. via `source_id`. */
  phaseMappings: PhaseMapping[];
  detachments: Detachment[];
  stratagems: Stratagem[];
  enhancements: Enhancement[];
  leaderAttachments: LeaderAttachment[];
  unitCompositions: UnitComposition[];
  wargearOptions: WargearOption[];
  /** Non-weapon wargear items (icons, attachments) referenced by wargear options. */
  wargear: Wargear[];
  gameVersions: GameVersion[];
  missions: Mission[];
  missionMatchups: MissionMatchup[];
  missionCards: SecondaryCard[];
  deploymentPatterns: DeploymentPattern[];
  forceDispositions: ForceDisposition[];
  /** Reusable terrain catalog: standard areas and scenery features. */
  terrainTemplates: TerrainTemplate[];
  /** Terrain layouts: arrangements of catalog/inline pieces on the board. */
  terrainLayouts: TerrainLayout[];
  resourcePools: ResourcePool[];
  timingFlags: TimingFlag[];
  interactionFlags: InteractionFlag[];
}

/** A `RawData` with every collection initialised to an empty array. */
export function emptyRawData(): RawData {
  return {
    units: [],
    weapons: [],
    weaponKeywords: [],
    factions: [],
    abilities: [],
    phaseMappings: [],
    detachments: [],
    stratagems: [],
    enhancements: [],
    leaderAttachments: [],
    unitCompositions: [],
    wargearOptions: [],
    wargear: [],
    gameVersions: [],
    missions: [],
    missionMatchups: [],
    missionCards: [],
    deploymentPatterns: [],
    forceDispositions: [],
    terrainTemplates: [],
    terrainLayouts: [],
    resourcePools: [],
    timingFlags: [],
    interactionFlags: [],
  };
}
