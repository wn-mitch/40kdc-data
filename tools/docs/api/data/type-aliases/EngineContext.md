[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EngineContext

# Type Alias: EngineContext

> **EngineContext** = `object`

Defined in: [cruncher/buffs.ts:117](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L117)

Shared engine context. Carries the phase plus a few attacker/target flags
the keyword translator and the resolver both need. The engine fills it from
its `EngineInput.context` plus the unit-keyword unions; the resolver reads
only the subset relevant to its `applicableWhen` checks.

## Properties

### phase

> **phase**: [`Phase`](../../generated/type-aliases/Phase.md)

Defined in: [cruncher/buffs.ts:118](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L118)

***

### attackerStationary?

> `optional` **attackerStationary?**: `boolean`

Defined in: [cruncher/buffs.ts:120](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L120)

Attacker has not moved this turn — Heavy fires its +1 to hit.

***

### attackerCharged?

> `optional` **attackerCharged?**: `boolean`

Defined in: [cruncher/buffs.ts:127](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L127)

Attacker made a charge move this turn — drives the `charged-this-turn`
condition (e.g. World Eaters' Relentless Rage). Left undefined when the
caller can't determine it — the condition then evaluates as `"unknown"` and
the SPA surfaces a diagnostic (mirrors `attackerStationary` / `timing`).

***

### withinHalfRange?

> `optional` **withinHalfRange?**: `boolean`

Defined in: [cruncher/buffs.ts:129](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L129)

Within half the weapon's range — Melta / Rapid Fire fire.

***

### attackerInCover?

> `optional` **attackerInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:131](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L131)

Attacker benefits from cover (mostly informational; cover applies to defenders).

***

### targetInCover?

> `optional` **targetInCover?**: `boolean`

Defined in: [cruncher/buffs.ts:133](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L133)

Target is in cover — the resolver flips on `cover`, the engine applies +1 to save.

***

### attackerKeywords?

> `optional` **attackerKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:135](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L135)

Attacker keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### targetKeywords?

> `optional` **targetKeywords?**: `ReadonlyArray`\<`string`\>

Defined in: [cruncher/buffs.ts:137](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L137)

Target keywords (union of unit.keywords + faction_keywords), lower-cased.

***

### timing?

> `optional` **timing?**: `string`

Defined in: [cruncher/buffs.ts:144](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L144)

Sub-phase timing flag (e.g. `"start-of-phase"`, `"end-of-phase"`,
`"on-destroyed"`). Consumed by the `timing-is` condition. Left undefined
when the caller can't pin a sub-phase down — the condition then evaluates
as `"unknown"` and the SPA surfaces a diagnostic.

***

### attackerAttached?

> `optional` **attackerAttached?**: `boolean`

Defined in: [cruncher/buffs.ts:153](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L153)

The buffed unit is part of a combined ("attached") unit — a leader is
attached to a bodyguard, or vice-versa. Drives the `is-attached` and
`model-is-leader` conditions. Derived from a non-empty
`EligibilityInput.attachedUnitIds`. Left undefined when the caller can't
determine attachment — the conditions then evaluate as `"unknown"` and the
SPA surfaces a diagnostic (mirrors how `timing` undefined behaves).
