[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EngineContext

# Type Alias: EngineContext

> **EngineContext** = `object`

Defined in: [cruncher/buffs.ts:151](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L151)

Shared engine context. Carries the phase plus a few attacker/target flags
the keyword translator and the resolver both need. The engine fills it from
its `EngineInput.context` plus the unit-keyword unions; the resolver reads
only the subset relevant to its `applicableWhen` checks.

## Properties

### phase

> **phase**: [`Phase`](../../generated/type-aliases/Phase.md)

Defined in: [cruncher/buffs.ts:152](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L152)

***

### attackerStationary?

> `optional` **attackerStationary?**: `boolean`

Defined in: [cruncher/buffs.ts:154](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L154)

Attacker has not moved this turn — Heavy fires its +1 to hit.

***

### attackerCharged?

> `optional` **attackerCharged?**: `boolean`

Defined in: [cruncher/buffs.ts:161](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L161)

Attacker made a charge move this turn — drives the `charged-this-turn`
condition (e.g. World Eaters' Relentless Rage). Left undefined when the
caller can't determine it — the condition then evaluates as `"unknown"` and
the SPA surfaces a diagnostic (mirrors `attackerStationary` / `timing`).

***

### withinHalfRange?

> `optional` **withinHalfRange?**: `boolean`

Defined in: [cruncher/buffs.ts:163](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L163)

Within half the weapon's range — Melta / Rapid Fire fire.

***

### distanceInches?

> `optional` **distanceInches?**: `number`

Defined in: [cruncher/buffs.ts:169](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L169)

Distance to the target in inches. Drives `applicableWhen.maxRangeInches`
for range-gated abilities. When absent, explicit maximum-range gates do
not match; buffs without such a gate are unaffected.

***

### attackerInCover?

> `optional` **attackerInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:171](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L171)

Attacker benefits from cover (mostly informational; cover applies to defenders).

***

### targetInCover?

> `optional` **targetInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:173](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L173)

Target is in cover — the resolver flips on `cover`, the engine applies +1 to save.

***

### attackerKeywords?

> `optional` **attackerKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:175](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L175)

Attacker keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### targetKeywords?

> `optional` **targetKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:177](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L177)

Target keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### timing?

> `optional` **timing?**: `string`

Defined in: [cruncher/buffs.ts:184](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L184)

Sub-phase timing flag (e.g. `"start-of-phase"`, `"end-of-phase"`,
`"on-destroyed"`). Consumed by the `timing-is` condition. Left undefined
when the caller can't pin a sub-phase down — the condition then evaluates
as `"unknown"` and the SPA surfaces a diagnostic.

***

### attackerAttached?

> `optional` **attackerAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:186](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L186)

Whether the attacking and defending unit are attached; this alone never establishes a role.

***

### targetAttached?

> `optional` **targetAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:187](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L187)

***

### armyFaction?

> `optional` **armyFaction?**: `string`

Defined in: [cruncher/buffs.ts:189](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L189)

The army's Army Faction id. Drives the `army-faction` condition; undefined leaves it "unknown".

***

### battleSize?

> `optional` **battleSize?**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [cruncher/buffs.ts:191](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L191)

The battle size being played. Drives the `battle-size` condition; undefined leaves it "unknown".

***

### attackerGuided?

> `optional` **attackerGuided?**: `boolean`

Defined in: [cruncher/buffs.ts:196](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L196)

The attacking unit is Guided (For the Greater Good: not an Observer, targeting a Spotted unit).
Drives the `guided` condition; undefined leaves it "unknown".

***

### weaponNames?

> `optional` **weaponNames?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:201](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L201)

Lower-cased names of the attacking weapon and its profile. Drives
`applicableWhen.weaponName`; missing names cannot satisfy a weapon-name gate.

***

### weaponKeywords?

> `optional` **weaponKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:206](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L206)

Catalog IDs printed on the attacking weapon profile, sufficient for rating-agnostic
selectors. The engine also supplies parameter-bearing refs for rated selectors.

***

### weaponKeywordRefs?

> `optional` **weaponKeywordRefs?**: readonly [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:208](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L208)

Parameter-bearing printed keywords, needed for rated weapon selectors.

***

### attackerAttachmentRole?

> `optional` **attackerAttachmentRole?**: `"leader"` \| `"bodyguard"`

Defined in: [cruncher/buffs.ts:209](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L209)

***

### targetAttachmentRole?

> `optional` **targetAttachmentRole?**: `"leader"` \| `"bodyguard"`

Defined in: [cruncher/buffs.ts:210](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L210)

***

### attachmentRoles?

> `optional` **attachmentRoles?**: `Readonly`\<`Record`\<`string`, `"leader"` \| `"bodyguard"`\>\>

Defined in: [cruncher/buffs.ts:212](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L212)

Actual per-member roles, used when a condition refers to the ability's source model.

***

### attackerUnitId?

> `optional` **attackerUnitId?**: `string`

Defined in: [cruncher/buffs.ts:213](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L213)

***

### targetUnitId?

> `optional` **targetUnitId?**: `string`

Defined in: [cruncher/buffs.ts:214](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L214)

***

### battleRound?

> `optional` **battleRound?**: `number`

Defined in: [cruncher/buffs.ts:215](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L215)

***

### recipientSnapshots?

> `optional` **recipientSnapshots?**: readonly [`RecipientSnapshot`](../interfaces/RecipientSnapshot.md)[]

Defined in: [cruncher/buffs.ts:227](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L227)

Caller-attested trigger-time recipient evidence, not current membership.
Each entry preserves the ability source/sourceUnitId, exact canonical
trigger and selector, selectionPath JSON pointer, perspective,
recipientUnitId, and selected result. Object-key order is immaterial;
array order and every supplied field matter. Callers provide live
event-time evidence and assert activation/equipment; no internal history
or clock is consulted. Missing, mismatched, or conflicting evidence is
unsupported; selected:false resolves to no effect. Parent trigger
identity remains distinct from unrelated effect guards.
