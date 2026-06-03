[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / StackableBuff

# Type Alias: StackableBuff

> **StackableBuff** = `object`

Defined in: [data/dataset.ts:59](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L59)

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

Defined in: [data/dataset.ts:61](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L61)

Stable toggle id (stable across re-enumeration of the same input).

***

### label

> **label**: `string`

Defined in: [data/dataset.ts:63](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L63)

Human label for the lever.

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [data/dataset.ts:65](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L65)

Contributions this lever adds when enabled (≥1).

***

### enabled

> **enabled**: `boolean`

Defined in: [data/dataset.ts:67](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L67)

Default selection state.

***

### source

> **source**: [`BuffSource`](BuffSource.md)

Defined in: [data/dataset.ts:69](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L69)

Where the lever came from.

***

### group?

> `optional` **group?**: `string`

Defined in: [data/dataset.ts:71](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/dataset.ts#L71)

Id of the mutually-limited [StackableBuffGroup](StackableBuffGroup.md) this belongs to, if any.
