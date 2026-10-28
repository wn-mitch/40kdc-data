[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EngineContext

# Type Alias: EngineContext

> **EngineContext** = `object`

Defined in: [cruncher/buffs.ts:196](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L196)

Shared engine context. Carries the phase plus a few attacker/target flags
the keyword translator and the resolver both need. The engine fills it from
its `EngineInput.context` plus the unit-keyword unions; the resolver reads
only the subset relevant to its `applicableWhen` checks.

## Properties

### phase

> **phase**: [`Phase`](../../generated/type-aliases/Phase.md)

Defined in: [cruncher/buffs.ts:197](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L197)

***

### attackerStationary?

> `optional` **attackerStationary?**: `boolean`

Defined in: [cruncher/buffs.ts:199](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L199)

Attacker has not moved this turn — Heavy fires its +1 to hit.

***

### attackerCharged?

> `optional` **attackerCharged?**: `boolean`

Defined in: [cruncher/buffs.ts:206](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L206)

Attacker made a charge move this turn — drives the `charged-this-turn`
condition (e.g. World Eaters' Relentless Rage). Left undefined when the
caller can't determine it — the condition then evaluates as `"unknown"` and
the SPA surfaces a diagnostic (mirrors `attackerStationary` / `timing`).

***

### withinHalfRange?

> `optional` **withinHalfRange?**: `boolean`

Defined in: [cruncher/buffs.ts:208](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L208)

Within half the weapon's range — Melta / Rapid Fire fire.

***

### distanceInches?

> `optional` **distanceInches?**: `number`

Defined in: [cruncher/buffs.ts:214](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L214)

Distance to the target in inches. Drives `applicableWhen.maxRangeInches`
for range-gated abilities. When absent, explicit maximum-range gates do
not match; buffs without such a gate are unaffected.

***

### attackerInCover?

> `optional` **attackerInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:216](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L216)

Attacker benefits from cover (mostly informational; cover applies to defenders).

***

### targetInCover?

> `optional` **targetInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:218](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L218)

Target is in cover — the resolver flips on `cover`, the engine applies +1 to save.

***

### attackerKeywords?

> `optional` **attackerKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:220](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L220)

Attacker keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### targetKeywords?

> `optional` **targetKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:222](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L222)

Target keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### attackerModelKeywords?

> `optional` **attackerModelKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:228](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L228)

Keywords every model making the attack carries, lower-cased: the keywords and faction keywords
shared by the attacking datasheets. Resolves model-level keyword filters; absent leaves them
unknown unless `attackerKeywords` rules every model out.

***

### targetModelKeywords?

> `optional` **targetModelKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:230](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L230)

Keywords every model of the target carries, lower-cased; the target-side counterpart of [attackerModelKeywords](#attackermodelkeywords).

***

### attackerMemberKeywords?

> `optional` **attackerMemberKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:237](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L237)

Keywords any model making the attack can carry, lower-cased: the attacking member's own
datasheet keywords when one member of a combined unit attacks. The combined unit has every
member's keywords (core rule 19.01), but a model does not gain another member's keywords, so
this bounds model-level keyword filters. Absent, `attackerKeywords` bounds them.

***

### targetMemberKeywords?

> `optional` **targetMemberKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:239](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L239)

The target-side counterpart of [attackerMemberKeywords](#attackermemberkeywords).

***

### timing?

> `optional` **timing?**: `string`

Defined in: [cruncher/buffs.ts:246](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L246)

Sub-phase timing flag (e.g. `"start-of-phase"`, `"end-of-phase"`,
`"on-destroyed"`). Consumed by the `timing-is` condition. Left undefined
when the caller can't pin a sub-phase down — the condition then evaluates
as `"unknown"` and the SPA surfaces a diagnostic.

***

### attackerAttached?

> `optional` **attackerAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:248](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L248)

Whether the attacking and defending unit are attached; this alone never establishes a role.

***

### targetAttached?

> `optional` **targetAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:249](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L249)

***

### armyFaction?

> `optional` **armyFaction?**: `string`

Defined in: [cruncher/buffs.ts:251](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L251)

The army's Army Faction id. Drives the `army-faction` condition; undefined leaves it "unknown".

***

### targetArmyFaction?

> `optional` **targetArmyFaction?**: `string`

Defined in: [cruncher/buffs.ts:253](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L253)

The defending army's Army Faction id, for the `army-faction` condition of the target's own rules.

***

### battleSize?

> `optional` **battleSize?**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [cruncher/buffs.ts:255](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L255)

The battle size being played. Drives the `battle-size` condition; undefined leaves it "unknown".

***

### attackerGuided?

> `optional` **attackerGuided?**: `boolean`

Defined in: [cruncher/buffs.ts:260](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L260)

The attacking unit is Guided (For the Greater Good: not an Observer, targeting a Spotted unit).
Drives the `guided` condition; undefined leaves it "unknown".

***

### attackerModelCount?

> `optional` **attackerModelCount?**: `number`

Defined in: [cruncher/buffs.ts:262](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L262)

Models in the attacking unit. Drives `model-count` on the attacker; undefined leaves it "unknown".

***

### targetModelCount?

> `optional` **targetModelCount?**: `number`

Defined in: [cruncher/buffs.ts:264](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L264)

Models in the target unit. Drives `model-count` on the defender; undefined leaves it "unknown".

***

### attackerKeywordModels?

> `optional` **attackerKeywordModels?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:270](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L270)

How many models of each unit carry a keyword, by keyword (matched case-insensitively). Drives
`model-count` with a keyword; a keyword the record omits stays "unknown" unless every model
carries it.

***

### targetKeywordModels?

> `optional` **targetKeywordModels?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:271](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L271)

***

### attackerWargear?

> `optional` **attackerWargear?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:279](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L279)

The wargear the attacking unit's chosen loadout includes: by wargear id, how many of its
models carry it. An attached unit is one unit (core rule 19.01), so its record sums every
member's loadout, as [attackerModelCount](#attackermodelcount) counts every member's models. A supplied record
is complete, so an id it omits is carried by no model. Drives `unit-wargear` on the attacker;
undefined leaves it "unknown".

***

### targetWargear?

> `optional` **targetWargear?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:281](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L281)

The target's counterpart of [attackerWargear](#attackerwargear).

***

### weaponNames?

> `optional` **weaponNames?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:286](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L286)

Lower-cased names of the attacking weapon and its profile. Drives
`applicableWhen.weaponName`; missing names cannot satisfy a weapon-name gate.

***

### weaponKeywords?

> `optional` **weaponKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:291](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L291)

Catalog IDs printed on the attacking weapon profile, sufficient for rating-agnostic
selectors. The engine also supplies parameter-bearing refs for rated selectors.

***

### weaponKeywordRefs?

> `optional` **weaponKeywordRefs?**: readonly [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:293](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L293)

Parameter-bearing printed keywords, needed for rated weapon selectors.

***

### attackerAttachmentRole?

> `optional` **attackerAttachmentRole?**: `"leader"` \| `"bodyguard"`

Defined in: [cruncher/buffs.ts:294](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L294)

***

### targetAttachmentRole?

> `optional` **targetAttachmentRole?**: `"leader"` \| `"bodyguard"`

Defined in: [cruncher/buffs.ts:295](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L295)

***

### attachmentRoles?

> `optional` **attachmentRoles?**: `Readonly`\<`Record`\<`string`, `"leader"` \| `"bodyguard"`\>\>

Defined in: [cruncher/buffs.ts:297](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L297)

Actual per-member roles, used when a condition refers to the ability's source model.

***

### attackerUnitId?

> `optional` **attackerUnitId?**: `string`

Defined in: [cruncher/buffs.ts:298](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L298)

***

### targetUnitId?

> `optional` **targetUnitId?**: `string`

Defined in: [cruncher/buffs.ts:299](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L299)

***

### battleRound?

> `optional` **battleRound?**: `number`

Defined in: [cruncher/buffs.ts:301](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L301)

The battle round. Drives `battle-round` and per-round range tables; undefined leaves them "unknown".

***

### attackerTurn?

> `optional` **attackerTurn?**: `boolean`

Defined in: [cruncher/buffs.ts:306](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L306)

It is the attacking unit's player's turn. Drives `player-turn-is`, read for the side whose
ability it is: "your turn" for a defensive ability is the opponent of the attacker.

***

### attackerStrength?

> `optional` **attackerStrength?**: `UnitStrength`

Defined in: [cruncher/buffs.ts:308](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L308)

Each unit against its Starting Strength. Drives `strength`; undefined leaves it "unknown".

***

### targetStrength?

> `optional` **targetStrength?**: `UnitStrength`

Defined in: [cruncher/buffs.ts:309](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L309)

***

### attackerWounds?

> `optional` **attackerWounds?**: `ModelWounds`

Defined in: [cruncher/buffs.ts:311](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L311)

The wounds of each unit's damaged (or only) model. Drives `wounds`; undefined leaves it "unknown".

***

### targetWounds?

> `optional` **targetWounds?**: `ModelWounds`

Defined in: [cruncher/buffs.ts:312](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L312)

***

### attackerDesignations?

> `optional` **attackerDesignations?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:318](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L318)

Every designation each unit carries (Spotted, Afflicted, a Stratagem's chosen target,
`warlord`), matched case-insensitively. A supplied list is complete; undefined leaves
`designated` filters "unknown".

***

### targetDesignations?

> `optional` **targetDesignations?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:319](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L319)

***

### attackerStates?

> `optional` **attackerStates?**: readonly `UnitState`[]

Defined in: [cruncher/buffs.ts:325](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L325)

Every state each unit is in, of `engaged`, `battle-shocked` and `hidden`. A supplied list is
complete; undefined leaves those `state` filters "unknown". Both units of an attack are on the
battlefield and not in Strategic Reserves.

***

### targetStates?

> `optional` **targetStates?**: readonly `UnitState`[]

Defined in: [cruncher/buffs.ts:326](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L326)

***

### targetClosest?

> `optional` **targetClosest?**: `boolean`

Defined in: [cruncher/buffs.ts:328](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L328)

The target is the closest eligible target to the attacker. Drives `closest`; undefined leaves it "unknown".

***

### attackerObjectives?

> `optional` **attackerObjectives?**: readonly `ScenarioObjective`[]

Defined in: [cruncher/buffs.ts:333](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L333)

Every objective each unit is within control range of. A supplied list is complete; undefined
leaves objective `within` filters "unknown".

***

### targetObjectives?

> `optional` **targetObjectives?**: readonly `ScenarioObjective`[]

Defined in: [cruncher/buffs.ts:334](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L334)

***

### attackerNeighbours?

> `optional` **attackerNeighbours?**: readonly `ScenarioNeighbour`[]

Defined in: [cruncher/buffs.ts:339](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L339)

The other units near each unit of the attack. A supplied list is complete: a unit it omits is
beyond every range a filter names. Undefined leaves proximity filters on other units "unknown".

***

### targetNeighbours?

> `optional` **targetNeighbours?**: readonly `ScenarioNeighbour`[]

Defined in: [cruncher/buffs.ts:340](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L340)

***

### activeRules?

> `optional` **activeRules?**: readonly `ActiveRule`[]

Defined in: [cruncher/buffs.ts:346](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L346)

Every rule active for the attack: a rule id, or one option or named definition of it. A
supplied list is complete; undefined leaves `rule-active` "unknown", except that a gate on a
stance option becomes a lever requiring that option.

***

### attackerRegions?

> `optional` **attackerRegions?**: readonly `ScenarioRegion`[]

Defined in: [cruncher/buffs.ts:348](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L348)

Every region each unit is in. A supplied list is complete; undefined leaves `in-region` "unknown".

***

### targetRegions?

> `optional` **targetRegions?**: readonly `ScenarioRegion`[]

Defined in: [cruncher/buffs.ts:349](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L349)

***

### objectivesControlled?

> `optional` **objectivesControlled?**: `object`

Defined in: [cruncher/buffs.ts:351](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L351)

Objectives each side controls, and how many there are. Drives `controls`; undefined leaves it "unknown".

#### attacker

> **attacker**: `number`

#### target

> **target**: `number`

#### total

> **total**: `number`

***

### objectives?

> `optional` **objectives?**: readonly `ScenarioObjective`[]

Defined in: [cruncher/buffs.ts:356](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L356)

Every objective on the battlefield. A supplied list is complete. Drives `controls` with an
objective filter and `designated` on objectives; undefined leaves them "unknown".

***

### attackerDesignationsApplied?

> `optional` **attackerDesignationsApplied?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:362](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L362)

How many units carry each designation the attacking (or target) unit applied. A supplied record
is complete: a designation it omits is on no unit. Drives a `designated` count `by` that unit;
undefined leaves it "unknown".

***

### targetDesignationsApplied?

> `optional` **targetDesignationsApplied?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:363](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L363)

***

### attackerMoves?

> `optional` **attackerMoves?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:369](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L369)

Every move each unit made this turn (`normal`, `advance`, `fall-back`, `charge`,
`remain-stationary`, `ingress`). A supplied list is complete; undefined leaves `happened`
move conditions "unknown", apart from the stationary and charge flags above.

***

### targetMoves?

> `optional` **targetMoves?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:370](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L370)

***

### testResults?

> `optional` **testResults?**: `Readonly`\<`Record`\<`string`, `"success"` \| `"failure"`\>\>

Defined in: [cruncher/buffs.ts:375](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L375)

The result of the test an ability made, by roll (`leadership`, `battle-shock`, `charge`).
Drives `roll-result` for those rolls; a roll it omits stays "unknown".

***

### attackerSelected?

> `optional` **attackerSelected?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:381](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L381)

Every activity each unit has been selected for this phase (`fight`, `shoot`, `move`,
`observe`). A supplied list is complete; undefined leaves `happened` selection conditions
"unknown".

***

### targetSelected?

> `optional` **targetSelected?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:382](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L382)

***

### attackerKills?

> `optional` **attackerKills?**: `object`

Defined in: [cruncher/buffs.ts:384](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L384)

Enemy models and units each unit destroyed this phase. Undefined leaves `happened` kill conditions "unknown".

#### models

> **models**: `number`

#### units

> **units**: `number`

***

### targetKills?

> `optional` **targetKills?**: `object`

Defined in: [cruncher/buffs.ts:385](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L385)

#### models

> **models**: `number`

#### units

> **units**: `number`

***

### attackerLosses?

> `optional` **attackerLosses?**: `number`

Defined in: [cruncher/buffs.ts:387](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L387)

Models each unit lost this phase. Undefined leaves `happened` loss conditions "unknown".

***

### targetLosses?

> `optional` **targetLosses?**: `number`

Defined in: [cruncher/buffs.ts:388](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L388)

***

### attackerRolls?

> `optional` **attackerRolls?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:394](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L394)

Every roll each unit made this phase, and every roll made against it, with its result. A
supplied list is complete; undefined leaves `happened` roll conditions "unknown". A critical
result is also a success.

***

### targetRolls?

> `optional` **targetRolls?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:395](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L395)

***

### attackerRolledAgainst?

> `optional` **attackerRolledAgainst?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:396](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L396)

***

### targetRolledAgainst?

> `optional` **targetRolledAgainst?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:397](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L397)

***

### attackerMembers?

> `optional` **attackerMembers?**: readonly `AttachedMember`[]

Defined in: [cruncher/buffs.ts:402](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L402)

Every unit of each combined unit, the unit itself included. Settles `attachment` roles and
`with` filters; undefined leaves those to the attachment flags above.

***

### targetMembers?

> `optional` **targetMembers?**: readonly `AttachedMember`[]

Defined in: [cruncher/buffs.ts:403](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L403)

***

### recipientSnapshots?

> `optional` **recipientSnapshots?**: readonly [`RecipientSnapshot`](../interfaces/RecipientSnapshot.md)[]

Defined in: [cruncher/buffs.ts:415](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L415)

Caller-attested trigger-time recipient evidence, not current membership.
Each entry preserves the ability source/sourceUnitId, exact canonical
trigger and selector, selectionPath JSON pointer, perspective,
recipientUnitId, and selected result. Object-key order is immaterial;
array order and every supplied field matter. Callers provide live
event-time evidence and assert activation/equipment; no internal history
or clock is consulted. Missing, mismatched, or conflicting evidence is
unsupported; selected:false resolves to no effect. Parent trigger
identity remains distinct from unrelated effect guards.

***

### attackStrength?

> `optional` **attackStrength?**: `number`

Defined in: [cruncher/buffs.ts:417](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L417)

The attack's modified Strength. The engine supplies it; undefined fails `attackComparisons`.

***

### targetToughness?

> `optional` **targetToughness?**: `number`

Defined in: [cruncher/buffs.ts:422](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L422)

The target's modified Toughness: the attacked profile's, and the highest and lowest over the
target's profiles for a `reduce` comparison. The engine supplies them.

***

### targetToughnessMax?

> `optional` **targetToughnessMax?**: `number`

Defined in: [cruncher/buffs.ts:423](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L423)

***

### targetToughnessMin?

> `optional` **targetToughnessMin?**: `number`

Defined in: [cruncher/buffs.ts:424](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L424)

***

### attackerToughness?

> `optional` **attackerToughness?**: `number`

Defined in: [cruncher/buffs.ts:426](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L426)

The attacking unit's Toughness (its highest model's). Caller-supplied; undefined fails comparisons that read it.

***

### criticalRoll?

> `optional` **criticalRoll?**: `"wound"`

Defined in: [cruncher/buffs.ts:431](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L431)

The roll that was a critical one, for the buffs that apply only then. The engine sets it when
resolving the attacks that score a critical wound; callers leave it unset.
