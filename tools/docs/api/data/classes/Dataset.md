[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / Dataset

# Class: Dataset

Defined in: [data/dataset.ts:105](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L105)

The whole dataset, with linked accessors over every entity collection.

A dataset is a **game-mode view**: [gameMode](#gamemode) is the mode its listings
show. `Dataset.embedded()` and `new Dataset(raw)` are the matched-play view;
[forGameMode](#forgamemode) returns another view over the same records and indexes.
In a view, listings of mode-scoped records (units, weapons, detachments,
enhancements, stratagems, wargear options, unit compositions) skip those whose
effective `game_modes` (absent → matched play) lack the mode — collection
`all`/iteration/`size`/`byFaction`/`find`/`findAll`, the `unitCompositions`
array, and the reverse listings ([unitsWithKeyword](#unitswithkeyword) and kin). Id lookups
(`get`, `getAny`, `getInFaction`, `has`, `byExternalRef`) and per-record links
([wargearOptionsOf](#wargearoptionsof), [unitCompositionOf](#unitcompositionof), a unit's weapons and
abilities) resolve every record in every view, so share tokens, saved rosters
and references keep resolving. `"all"` lists everything.

## Constructors

### Constructor

> **new Dataset**(`raw?`, `gameMode?`): `Dataset`

Defined in: [data/dataset.ts:164](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L164)

#### Parameters

##### raw?

[`RawData`](../interfaces/RawData.md) = `...`

##### gameMode?

[`GameModeView`](../type-aliases/GameModeView.md) = `DEFAULT_GAME_MODE`

#### Returns

`Dataset`

## Properties

### gameMode

> `readonly` **gameMode**: [`GameModeView`](../type-aliases/GameModeView.md)

Defined in: [data/dataset.ts:107](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L107)

The game mode this view lists (`"all"` lists every record).

***

### units

> `readonly` **units**: [`Collection`](Collection.md)\<[`Unit`](../../generated/interfaces/Unit.md), [`UnitView`](UnitView.md)\>

Defined in: [data/dataset.ts:112](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L112)

***

### weapons

> `readonly` **weapons**: [`Collection`](Collection.md)\<[`Weapon`](../../generated/interfaces/Weapon.md), [`WeaponView`](WeaponView.md)\>

Defined in: [data/dataset.ts:113](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L113)

***

### weaponKeywords

> `readonly` **weaponKeywords**: [`Collection`](Collection.md)\<[`WeaponKeyword`](../../generated/interfaces/WeaponKeyword.md), [`WeaponKeywordView`](WeaponKeywordView.md)\>

Defined in: [data/dataset.ts:114](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L114)

***

### factions

> `readonly` **factions**: [`Collection`](Collection.md)\<[`Faction`](../../generated/interfaces/Faction.md), [`FactionView`](FactionView.md)\>

Defined in: [data/dataset.ts:115](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L115)

***

### abilities

> `readonly` **abilities**: [`Collection`](Collection.md)\<[`AbilityDSLEntry`](../../generated/interfaces/AbilityDSLEntry.md), [`AbilityView`](AbilityView.md)\>

Defined in: [data/dataset.ts:116](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L116)

***

### unitKeywords

> `readonly` **unitKeywords**: [`Collection`](Collection.md)\<[`UnitKeyword`](../../generated/interfaces/UnitKeyword.md), [`UnitKeyword`](../../generated/interfaces/UnitKeyword.md)\>

Defined in: [data/dataset.ts:119](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L119)

***

### targetProfiles

> `readonly` **targetProfiles**: [`Collection`](Collection.md)\<[`TargetProfile`](../../generated/interfaces/TargetProfile.md), [`TargetProfile`](../../generated/interfaces/TargetProfile.md)\>

Defined in: [data/dataset.ts:120](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L120)

***

### detachments

> `readonly` **detachments**: [`Collection`](Collection.md)\<[`Detachment`](../../generated/interfaces/Detachment.md), [`Detachment`](../../generated/interfaces/Detachment.md)\>

Defined in: [data/dataset.ts:121](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L121)

***

### alliedRules

> `readonly` **alliedRules**: [`Collection`](Collection.md)\<[`AlliedRule`](../../generated/interfaces/AlliedRule.md), [`AlliedRule`](../../generated/interfaces/AlliedRule.md)\>

Defined in: [data/dataset.ts:122](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L122)

***

### enhancements

> `readonly` **enhancements**: [`Collection`](Collection.md)\<[`Enhancement`](../../generated/interfaces/Enhancement.md), [`Enhancement`](../../generated/interfaces/Enhancement.md)\>

Defined in: [data/dataset.ts:123](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L123)

***

### stratagems

> `readonly` **stratagems**: [`Collection`](Collection.md)\<[`Stratagem`](../../generated/interfaces/Stratagem.md), [`Stratagem`](../../generated/interfaces/Stratagem.md)\>

Defined in: [data/dataset.ts:124](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L124)

***

### wargearOptions

> `readonly` **wargearOptions**: [`Collection`](Collection.md)\<[`WargearOption`](../../generated/interfaces/WargearOption.md), [`WargearOption`](../../generated/interfaces/WargearOption.md)\>

Defined in: [data/dataset.ts:125](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L125)

***

### wargear

> `readonly` **wargear**: [`Collection`](Collection.md)\<[`Wargear`](../../generated/interfaces/Wargear.md), [`Wargear`](../../generated/interfaces/Wargear.md)\>

Defined in: [data/dataset.ts:126](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L126)

***

### missions

> `readonly` **missions**: [`Collection`](Collection.md)\<[`Mission`](../../generated/interfaces/Mission.md), [`Mission`](../../generated/interfaces/Mission.md)\>

Defined in: [data/dataset.ts:127](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L127)

***

### missionMatchups

> `readonly` **missionMatchups**: [`Collection`](Collection.md)\<[`MissionMatchup`](../../generated/interfaces/MissionMatchup.md), [`MissionMatchup`](../../generated/interfaces/MissionMatchup.md)\>

Defined in: [data/dataset.ts:128](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L128)

***

### missionCards

> `readonly` **missionCards**: [`Collection`](Collection.md)\<[`SecondaryCard`](../../generated/interfaces/SecondaryCard.md), [`SecondaryCard`](../../generated/interfaces/SecondaryCard.md)\>

Defined in: [data/dataset.ts:129](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L129)

***

### deploymentPatterns

> `readonly` **deploymentPatterns**: [`Collection`](Collection.md)\<[`DeploymentPattern`](../../generated/interfaces/DeploymentPattern.md), [`DeploymentPattern`](../../generated/interfaces/DeploymentPattern.md)\>

Defined in: [data/dataset.ts:130](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L130)

***

### forceDispositions

> `readonly` **forceDispositions**: [`Collection`](Collection.md)\<[`ForceDisposition`](../../generated/interfaces/ForceDisposition.md), [`ForceDisposition`](../../generated/interfaces/ForceDisposition.md)\>

Defined in: [data/dataset.ts:131](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L131)

***

### terrainTemplates

> `readonly` **terrainTemplates**: [`Collection`](Collection.md)\<[`TerrainTemplate`](../../generated/interfaces/TerrainTemplate.md), [`TerrainTemplate`](../../generated/interfaces/TerrainTemplate.md)\>

Defined in: [data/dataset.ts:132](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L132)

***

### terrainLayouts

> `readonly` **terrainLayouts**: [`Collection`](Collection.md)\<[`TerrainLayout`](../../generated/interfaces/TerrainLayout.md), [`TerrainLayout`](../../generated/interfaces/TerrainLayout.md)\>

Defined in: [data/dataset.ts:133](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L133)

***

### hullShapes

> `readonly` **hullShapes**: [`Collection`](Collection.md)\<[`HullShape`](../../generated/interfaces/HullShape.md), [`HullShape`](../../generated/interfaces/HullShape.md)\>

Defined in: [data/dataset.ts:134](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L134)

***

### resourcePools

> `readonly` **resourcePools**: [`Collection`](Collection.md)\<[`ResourcePool`](../../generated/interfaces/ResourcePool.md), [`ResourcePool`](../../generated/interfaces/ResourcePool.md)\>

Defined in: [data/dataset.ts:135](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L135)

***

### leaderAttachments

> `readonly` **leaderAttachments**: readonly [`LeaderAttachment`](../../generated/interfaces/LeaderAttachment.md)[]

Defined in: [data/dataset.ts:138](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L138)

***

### unitCompositions

> `readonly` **unitCompositions**: readonly [`UnitComposition`](../../generated/interfaces/UnitComposition.md)[]

Defined in: [data/dataset.ts:139](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L139)

***

### gameVersions

> `readonly` **gameVersions**: readonly [`GameVersion`](../../generated/interfaces/GameVersion.md)[]

Defined in: [data/dataset.ts:140](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L140)

***

### interactionFlags

> `readonly` **interactionFlags**: readonly [`InteractionFlag`](../../generated/interfaces/InteractionFlag.md)[]

Defined in: [data/dataset.ts:141](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L141)

***

### phaseMappings

> `readonly` **phaseMappings**: readonly [`PhaseMapping`](../../generated/interfaces/PhaseMapping.md)[]

Defined in: [data/dataset.ts:142](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L142)

## Methods

### embedded()

> `static` **embedded**(): `Dataset`

Defined in: [data/dataset.ts:294](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L294)

The dataset built from the package's embedded data: the matched-play view.

#### Returns

`Dataset`

***

### forGameMode()

> **forGameMode**(`mode`): `Dataset`

Defined in: [data/dataset.ts:303](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L303)

This dataset's view listing `mode` (a game-mode id, or `"all"` for every
record). The view shares this dataset's records and indexes; views are
cached, so repeated calls return the same object. Throws on an unknown mode.

#### Parameters

##### mode

[`GameModeView`](../type-aliases/GameModeView.md)

#### Returns

`Dataset`

***

### phasesFor()

> **phasesFor**(`sourceType`, `sourceId`): [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [data/dataset.ts:344](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L344)

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

Defined in: [data/dataset.ts:354](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L354)

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

Defined in: [data/dataset.ts:364](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L364)

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

Defined in: [data/dataset.ts:371](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L371)

Units that list the given ability id.

#### Parameters

##### abilityId

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### reactiveTriggers()

> **reactiveTriggers**(): [`ReactiveTrigger`](../type-aliases/ReactiveTrigger.md)[]

Defined in: [data/dataset.ts:382](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L382)

Every ability carrying a reactive event trigger, sorted by ability
id. Each entry names the units that list the ability (sorted; empty for
faction/detachment-rule abilities no unit references directly).

#### Returns

[`ReactiveTrigger`](../type-aliases/ReactiveTrigger.md)[]

***

### triggerIndex()

> **triggerIndex**(): `Map`\<[`GameEvent`](../../generated/type-aliases/GameEvent.md), [`ReactiveTrigger`](../type-aliases/ReactiveTrigger.md)[]\>

Defined in: [data/dataset.ts:392](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L392)

Dispatch index for event-driven consumers: [GameEvent](../../generated/type-aliases/GameEvent.md) → the reactive
triggers firing on it. Keys are iterated in event order and each bucket is
sorted by ability id, so the structure is deterministic across runs.

#### Returns

`Map`\<[`GameEvent`](../../generated/type-aliases/GameEvent.md), [`ReactiveTrigger`](../type-aliases/ReactiveTrigger.md)[]\>

***

### unitsWithWeapon()

> **unitsWithWeapon**(`weaponId`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:398](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L398)

Units that list the given weapon id.

#### Parameters

##### weaponId

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### weaponsWithKeyword()

> **weaponsWithKeyword**(`keywordId`): [`WeaponView`](WeaponView.md)[]

Defined in: [data/dataset.ts:405](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L405)

Weapons whose profiles reference the given weapon-keyword id.

#### Parameters

##### keywordId

`string`

#### Returns

[`WeaponView`](WeaponView.md)[]

***

### unitsWithKeyword()

> **unitsWithKeyword**(`keyword`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:418](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L418)

Units carrying the given keyword, matched case-insensitively against the
union of each unit's `keywords` and `faction_keywords`. Powers a list
builder's keyword search bar (type "Khorne" to find every Khorne unit),
across the whole dataset — so it also surfaces cross-faction ally pools.
Returns each faction's copy of a shared unit id separately.

#### Parameters

##### keyword

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### alliesFor()

> **alliesFor**(`factionId`, `detachmentIds?`): [`AlliedRule`](../../generated/interfaces/AlliedRule.md)[]

Defined in: [data/dataset.ts:434](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L434)

The allied-rules **offered** for an army of `factionId` running the given
detachments. A rule applies when both its gates pass: the **army gate**
(`army_keywords_any` empty, or intersecting the faction's keywords) and the
**detachment gate** (`detachment_ids` empty, or any listed id among `detachmentIds`). Order
follows the allied-rules data file. The strict "every *model* carries an
army keyword" check (for soup lists) is a builder/validation concern — this
offers the candidate rules a faction qualifies for. Mirror of Rust
`Dataset::allies_for`; pinned by the `allies_for` conformance query.

#### Parameters

##### factionId

`string`

##### detachmentIds?

`string`[] = `[]`

#### Returns

[`AlliedRule`](../../generated/interfaces/AlliedRule.md)[]

***

### allyUnitsFor()

> **allyUnitsFor**(`ruleId`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:448](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L448)

The unit pool an allied-rule grants, sorted by name. Starts from the rule's
`source_faction_id` (if set, to keep that faction's copy of shared ids) or
the whole dataset, then ANDs every filter the rule sets: `source_datasheet_ids`
(an explicit id allowlist — the primary selector for generated pools), any
`source_keywords`, `required_keywords` (all present), `excluded_keywords`
(none present), and `roles`. Empty for an unknown rule id or a pool that
resolves to nothing. Mirror of Rust `Dataset::ally_units_for`; pinned by the
`ally_units_for` conformance query.

#### Parameters

##### ruleId

`string`

#### Returns

[`UnitView`](UnitView.md)[]

***

### wargearOptionsOf()

> **wargearOptionsOf**(`unit`): [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

Defined in: [data/dataset.ts:460](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L460)

Wargear options authored for the given unit, in declared order. Scoped to
the unit's own faction: a chassis shared across factions (e.g.
`chaos-terminators` in World Eaters *and* Emperors Children) reuses the same
option ids for different swaps, so the lookup keys on `(faction_id, unit_id)`
— never the union across factions. Mirror of Rust `Dataset::wargear_options_of`.
Empty for a unit with no options.

#### Parameters

##### unit

[`Unit`](../../generated/interfaces/Unit.md)

#### Returns

[`WargearOption`](../../generated/interfaces/WargearOption.md)[]

***

### unitCompositionOf()

> **unitCompositionOf**(`unit`): [`UnitComposition`](../../generated/interfaces/UnitComposition.md) \| `undefined`

Defined in: [data/dataset.ts:473](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L473)

The unit-composition authored for the given unit, faction-scoped exactly
like [wargearOptionsOf](#wargearoptionsof): shared chassis carry a distinct composition
per faction under one `unit_id`, so the lookup keys on `(faction_id,
unit_id)` rather than the faction-blind `unitCompositions.find(...)`.
`undefined` when the unit has no composition.

#### Parameters

##### unit

[`Unit`](../../generated/interfaces/Unit.md)

#### Returns

[`UnitComposition`](../../generated/interfaces/UnitComposition.md) \| `undefined`

***

### leadersAttachableTo()

> **leadersAttachableTo**(`bodyguardUnitId`, `rosterUnitIds?`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:483](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L483)

Leaders eligible for `bodyguardUnitId`, sorted by name. Without roster
context this includes every possible conditional group; with a roster set
it includes only groups whose required units are present and excluded
units absent. Unconditional id and keyword eligibility always applies.

#### Parameters

##### bodyguardUnitId

`string`

##### rosterUnitIds?

`ReadonlySet`\<`string`\>

#### Returns

[`UnitView`](UnitView.md)[]

***

### bodyguardsAttachableFrom()

> **bodyguardsAttachableFrom**(`leaderUnitId`, `factionId?`, `rosterUnitIds?`): [`UnitView`](UnitView.md)[]

Defined in: [data/dataset.ts:493](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L493)

Bodyguards eligible for `leaderUnitId`, deduped by id and sorted by name.
Without roster context this includes every possible conditional group;
with a roster set it applies each group's required/excluded unit conditions.
`factionId` scopes the resolved bodyguard views when provided.

#### Parameters

##### leaderUnitId

`string`

##### factionId?

`string`

##### rosterUnitIds?

`ReadonlySet`\<`string`\>

#### Returns

[`UnitView`](UnitView.md)[]

***

### conditionalAttachmentRole()

> **conditionalAttachmentRole**(`leaderUnitId`, `rosterUnitIds`): `"leader"` \| `"support"` \| `undefined`

Defined in: [data/dataset.ts:502](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L502)

Conditional roster groups override the flat role; leader wins on overlap.

#### Parameters

##### leaderUnitId

`string`

##### rosterUnitIds

`ReadonlySet`\<`string`\>

#### Returns

`"leader"` \| `"support"` \| `undefined`

***

### eligibleAbilities()

> **eligibleAbilities**(`input`, `phase`): [`EligibleAbility`](../type-aliases/EligibleAbility.md)[]

Defined in: [data/dataset.ts:519](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L519)

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

Defined in: [data/dataset.ts:546](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L546)

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

Persistent recipient effects after an attachment changes are resolved only
from caller-attested `context.recipientSnapshots` captured at activation
time. The caller supplies live event-time evidence and asserts
activation/equipment; this dataset has no internal history or clock.
Discovery accepts an intrinsic source or an eligible enhancement with the
matching detachment; legality alone does not prove that a source was
equipped. Missing, mismatched, or conflicting snapshots are unsupported,
`selected: false` produces no effect, and a named parent trigger remains
distinct from unrelated effect guards.

#### Parameters

##### input

`Omit`\<[`EligibilityInput`](../type-aliases/EligibilityInput.md), `"unitId"`\> & `object` & `object`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

[`Buff`](../type-aliases/Buff.md)[]

***

### defensiveBuffsFor()

> **defensiveBuffsFor**(`input`, `context`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/dataset.ts:577](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L577)

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

Abilities pooled in from `attachedUnitIds` obey core rule 19.04: an effect
targeting a single model (DSL `this-model`, e.g. an attached character's
personal invulnerable save) is *not* returned as a buff on the combined
unit — it stays on its own model and surfaces in
[AbilityView.describeBuffs](AbilityView.md#describebuffs)'s `unsupported` list instead. Effects
targeting the unit (`this-unit`) do reach the whole unit.

#### Parameters

##### input

[`EligibilityInput`](../type-aliases/EligibilityInput.md) & `object`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

[`Buff`](../type-aliases/Buff.md)[]

***

### defensiveNeedsFor()

> **defensiveNeedsFor**(`input`, `context`): [`AbilityNeed`](../type-aliases/AbilityNeed.md)[]

Defined in: [data/dataset.ts:589](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L589)

The leaf conditions [defensiveBuffsFor](#defensivebuffsfor) leaves undecided for the
defending unit, each with the ability that raised it. Answering one in
`context.conditionFacts` under its `key` decides it.

#### Parameters

##### input

[`EligibilityInput`](../type-aliases/EligibilityInput.md) & `object`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

[`AbilityNeed`](../type-aliases/AbilityNeed.md)[]

***

### mortalWoundSourcesFor()

> **mortalWoundSourcesFor**(`input`, `context`): `object`

Defined in: [data/dataset.ts:607](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L607)

The mortal wounds a unit's abilities inflict on an enemy unit outside its attacks: after a
Charge move, at the start of a phase, when it is selected to shoot. Each source gives the
expected mortal wounds per occurrence of its moment, before Feel No Pain, assuming each of its
`needs` holds (answer one false in `context.conditionFacts` to remove it). `phase-is`
conditions never gate a source, so the context's phase does not filter them. Mortal wounds an
attack's own rolls inflict are buffs ([buffsFor](#buffsfor)), not sources; mortal wounds the unit
inflicts on itself are not reported.

#### Parameters

##### input

[`EligibilityInput`](../type-aliases/EligibilityInput.md)

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

`object`

##### sources

> **sources**: [`AbilityMortalWounds`](../type-aliases/AbilityMortalWounds.md)[]

##### unsupported

> **unsupported**: [`UnsupportedFragment`](../type-aliases/UnsupportedFragment.md) & `object`[]

***

### stackableBuffsFor()

> **stackableBuffsFor**(`input`, `context`): `object`

Defined in: [data/dataset.ts:637](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset.ts#L637)

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

`needs` lists the leaf conditions the context leaves undecided, each with
the ability that raised it. Answering one in `context.conditionFacts` under
its `key` decides it on the next call.

#### Parameters

##### input

`Omit`\<[`EligibilityInput`](../type-aliases/EligibilityInput.md), `"unitId"`\> & `object` & `object`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

`object`

##### buffs

> **buffs**: [`StackableBuff`](../type-aliases/StackableBuff.md)[]

##### groups

> **groups**: [`StackableBuffGroup`](../type-aliases/StackableBuffGroup.md)[]

##### needs

> **needs**: [`AbilityNeed`](../type-aliases/AbilityNeed.md)[]
