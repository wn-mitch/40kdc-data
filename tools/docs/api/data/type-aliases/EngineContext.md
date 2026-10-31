[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EngineContext

# Type Alias: EngineContext

> **EngineContext** = `object`

Defined in: [cruncher/buffs.ts:203](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L203)

Shared engine context. Carries the phase plus a few attacker/target flags
the keyword translator and the resolver both need. The engine fills it from
its `EngineInput.context` plus the unit-keyword unions; the resolver reads
only the subset relevant to its `applicableWhen` checks.

## Properties

### phase

> **phase**: [`Phase`](../../generated/type-aliases/Phase.md)

Defined in: [cruncher/buffs.ts:204](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L204)

***

### attackerStationary?

> `optional` **attackerStationary?**: `boolean`

Defined in: [cruncher/buffs.ts:206](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L206)

Attacker has not moved this turn — Heavy fires its +1 to hit.

***

### attackerCharged?

> `optional` **attackerCharged?**: `boolean`

Defined in: [cruncher/buffs.ts:213](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L213)

Attacker made a charge move this turn — drives the `charged-this-turn`
condition (e.g. World Eaters' Relentless Rage). Left undefined when the
caller can't determine it — the condition then evaluates as `"unknown"` and
the SPA surfaces a diagnostic (mirrors `attackerStationary` / `timing`).

***

### withinHalfRange?

> `optional` **withinHalfRange?**: `boolean`

Defined in: [cruncher/buffs.ts:215](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L215)

Within half the weapon's range — Melta / Rapid Fire fire.

***

### distanceInches?

> `optional` **distanceInches?**: `number`

Defined in: [cruncher/buffs.ts:221](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L221)

Distance to the target in inches. Drives `applicableWhen.maxRangeInches`
for range-gated abilities. When absent, explicit maximum-range gates do
not match; buffs without such a gate are unaffected.

***

### attackerInCover?

> `optional` **attackerInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:223](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L223)

Attacker benefits from cover (mostly informational; cover applies to defenders).

***

### targetInCover?

> `optional` **targetInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:225](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L225)

Target is in cover — the resolver flips on `cover`, the engine applies +1 to save.

***

### attackerKeywords?

> `optional` **attackerKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:227](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L227)

Attacker keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### targetKeywords?

> `optional` **targetKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:229](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L229)

Target keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### attackerModelKeywords?

> `optional` **attackerModelKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:235](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L235)

Keywords every model making the attack carries, lower-cased: the keywords and faction keywords
shared by the attacking datasheets. Resolves model-level keyword filters; absent leaves them
unknown unless `attackerKeywords` rules every model out.

***

### targetModelKeywords?

> `optional` **targetModelKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:237](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L237)

Keywords every model of the target carries, lower-cased; the target-side counterpart of [attackerModelKeywords](#attackermodelkeywords).

***

### attackerMemberKeywords?

> `optional` **attackerMemberKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:244](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L244)

Keywords any model making the attack can carry, lower-cased: the attacking member's own
datasheet keywords when one member of a combined unit attacks. The combined unit has every
member's keywords (core rule 19.01), but a model does not gain another member's keywords, so
this bounds model-level keyword filters. Absent, `attackerKeywords` bounds them.

***

### targetMemberKeywords?

> `optional` **targetMemberKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:246](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L246)

The target-side counterpart of [attackerMemberKeywords](#attackermemberkeywords).

***

### stratagemTargets?

> `optional` **stratagemTargets?**: `Readonly`\<`Record`\<`string`, `boolean`\>\>

Defined in: [cruncher/buffs.ts:253](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L253)

For the Stratagem being translated, whether the crunched unit is each of its named friendly
targets (`{stratagem_target: name}`): true for a target it can be when the Stratagem is used
on it, false for one it cannot. A name it does not list (an enemy target, or any name when
absent) is unresolved.

***

### timing?

> `optional` **timing?**: `string`

Defined in: [cruncher/buffs.ts:260](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L260)

Sub-phase timing flag (e.g. `"start-of-phase"`, `"end-of-phase"`,
`"on-destroyed"`). Consumed by the `timing-is` condition. Left undefined
when the caller can't pin a sub-phase down — the condition then evaluates
as `"unknown"` and the SPA surfaces a diagnostic.

***

### attackerAttached?

> `optional` **attackerAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:262](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L262)

Whether the attacking and defending unit are attached; this alone never establishes a role.

***

### targetAttached?

> `optional` **targetAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:263](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L263)

***

### armyFaction?

> `optional` **armyFaction?**: `string`

Defined in: [cruncher/buffs.ts:265](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L265)

The army's Army Faction id. Drives the `army-faction` condition; undefined leaves it "unknown".

***

### targetArmyFaction?

> `optional` **targetArmyFaction?**: `string`

Defined in: [cruncher/buffs.ts:267](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L267)

The defending army's Army Faction id, for the `army-faction` condition of the target's own rules.

***

### battleSize?

> `optional` **battleSize?**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [cruncher/buffs.ts:269](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L269)

The battle size being played. Drives the `battle-size` condition; undefined leaves it "unknown".

***

### attackerGuided?

> `optional` **attackerGuided?**: `boolean`

Defined in: [cruncher/buffs.ts:274](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L274)

The attacking unit is Guided (For the Greater Good: not an Observer, targeting a Spotted unit).
Drives the `guided` condition; undefined leaves it "unknown".

***

### attackerModelCount?

> `optional` **attackerModelCount?**: `number`

Defined in: [cruncher/buffs.ts:276](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L276)

Models in the attacking unit. Drives `model-count` on the attacker; undefined leaves it "unknown".

***

### targetModelCount?

> `optional` **targetModelCount?**: `number`

Defined in: [cruncher/buffs.ts:278](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L278)

Models in the target unit. Drives `model-count` on the defender; undefined leaves it "unknown".

***

### attackerKeywordModels?

> `optional` **attackerKeywordModels?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:284](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L284)

How many models of each unit carry a keyword, by keyword (matched case-insensitively). Drives
`model-count` with a keyword; a keyword the record omits stays "unknown" unless every model
carries it.

***

### targetKeywordModels?

> `optional` **targetKeywordModels?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:285](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L285)

***

### attackerWargear?

> `optional` **attackerWargear?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:293](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L293)

The wargear the attacking unit's chosen loadout includes: by wargear id, how many of its
models carry it. An attached unit is one unit (core rule 19.01), so its record sums every
member's loadout, as [attackerModelCount](#attackermodelcount) counts every member's models. A supplied record
is complete, so an id it omits is carried by no model. Drives `unit-wargear` on the attacker;
undefined leaves it "unknown".

***

### targetWargear?

> `optional` **targetWargear?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:295](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L295)

The target's counterpart of [attackerWargear](#attackerwargear).

***

### weaponNames?

> `optional` **weaponNames?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:300](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L300)

Lower-cased names of the attacking weapon and its profile. Drives
`applicableWhen.weaponName`; missing names cannot satisfy a weapon-name gate.

***

### weaponKeywords?

> `optional` **weaponKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:305](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L305)

Catalog IDs printed on the attacking weapon profile, sufficient for rating-agnostic
selectors. The engine also supplies parameter-bearing refs for rated selectors.

***

### weaponKeywordRefs?

> `optional` **weaponKeywordRefs?**: readonly [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:307](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L307)

Parameter-bearing printed keywords, needed for rated weapon selectors.

***

### attackerAttachmentRole?

> `optional` **attackerAttachmentRole?**: `"leader"` \| `"bodyguard"`

Defined in: [cruncher/buffs.ts:308](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L308)

***

### targetAttachmentRole?

> `optional` **targetAttachmentRole?**: `"leader"` \| `"bodyguard"`

Defined in: [cruncher/buffs.ts:309](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L309)

***

### attachmentRoles?

> `optional` **attachmentRoles?**: `Readonly`\<`Record`\<`string`, `"leader"` \| `"bodyguard"`\>\>

Defined in: [cruncher/buffs.ts:311](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L311)

Actual per-member roles, used when a condition refers to the ability's source model.

***

### attackerUnitId?

> `optional` **attackerUnitId?**: `string`

Defined in: [cruncher/buffs.ts:312](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L312)

***

### targetUnitId?

> `optional` **targetUnitId?**: `string`

Defined in: [cruncher/buffs.ts:313](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L313)

***

### battleRound?

> `optional` **battleRound?**: `number`

Defined in: [cruncher/buffs.ts:315](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L315)

The battle round. Drives `battle-round` and per-round range tables; undefined leaves them "unknown".

***

### attackerTurn?

> `optional` **attackerTurn?**: `boolean`

Defined in: [cruncher/buffs.ts:320](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L320)

It is the attacking unit's player's turn. Drives `player-turn-is`, read for the side whose
ability it is: "your turn" for a defensive ability is the opponent of the attacker.

***

### attackerStrength?

> `optional` **attackerStrength?**: `UnitStrength`

Defined in: [cruncher/buffs.ts:322](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L322)

Each unit against its Starting Strength. Drives `strength`; undefined leaves it "unknown".

***

### targetStrength?

> `optional` **targetStrength?**: `UnitStrength`

Defined in: [cruncher/buffs.ts:323](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L323)

***

### attackerWounds?

> `optional` **attackerWounds?**: `ModelWounds`

Defined in: [cruncher/buffs.ts:325](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L325)

The wounds of each unit's damaged (or only) model. Drives `wounds`; undefined leaves it "unknown".

***

### targetWounds?

> `optional` **targetWounds?**: `ModelWounds`

Defined in: [cruncher/buffs.ts:326](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L326)

***

### attackerDesignations?

> `optional` **attackerDesignations?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:332](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L332)

Every designation each unit carries (Spotted, Afflicted, a Stratagem's chosen target,
`warlord`), matched case-insensitively. A supplied list is complete; undefined leaves
`designated` filters "unknown".

***

### targetDesignations?

> `optional` **targetDesignations?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:333](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L333)

***

### attackerStates?

> `optional` **attackerStates?**: readonly `UnitState`[]

Defined in: [cruncher/buffs.ts:339](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L339)

Every state each unit is in, of `engaged`, `battle-shocked` and `hidden`. A supplied list is
complete; undefined leaves those `state` filters "unknown". Both units of an attack are on the
battlefield and not in Strategic Reserves.

***

### targetStates?

> `optional` **targetStates?**: readonly `UnitState`[]

Defined in: [cruncher/buffs.ts:340](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L340)

***

### targetClosest?

> `optional` **targetClosest?**: `boolean`

Defined in: [cruncher/buffs.ts:342](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L342)

The target is the closest eligible target to the attacker. Drives `closest`; undefined leaves it "unknown".

***

### attackerObjectives?

> `optional` **attackerObjectives?**: readonly `ScenarioObjective`[]

Defined in: [cruncher/buffs.ts:347](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L347)

Every objective each unit is within control range of. A supplied list is complete; undefined
leaves objective `within` filters "unknown".

***

### targetObjectives?

> `optional` **targetObjectives?**: readonly `ScenarioObjective`[]

Defined in: [cruncher/buffs.ts:348](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L348)

***

### attackerNeighbours?

> `optional` **attackerNeighbours?**: readonly `ScenarioNeighbour`[]

Defined in: [cruncher/buffs.ts:353](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L353)

The other units near each unit of the attack. A supplied list is complete: a unit it omits is
beyond every range a filter names. Undefined leaves proximity filters on other units "unknown".

***

### targetNeighbours?

> `optional` **targetNeighbours?**: readonly `ScenarioNeighbour`[]

Defined in: [cruncher/buffs.ts:354](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L354)

***

### activeRules?

> `optional` **activeRules?**: readonly `ActiveRule`[]

Defined in: [cruncher/buffs.ts:360](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L360)

Every rule active for the attack: a rule id, or one option or named definition of it. A
supplied list is complete; undefined leaves `rule-active` "unknown", except that a gate on a
stance option becomes a lever requiring that option.

***

### attackerRegions?

> `optional` **attackerRegions?**: readonly `ScenarioRegion`[]

Defined in: [cruncher/buffs.ts:362](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L362)

Every region each unit is in. A supplied list is complete; undefined leaves `in-region` "unknown".

***

### targetRegions?

> `optional` **targetRegions?**: readonly `ScenarioRegion`[]

Defined in: [cruncher/buffs.ts:363](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L363)

***

### objectivesControlled?

> `optional` **objectivesControlled?**: `object`

Defined in: [cruncher/buffs.ts:365](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L365)

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

Defined in: [cruncher/buffs.ts:370](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L370)

Every objective on the battlefield. A supplied list is complete. Drives `controls` with an
objective filter and `designated` on objectives; undefined leaves them "unknown".

***

### attackerDesignationsApplied?

> `optional` **attackerDesignationsApplied?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:376](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L376)

How many units carry each designation the attacking (or target) unit applied. A supplied record
is complete: a designation it omits is on no unit. Drives a `designated` count `by` that unit;
undefined leaves it "unknown".

***

### targetDesignationsApplied?

> `optional` **targetDesignationsApplied?**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [cruncher/buffs.ts:377](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L377)

***

### attackerMoves?

> `optional` **attackerMoves?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:383](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L383)

Every move each unit made this turn (`normal`, `advance`, `fall-back`, `charge`,
`remain-stationary`, `ingress`). A supplied list is complete; undefined leaves `happened`
move conditions "unknown", apart from the stationary and charge flags above.

***

### targetMoves?

> `optional` **targetMoves?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:384](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L384)

***

### testResults?

> `optional` **testResults?**: `Readonly`\<`Record`\<`string`, `"success"` \| `"failure"`\>\>

Defined in: [cruncher/buffs.ts:389](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L389)

The result of the test an ability made, by roll (`leadership`, `battle-shock`, `charge`).
Drives `roll-result` for those rolls; a roll it omits stays "unknown".

***

### attackerSelected?

> `optional` **attackerSelected?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:395](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L395)

Every activity each unit has been selected for this phase (`fight`, `shoot`, `move`,
`observe`). A supplied list is complete; undefined leaves `happened` selection conditions
"unknown".

***

### targetSelected?

> `optional` **targetSelected?**: readonly `string`[]

Defined in: [cruncher/buffs.ts:396](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L396)

***

### attackerKills?

> `optional` **attackerKills?**: `object`

Defined in: [cruncher/buffs.ts:398](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L398)

Enemy models and units each unit destroyed this phase. Undefined leaves `happened` kill conditions "unknown".

#### models

> **models**: `number`

#### units

> **units**: `number`

***

### targetKills?

> `optional` **targetKills?**: `object`

Defined in: [cruncher/buffs.ts:399](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L399)

#### models

> **models**: `number`

#### units

> **units**: `number`

***

### attackerLosses?

> `optional` **attackerLosses?**: `number`

Defined in: [cruncher/buffs.ts:401](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L401)

Models each unit lost this phase. Undefined leaves `happened` loss conditions "unknown".

***

### targetLosses?

> `optional` **targetLosses?**: `number`

Defined in: [cruncher/buffs.ts:402](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L402)

***

### attackerRolls?

> `optional` **attackerRolls?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:408](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L408)

Every roll each unit made this phase, and every roll made against it, with its result. A
supplied list is complete; undefined leaves `happened` roll conditions "unknown". A critical
result is also a success.

***

### targetRolls?

> `optional` **targetRolls?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:409](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L409)

***

### attackerRolledAgainst?

> `optional` **attackerRolledAgainst?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:410](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L410)

***

### targetRolledAgainst?

> `optional` **targetRolledAgainst?**: readonly `ScenarioRoll`[]

Defined in: [cruncher/buffs.ts:411](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L411)

***

### attackerMembers?

> `optional` **attackerMembers?**: readonly `AttachedMember`[]

Defined in: [cruncher/buffs.ts:416](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L416)

Every unit of each combined unit, the unit itself included. Settles `attachment` roles and
`with` filters; undefined leaves those to the attachment flags above.

***

### targetMembers?

> `optional` **targetMembers?**: readonly `AttachedMember`[]

Defined in: [cruncher/buffs.ts:417](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L417)

***

### recipientSnapshots?

> `optional` **recipientSnapshots?**: readonly [`RecipientSnapshot`](../interfaces/RecipientSnapshot.md)[]

Defined in: [cruncher/buffs.ts:429](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L429)

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

Defined in: [cruncher/buffs.ts:431](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L431)

The attack's modified Strength. The engine supplies it; undefined fails `attackComparisons`.

***

### targetToughness?

> `optional` **targetToughness?**: `number`

Defined in: [cruncher/buffs.ts:436](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L436)

The target's modified Toughness: the attacked profile's, and the highest and lowest over the
target's profiles for a `reduce` comparison. The engine supplies them.

***

### targetToughnessMax?

> `optional` **targetToughnessMax?**: `number`

Defined in: [cruncher/buffs.ts:437](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L437)

***

### targetToughnessMin?

> `optional` **targetToughnessMin?**: `number`

Defined in: [cruncher/buffs.ts:438](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L438)

***

### attackerToughness?

> `optional` **attackerToughness?**: `number`

Defined in: [cruncher/buffs.ts:440](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L440)

The attacking unit's Toughness (its highest model's). Caller-supplied; undefined fails comparisons that read it.

***

### criticalRoll?

> `optional` **criticalRoll?**: `"wound"`

Defined in: [cruncher/buffs.ts:445](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L445)

The roll that was a critical one, for the buffs that apply only then. The engine sets it when
resolving the attacks that score a critical wound; callers leave it unset.

***

### conditionFacts?

> `optional` **conditionFacts?**: `Readonly`\<`Record`\<`string`, `boolean`\>\>

Defined in: [cruncher/buffs.ts:452](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L452)

Declared answers for leaf conditions the rest of the context leaves undecided, keyed by
[conditionFactKey](../functions/conditionFactKey.md). The translator reports each undecided leaf as a need
([UnsupportedFragment.needs](UnsupportedFragment.md#needs)); a caller that answers it here decides the leaf. A key
that is absent leaves the leaf undecided.
