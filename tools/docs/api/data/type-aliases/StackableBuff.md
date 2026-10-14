[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / StackableBuff

# Type Alias: StackableBuff

> **StackableBuff** = `object`

Defined in: [data/dataset.ts:67](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L67)

One toggleable buff lever for damage analysis: the contributions it adds and
whether it's on by default. `enabled` is `true` for buffs that always apply
(intrinsic keywords, unconditional abilities) and `false` for player
decisions — stratagems (CP cost) and activatable gates (dice-pool options,
`choice` branches, timing-gated activations). A consumer flips `enabled`,
then crunches the enabled subset; an optimizer searches it.

## See

[Dataset.stackableBuffsFor](../classes/Dataset.md#stackablebuffsfor)

## Properties

### id

> **id**: `string`

Defined in: [data/dataset.ts:69](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L69)

Stable toggle id (stable across re-enumeration of the same input).

***

### label

> **label**: `string`

Defined in: [data/dataset.ts:71](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L71)

Human label for the lever.

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [data/dataset.ts:73](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L73)

Contributions this lever adds when enabled (≥1).

***

### enabled

> **enabled**: `boolean`

Defined in: [data/dataset.ts:75](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L75)

Default selection state.

***

### source

> **source**: [`BuffSource`](BuffSource.md)

Defined in: [data/dataset.ts:77](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L77)

Where the lever came from.

***

### group?

> `optional` **group?**: `string`

Defined in: [data/dataset.ts:79](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L79)

Id of the mutually-limited [StackableBuffGroup](StackableBuffGroup.md) this belongs to, if any.
