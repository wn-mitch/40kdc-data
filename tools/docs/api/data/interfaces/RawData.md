[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / RawData

# Interface: RawData

Defined in: [data/types.ts:47](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L47)

Every entity collection in the dataset, keyed by camelCase collection name.

Collections with no authored data yet (e.g. `interactionFlags`) are present
as empty arrays so the API surface is stable and new data flows through
automatically once authored.

## Properties

### units

> **units**: [`Unit`](../../generated/interfaces/Unit.md)[]

Defined in: [data/types.ts:48](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L48)

***

### targetProfiles

> **targetProfiles**: [`TargetProfile`](../../generated/interfaces/TargetProfile.md)[]

Defined in: [data/types.ts:50](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L50)

Named target archetypes referencing real units (faction_id + unit_id).

***

### weapons

> **weapons**: [`Weapon`](../../generated/interfaces/Weapon.md)[]

Defined in: [data/types.ts:51](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L51)

***

### weaponKeywords

> **weaponKeywords**: [`WeaponKeyword`](../../generated/interfaces/WeaponKeyword.md)[]

Defined in: [data/types.ts:53](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L53)

Catalog of weapon keywords (Lethal Hits, Sustained Hits N, Anti-X N+, ...).

***

### unitKeywords

> **unitKeywords**: [`UnitKeyword`](../../generated/interfaces/UnitKeyword.md)[]

Defined in: [data/types.ts:55](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L55)

Catalog of universal unit abilities (Deep Strike, Scouts X", Feel No Pain X+, ...).

***

### factions

> **factions**: [`Faction`](../../generated/interfaces/Faction.md)[]

Defined in: [data/types.ts:56](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L56)

***

### abilities

> **abilities**: [`AbilityDSLEntry`](../../generated/interfaces/AbilityDSLEntry.md)[]

Defined in: [data/types.ts:58](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L58)

Community-authored ability mechanics (key is `ability_id`, not `id`).

***

### phaseMappings

> **phaseMappings**: [`PhaseMapping`](../../generated/interfaces/PhaseMapping.md)[]

Defined in: [data/types.ts:60](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L60)

Phase assignments, joined to abilities/stratagems/etc. via `source_id`.

***

### detachments

> **detachments**: [`Detachment`](../../generated/interfaces/Detachment.md)[]

Defined in: [data/types.ts:61](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L61)

***

### alliedRules

> **alliedRules**: [`AlliedRule`](../../generated/interfaces/AlliedRule.md)[]

Defined in: [data/types.ts:63](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L63)

Allied-detachment / 'soup' rules: how units lacking the army faction keyword may be included.

***

### stratagems

> **stratagems**: [`Stratagem`](../../generated/interfaces/Stratagem.md)[]

Defined in: [data/types.ts:64](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L64)

***

### enhancements

> **enhancements**: [`Enhancement`](../../generated/interfaces/Enhancement.md)[]

Defined in: [data/types.ts:65](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L65)

***

### leaderAttachments

> **leaderAttachments**: [`LeaderAttachment`](../../generated/interfaces/LeaderAttachment.md)[]

Defined in: [data/types.ts:66](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L66)

***

### unitCompositions

> **unitCompositions**: [`UnitComposition`](../../generated/interfaces/UnitComposition.md)[]

Defined in: [data/types.ts:67](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L67)

***

### wargearOptions

> **wargearOptions**: [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

Defined in: [data/types.ts:68](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L68)

***

### wargear

> **wargear**: [`Wargear`](../../generated/interfaces/Wargear.md)[]

Defined in: [data/types.ts:70](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L70)

Non-weapon wargear items (icons, attachments) referenced by wargear options.

***

### gameVersions

> **gameVersions**: [`GameVersion`](../../generated/interfaces/GameVersion.md)[]

Defined in: [data/types.ts:71](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L71)

***

### missions

> **missions**: [`Mission`](../../generated/interfaces/Mission.md)[]

Defined in: [data/types.ts:72](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L72)

***

### missionMatchups

> **missionMatchups**: [`MissionMatchup`](../../generated/interfaces/MissionMatchup.md)[]

Defined in: [data/types.ts:73](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L73)

***

### missionCards

> **missionCards**: [`SecondaryCard`](../../generated/interfaces/SecondaryCard.md)[]

Defined in: [data/types.ts:74](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L74)

***

### deploymentPatterns

> **deploymentPatterns**: [`DeploymentPattern`](../../generated/interfaces/DeploymentPattern.md)[]

Defined in: [data/types.ts:75](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L75)

***

### forceDispositions

> **forceDispositions**: [`ForceDisposition`](../../generated/interfaces/ForceDisposition.md)[]

Defined in: [data/types.ts:76](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L76)

***

### terrainTemplates

> **terrainTemplates**: [`TerrainTemplate`](../../generated/interfaces/TerrainTemplate.md)[]

Defined in: [data/types.ts:78](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L78)

Reusable terrain catalog: standard areas and scenery features.

***

### terrainLayouts

> **terrainLayouts**: [`TerrainLayout`](../../generated/interfaces/TerrainLayout.md)[]

Defined in: [data/types.ts:80](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L80)

Terrain layouts: arrangements of catalog/inline pieces on the board.

***

### hullShapes

> **hullShapes**: [`HullShape`](../../generated/interfaces/HullShape.md)[]

Defined in: [data/types.ts:82](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L82)

Reusable model collision hulls (polygon footprints) referenced by id.

***

### resourcePools

> **resourcePools**: [`ResourcePool`](../../generated/interfaces/ResourcePool.md)[]

Defined in: [data/types.ts:83](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L83)

***

### interactionFlags

> **interactionFlags**: [`InteractionFlag`](../../generated/interfaces/InteractionFlag.md)[]

Defined in: [data/types.ts:84](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/types.ts#L84)
