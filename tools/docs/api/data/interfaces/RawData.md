[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / RawData

# Interface: RawData

Defined in: [data/types.ts:44](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L44)

Every entity collection in the dataset, keyed by camelCase collection name.

Collections with no authored data yet (e.g. `interactionFlags`) are present
as empty arrays so the API surface is stable and new data flows through
automatically once authored.

## Properties

### units

> **units**: [`Unit`](../../generated/interfaces/Unit.md)[]

Defined in: [data/types.ts:45](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L45)

***

### weapons

> **weapons**: [`Weapon`](../../generated/interfaces/Weapon.md)[]

Defined in: [data/types.ts:46](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L46)

***

### weaponKeywords

> **weaponKeywords**: [`WeaponKeyword`](../../generated/interfaces/WeaponKeyword.md)[]

Defined in: [data/types.ts:48](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L48)

Catalog of weapon keywords (Lethal Hits, Sustained Hits N, Anti-X N+, ...).

***

### factions

> **factions**: [`Faction`](../../generated/interfaces/Faction.md)[]

Defined in: [data/types.ts:49](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L49)

***

### abilities

> **abilities**: [`AbilityDSLEntry`](../../generated/interfaces/AbilityDSLEntry.md)[]

Defined in: [data/types.ts:51](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L51)

Community-authored ability mechanics (key is `ability_id`, not `id`).

***

### phaseMappings

> **phaseMappings**: [`PhaseMapping`](../../generated/interfaces/PhaseMapping.md)[]

Defined in: [data/types.ts:53](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L53)

Phase assignments, joined to abilities/stratagems/etc. via `source_id`.

***

### detachments

> **detachments**: [`Detachment`](../../generated/interfaces/Detachment.md)[]

Defined in: [data/types.ts:54](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L54)

***

### stratagems

> **stratagems**: [`Stratagem`](../../generated/interfaces/Stratagem.md)[]

Defined in: [data/types.ts:55](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L55)

***

### enhancements

> **enhancements**: [`Enhancement`](../../generated/interfaces/Enhancement.md)[]

Defined in: [data/types.ts:56](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L56)

***

### leaderAttachments

> **leaderAttachments**: [`LeaderAttachment`](../../generated/interfaces/LeaderAttachment.md)[]

Defined in: [data/types.ts:57](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L57)

***

### unitCompositions

> **unitCompositions**: [`UnitComposition`](../../generated/interfaces/UnitComposition.md)[]

Defined in: [data/types.ts:58](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L58)

***

### wargearOptions

> **wargearOptions**: [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

Defined in: [data/types.ts:59](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L59)

***

### wargear

> **wargear**: [`Wargear`](../../generated/interfaces/Wargear.md)[]

Defined in: [data/types.ts:61](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L61)

Non-weapon wargear items (icons, attachments) referenced by wargear options.

***

### gameVersions

> **gameVersions**: [`GameVersion`](../../generated/interfaces/GameVersion.md)[]

Defined in: [data/types.ts:62](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L62)

***

### missions

> **missions**: [`Mission`](../../generated/interfaces/Mission.md)[]

Defined in: [data/types.ts:63](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L63)

***

### missionMatchups

> **missionMatchups**: [`MissionMatchup`](../../generated/interfaces/MissionMatchup.md)[]

Defined in: [data/types.ts:64](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L64)

***

### missionCards

> **missionCards**: [`SecondaryCard`](../../generated/interfaces/SecondaryCard.md)[]

Defined in: [data/types.ts:65](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L65)

***

### deploymentPatterns

> **deploymentPatterns**: [`DeploymentPattern`](../../generated/interfaces/DeploymentPattern.md)[]

Defined in: [data/types.ts:66](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L66)

***

### forceDispositions

> **forceDispositions**: [`ForceDisposition`](../../generated/interfaces/ForceDisposition.md)[]

Defined in: [data/types.ts:67](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L67)

***

### terrainTemplates

> **terrainTemplates**: [`TerrainTemplate`](../../generated/interfaces/TerrainTemplate.md)[]

Defined in: [data/types.ts:69](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L69)

Reusable terrain catalog: standard areas and scenery features.

***

### terrainLayouts

> **terrainLayouts**: [`TerrainLayout`](../../generated/interfaces/TerrainLayout.md)[]

Defined in: [data/types.ts:71](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L71)

Terrain layouts: arrangements of catalog/inline pieces on the board.

***

### resourcePools

> **resourcePools**: [`ResourcePool`](../../generated/interfaces/ResourcePool.md)[]

Defined in: [data/types.ts:72](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L72)

***

### timingFlags

> **timingFlags**: [`TimingFlag`](../../generated/interfaces/TimingFlag.md)[]

Defined in: [data/types.ts:73](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L73)

***

### interactionFlags

> **interactionFlags**: [`InteractionFlag`](../../generated/interfaces/InteractionFlag.md)[]

Defined in: [data/types.ts:74](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/types.ts#L74)
