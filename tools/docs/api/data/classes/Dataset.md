[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / Dataset

# Class: Dataset

Defined in: [data/dataset.ts:82](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L82)

The whole dataset, with linked accessors over every entity collection.

## Constructors

### Constructor

> **new Dataset**(`raw?`): `Dataset`

Defined in: [data/dataset.ts:124](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L124)

#### Parameters

##### raw?

[`RawData`](../interfaces/RawData.md) = `...`

#### Returns

`Dataset`

## Properties

### units

> `readonly` **units**: [`Collection`](Collection.md)\<[`Unit`](../../generated/interfaces/Unit.md), [`UnitView`](UnitView.md)\>

Defined in: [data/dataset.ts:84](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L84)

***

### weapons

> `readonly` **weapons**: [`Collection`](Collection.md)\<[`Weapon`](../../generated/interfaces/Weapon.md), [`WeaponView`](WeaponView.md)\>

Defined in: [data/dataset.ts:85](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L85)

***

### weaponKeywords

> `readonly` **weaponKeywords**: [`Collection`](Collection.md)\<[`WeaponKeyword`](../../generated/interfaces/WeaponKeyword.md), [`WeaponKeywordView`](WeaponKeywordView.md)\>

Defined in: [data/dataset.ts:86](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L86)

***

### factions

> `readonly` **factions**: [`Collection`](Collection.md)\<[`Faction`](../../generated/interfaces/Faction.md), [`FactionView`](FactionView.md)\>

Defined in: [data/dataset.ts:87](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L87)

***

### abilities

> `readonly` **abilities**: [`Collection`](Collection.md)\<[`AbilityDSLEntry`](../../generated/interfaces/AbilityDSLEntry.md), [`AbilityView`](AbilityView.md)\>

Defined in: [data/dataset.ts:88](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L88)

***

### detachments

> `readonly` **detachments**: [`Collection`](Collection.md)\<[`Detachment`](../../generated/interfaces/Detachment.md), [`Detachment`](../../generated/interfaces/Detachment.md)\>

Defined in: [data/dataset.ts:91](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L91)

***

### enhancements

> `readonly` **enhancements**: [`Collection`](Collection.md)\<[`Enhancement`](../../generated/interfaces/Enhancement.md), [`Enhancement`](../../generated/interfaces/Enhancement.md)\>

Defined in: [data/dataset.ts:92](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L92)

***

### stratagems

> `readonly` **stratagems**: [`Collection`](Collection.md)\<[`Stratagem`](../../generated/interfaces/Stratagem.md), [`Stratagem`](../../generated/interfaces/Stratagem.md)\>

Defined in: [data/dataset.ts:93](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L93)

***

### wargearOptions

> `readonly` **wargearOptions**: [`Collection`](Collection.md)\<[`WargearOption`](../../generated/interfaces/WargearOption.md), [`WargearOption`](../../generated/interfaces/WargearOption.md)\>

Defined in: [data/dataset.ts:94](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L94)

***

### wargear

> `readonly` **wargear**: [`Collection`](Collection.md)\<[`Wargear`](../../generated/interfaces/Wargear.md), [`Wargear`](../../generated/interfaces/Wargear.md)\>

Defined in: [data/dataset.ts:95](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L95)

***

### missions

> `readonly` **missions**: [`Collection`](Collection.md)\<[`Mission`](../../generated/interfaces/Mission.md), [`Mission`](../../generated/interfaces/Mission.md)\>

Defined in: [data/dataset.ts:96](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L96)

***

### missionMatchups

> `readonly` **missionMatchups**: [`Collection`](Collection.md)\<[`MissionMatchup`](../../generated/interfaces/MissionMatchup.md), [`MissionMatchup`](../../generated/interfaces/MissionMatchup.md)\>

Defined in: [data/dataset.ts:97](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L97)

***

### missionCards

> `readonly` **missionCards**: [`Collection`](Collection.md)\<[`SecondaryCard`](../../generated/interfaces/SecondaryCard.md), [`SecondaryCard`](../../generated/interfaces/SecondaryCard.md)\>

Defined in: [data/dataset.ts:98](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L98)

***

### deploymentPatterns

> `readonly` **deploymentPatterns**: [`Collection`](Collection.md)\<[`DeploymentPattern`](../../generated/interfaces/DeploymentPattern.md), [`DeploymentPattern`](../../generated/interfaces/DeploymentPattern.md)\>

Defined in: [data/dataset.ts:99](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L99)

***

### forceDispositions

> `readonly` **forceDispositions**: [`Collection`](Collection.md)\<[`ForceDisposition`](../../generated/interfaces/ForceDisposition.md), [`ForceDisposition`](../../generated/interfaces/ForceDisposition.md)\>

Defined in: [data/dataset.ts:100](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L100)

***

### terrainTemplates

> `readonly` **terrainTemplates**: [`Collection`](Collection.md)\<[`TerrainTemplate`](../../generated/interfaces/TerrainTemplate.md), [`TerrainTemplate`](../../generated/interfaces/TerrainTemplate.md)\>

Defined in: [data/dataset.ts:101](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L101)

***

### terrainLayouts

> `readonly` **terrainLayouts**: [`Collection`](Collection.md)\<[`TerrainLayout`](../../generated/interfaces/TerrainLayout.md), [`TerrainLayout`](../../generated/interfaces/TerrainLayout.md)\>

Defined in: [data/dataset.ts:102](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L102)

***

### resourcePools

> `readonly` **resourcePools**: [`Collection`](Collection.md)\<[`ResourcePool`](../../generated/interfaces/ResourcePool.md), [`ResourcePool`](../../generated/interfaces/ResourcePool.md)\>

Defined in: [data/dataset.ts:103](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L103)

***

### leaderAttachments

> `readonly` **leaderAttachments**: readonly [`LeaderAttachment`](../../generated/interfaces/LeaderAttachment.md)[]

Defined in: [data/dataset.ts:106](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L106)

***

### unitCompositions

> `readonly` **unitCompositions**: readonly [`UnitComposition`](../../generated/interfaces/UnitComposition.md)[]

Defined in: [data/dataset.ts:107](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L107)

***

### gameVersions

> `readonly` **gameVersions**: readonly [`GameVersion`](../../generated/interfaces/GameVersion.md)[]

Defined in: [data/dataset.ts:108](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L108)

***

### timingFlags

> `readonly` **timingFlags**: readonly [`TimingFlag`](../../generated/interfaces/TimingFlag.md)[]

Defined in: [data/dataset.ts:109](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L109)

***

### interactionFlags

> `readonly` **interactionFlags**: readonly [`InteractionFlag`](../../generated/interfaces/InteractionFlag.md)[]

Defined in: [data/dataset.ts:110](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L110)

***

### phaseMappings

> `readonly` **phaseMappings**: readonly [`PhaseMapping`](../../generated/interfaces/PhaseMapping.md)[]

Defined in: [data/dataset.ts:111](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L111)

## Methods

### embedded()

> `static` **embedded**(): `Dataset`

Defined in: [data/dataset.ts:186](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L186)

The dataset built from the package's embedded data.

#### Returns

`Dataset`

***

### phasesFor()

> **phasesFor**(`sourceType`, `sourceId`): [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [data/dataset.ts:191](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L191)

Phases a source acts in, unioned across its phase-mappings.

#### Parameters

##### sourceType

`string`

##### sourceId

`string`

#### Returns

[`Phase`](../../generated/type-aliases/Phase.md)[]

***

### resolveTerrain()

> **resolveTerrain**(`layout`): `ResolvedPiece`[]

Defined in: [data/dataset.ts:201](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L201)

Resolve a terrain layout to absolute board-space vertices using this
dataset's embedded terrain-template catalog — the layout-id →
renderable-geometry hop. Mirror of Rust `Dataset::resolve_terrain`; the
geometry is pinned by the `terrain-resolver` conformance corpus.

#### Parameters

##### layout

[`TerrainLayout`](../../generated/interfaces/TerrainLayout.md)

#### Returns

`ResolvedPiece`[]

***

### recommendedTerrainLayouts()

> **recommendedTerrainLayouts**(`pattern`): [`TerrainLayout`](../../generated/interfaces/TerrainLayout.md)[]

Defined in: [data/dataset.ts:211](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L211)

The terrain layouts a deployment pattern recommends, in declared order,
skipping any ids absent from the dataset.

#### Parameters

##### pattern

[`DeploymentPattern`](../../generated/interfaces/DeploymentPattern.md)

#### Returns

[`TerrainLayout`](../../generated/interfaces/TerrainLayout.md)[]

***

### unitsWithAbility()

> **unitsWithAbility**(`abilityId`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:218](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L218)

Units that list the given ability id.

#### Parameters

##### abilityId

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### unitsWithWeapon()

> **unitsWithWeapon**(`weaponId`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:223](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L223)

Units that list the given weapon id.

#### Parameters

##### weaponId

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### weaponsWithKeyword()

> **weaponsWithKeyword**(`keywordId`): [`WeaponView`](WeaponView.md)[]

Defined in: [data/dataset.ts:228](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L228)

Weapons whose profiles reference the given weapon-keyword id.

#### Parameters

##### keywordId

`string`

#### Returns

[`WeaponView`](WeaponView.md)[]

***

### wargearOptionsOf()

> **wargearOptionsOf**(`unit`): [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

Defined in: [data/dataset.ts:236](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L236)

Wargear options authored for the given unit, in declared order. Mirror of
Rust `Dataset::wargear_options_of`. Empty for a unit with no options.

#### Parameters

##### unit

[`Unit`](../../generated/interfaces/Unit.md)

#### Returns

[`WargearOption`](../../generated/interfaces/WargearOption.md)[]

***

### leadersAttachableTo()

> **leadersAttachableTo**(`bodyguardUnitId`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:247](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L247)

Leaders whose leader-attachment data lists `bodyguardUnitId` among its
eligible body units, sorted by name. The attachment is stored on the
leader pointing down to its bodyguards, so answering "which leaders can
attach to this unit?" means scanning the attachment list. Returns an empty
array for a unit that no leader can attach to (including leader units).

#### Parameters

##### bodyguardUnitId

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### bodyguardsAttachableFrom()

> **bodyguardsAttachableFrom**(`leaderUnitId`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:263](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L263)

The inverse of [leadersAttachableTo](#leadersattachableto): the body units the given
leader can attach to, sorted by name. Scans the same leader-attachment
data from the leader's side (`leader_id` matches; resolve each
`eligible_bodyguard_ids` entry), deduped by id. Empty for a non-leader
unit. Together the two queries give the bidirectional attachment graph the
SPA needs to offer a partner dropdown from either end.

#### Parameters

##### leaderUnitId

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### eligibleAbilities()

> **eligibleAbilities**(`input`, `phase`): [`EligibleAbility`](../type-aliases/EligibleAbility.md)[]

Defined in: [data/dataset.ts:283](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L283)

Enumerate every ability that could apply to the given unit in `phase`,
grouped by source. The SPA uses this to render the abilities pane.

#### Parameters

##### input

[`EligibilityInput`](../type-aliases/EligibilityInput.md)

##### phase

[`Phase`](../../generated/type-aliases/Phase.md)

#### Returns

[`EligibleAbility`](../type-aliases/EligibleAbility.md)[]

***

### buffsFor()

> **buffsFor**(`input`, `context`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/dataset.ts:300](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L300)

Attacker-perspective [Buff](../type-aliases/Buff.md) stack for a (unit, phase) combination:
intrinsic weapon-profile keywords plus every eligible ability whose DSL
effect translates to an attacker-side buff (army, detachment, unit,
attached members, support, plus any stratagems the caller has opted into).

The result includes only buffs the buff layer can express today — the
`unsupported` half of the DSL→Buff translation is dropped here so callers
who just want the stack don't need to thread diagnostics through. Use
[AbilityView.describeBuffs](AbilityView.md#describebuffs) when you need the diagnostics for an
individual ability. Symmetric to [defensiveBuffsFor](#defensivebuffsfor), which walks
the same eligibility set under target perspective.

#### Parameters

##### input

[`EligibilityInput`](../type-aliases/EligibilityInput.md) & `object`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

[`Buff`](../type-aliases/Buff.md)[]

***

### defensiveBuffsFor()

> **defensiveBuffsFor**(`input`, `context`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/dataset.ts:324](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L324)

Defender-perspective buff stack for the chosen unit: walks the same
eligible-abilities set as [buffsFor](#buffsfor) but translates each ability's
DSL effect as defensive (FNP, save mods from `stat-modifier Sv`,
toughness mods from `stat-modifier T`, save rerolls, incoming hit
penalties from `bs-modifier`). Use this when the chosen unit is being
crunched as the *target* — the engine reads `feelNoPain`/`saveMod`/
`toughnessMod` out of `resolveBuffs` so wiring the result into `crunch`
just means concatenating onto the existing `buffs` array.

`weaponProfiles` are ignored under target perspective — weapon-keyword
effects ride with the firing weapon, not the receiving unit.

#### Parameters

##### input

[`EligibilityInput`](../type-aliases/EligibilityInput.md) & `object`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

[`Buff`](../type-aliases/Buff.md)[]

***

### stackableBuffsFor()

> **stackableBuffsFor**(`input`, `context`): `object`

Defined in: [data/dataset.ts:353](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L353)

Enumerate every attacker-side buff a unit could stack in `context` as a
list of toggleable levers, plus the activation groups that limit them.

Unlike [buffsFor](#buffsfor) — which returns only the buffs that auto-apply —
this surfaces the *player decisions* too: stratagems, and the activatable
gates the DSL models as dice-pool options, `choice` branches, or
timing-gated activations (e.g. Blessings of Khorne's three keyword grants).
Each lever carries `enabled` (its default state) and, where it's part of a
limited pool, a `group` id whose [StackableBuffGroup](../type-aliases/StackableBuffGroup.md) caps how many
can fire at once. The intended loop:

```ts
const { buffs } = ds.stackableBuffsFor(input, ctx);
const chosen = buffs.filter(b => b.enabled).flatMap(b => b.buffs);
crunch({ ...profiles, buffs: chosen, context: ctx }, ds);
```

Target/phase conditions a lever still carries (e.g. "vs Infantry") ride on
each buff's `applicableWhen`, so toggling it on is always safe — the
resolver gates it per-target.

#### Parameters

##### input

[`EligibilityInput`](../type-aliases/EligibilityInput.md) & `object`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

`object`

##### buffs

> **buffs**: [`StackableBuff`](../type-aliases/StackableBuff.md)[]

##### groups

> **groups**: [`StackableBuffGroup`](../type-aliases/StackableBuffGroup.md)[]
