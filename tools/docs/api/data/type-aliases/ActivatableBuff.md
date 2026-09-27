[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ActivatableBuff

# Type Alias: ActivatableBuff

> **ActivatableBuff** = `object`

Defined in: [cruncher/from-dsl.ts:67](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L67)

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

Defined in: [cruncher/from-dsl.ts:69](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L69)

Stable toggle id, e.g. `"blessings-of-khorne#Warp Blades"`.

***

### label

> **label**: `string`

Defined in: [cruncher/from-dsl.ts:71](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L71)

Human label for the lever (option name, or a summary of its buffs).

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [cruncher/from-dsl.ts:73](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L73)

Contributions this activation adds when the player opts in (≥1).

***

### group?

> `optional` **group?**: [`ActivatableGroupRef`](ActivatableGroupRef.md)

Defined in: [cruncher/from-dsl.ts:75](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L75)

Set when the lever belongs to a mutually-limited pool.
