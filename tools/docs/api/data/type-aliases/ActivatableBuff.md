[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ActivatableBuff

# Type Alias: ActivatableBuff

> **ActivatableBuff** = `object`

Defined in: [cruncher/from-dsl.ts:60](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/from-dsl.ts#L60)

A buff-bearing *player decision* the cruncher can't make on its own: a
dice-pool option, a `choice` branch, or an activation gated on a timing the
player controls (e.g. "start of phase"). It is not auto-applied — the
consumer opts in (a checkbox, or an optimizer's search) and then folds
[buffs](#buffs) into the crunch. Conditions the activation still carries (a
target keyword, a phase) ride on each buff's `applicableWhen`, so the
resolver gates them per-target rather than the lever vanishing.

## Properties

### id

> **id**: `string`

Defined in: [cruncher/from-dsl.ts:62](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/from-dsl.ts#L62)

Stable toggle id, e.g. `"blessings-of-khorne#Warp Blades"`.

***

### label

> **label**: `string`

Defined in: [cruncher/from-dsl.ts:64](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/from-dsl.ts#L64)

Human label for the lever (option name, or a summary of its buffs).

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [cruncher/from-dsl.ts:66](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/from-dsl.ts#L66)

Contributions this activation adds when the player opts in (≥1).

***

### group?

> `optional` **group?**: [`ActivatableGroupRef`](ActivatableGroupRef.md)

Defined in: [cruncher/from-dsl.ts:68](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/from-dsl.ts#L68)

Set when the lever belongs to a mutually-limited pool.
