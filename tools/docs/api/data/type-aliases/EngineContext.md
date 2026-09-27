[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EngineContext

# Type Alias: EngineContext

> **EngineContext** = `object`

Defined in: [cruncher/buffs.ts:124](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L124)

Shared engine context. Carries the phase plus a few attacker/target flags
the keyword translator and the resolver both need. The engine fills it from
its `EngineInput.context` plus the unit-keyword unions; the resolver reads
only the subset relevant to its `applicableWhen` checks.

## Properties

### phase

> **phase**: [`Phase`](../../generated/type-aliases/Phase.md)

Defined in: [cruncher/buffs.ts:125](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L125)

***

### attackerStationary?

> `optional` **attackerStationary?**: `boolean`

Defined in: [cruncher/buffs.ts:127](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L127)

Attacker has not moved this turn — Heavy fires its +1 to hit.

***

### attackerCharged?

> `optional` **attackerCharged?**: `boolean`

Defined in: [cruncher/buffs.ts:134](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L134)

Attacker made a charge move this turn — drives the `charged-this-turn`
condition (e.g. World Eaters' Relentless Rage). Left undefined when the
caller can't determine it — the condition then evaluates as `"unknown"` and
the SPA surfaces a diagnostic (mirrors `attackerStationary` / `timing`).

***

### withinHalfRange?

> `optional` **withinHalfRange?**: `boolean`

Defined in: [cruncher/buffs.ts:136](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L136)

Within half the weapon's range — Melta / Rapid Fire fire.

***

### distanceInches?

> `optional` **distanceInches?**: `number`

Defined in: [cruncher/buffs.ts:142](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L142)

Distance to the target in inches. Drives `applicableWhen.maxRangeInches`
for range-gated abilities. Undefined when the caller doesn't track distance
— range gates then evaluate permissively (the buff applies).

***

### attackerInCover?

> `optional` **attackerInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:144](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L144)

Attacker benefits from cover (mostly informational; cover applies to defenders).

***

### targetInCover?

> `optional` **targetInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:146](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L146)

Target is in cover — the resolver flips on `cover`, the engine applies +1 to save.

***

### attackerKeywords?

> `optional` **attackerKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:148](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L148)

Attacker keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### targetKeywords?

> `optional` **targetKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:150](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L150)

Target keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### timing?

> `optional` **timing?**: `string`

Defined in: [cruncher/buffs.ts:157](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L157)

Sub-phase timing flag (e.g. `"start-of-phase"`, `"end-of-phase"`,
`"on-destroyed"`). Consumed by the `timing-is` condition. Left undefined
when the caller can't pin a sub-phase down — the condition then evaluates
as `"unknown"` and the SPA surfaces a diagnostic.

***

### attackerAttached?

> `optional` **attackerAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:166](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L166)

The buffed unit is part of a combined ("attached") unit — a leader is
attached to a bodyguard, or vice-versa. Drives the `is-attached` and
`model-is-leader` conditions. Derived from a non-empty
`EligibilityInput.attachedUnitIds`. Left undefined when the caller can't
determine attachment — the conditions then evaluate as `"unknown"` and the
SPA surfaces a diagnostic (mirrors how `timing` undefined behaves).
