[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / StackableBuff

# Type Alias: StackableBuff

> **StackableBuff** = `object`

Defined in: [data/dataset.ts:79](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L79)

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

Defined in: [data/dataset.ts:81](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L81)

Stable toggle id (stable across re-enumeration of the same input).

***

### label

> **label**: `string`

Defined in: [data/dataset.ts:83](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L83)

Human label for the lever.

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [data/dataset.ts:85](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L85)

Contributions this lever adds when enabled (≥1).

***

### enabled

> **enabled**: `boolean`

Defined in: [data/dataset.ts:87](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L87)

Default selection state.

***

### source

> **source**: [`BuffSource`](BuffSource.md)

Defined in: [data/dataset.ts:89](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L89)

Where the lever came from.

***

### group?

> `optional` **group?**: `string`

Defined in: [data/dataset.ts:91](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L91)

Id of the mutually-limited [StackableBuffGroup](StackableBuffGroup.md) this belongs to, if any.

***

### groups?

> `optional` **groups?**: `string`[]

Defined in: [data/dataset.ts:93](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L93)

Additional enclosing pools; every listed cap applies alongside `group`.

***

### cost?

> `optional` **cost?**: `LeverCost`

Defined in: [data/dataset.ts:95](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L95)

What turning the lever on costs: CP for a Stratagem, points for an Enhancement.

***

### requires?

> `optional` **requires?**: `unknown`[]

Defined in: [data/dataset.ts:100](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L100)

DSL fragments the player vouches for when turning the lever on (a unit selection's range and
eligibility, a gating roll, the model count a capped bonus needs), in the order they apply.

***

### requiresLever?

> `optional` **requiresLever?**: `string`

Defined in: [data/dataset.ts:102](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L102)

Id of the lever this one needs on (the Stratagem or Enhancement that provides it).

***

### raisesCap?

> `optional` **raisesCap?**: `Omit`\<`CapacityRaise`, `"ability"`\> & `object`

Defined in: [data/dataset.ts:104](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L104)

Turning the lever on raises the cap of the pool `group` by `by` instead of adding buffs.

#### Type Declaration

##### group

> **group**: `string`
