[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / StackableBuff

# Type Alias: StackableBuff

> **StackableBuff** = `object`

Defined in: [data/dataset-buffs.ts:49](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L49)

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

Defined in: [data/dataset-buffs.ts:51](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L51)

Stable toggle id (stable across re-enumeration of the same input).

***

### label

> **label**: `string`

Defined in: [data/dataset-buffs.ts:53](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L53)

Human label for the lever.

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [data/dataset-buffs.ts:55](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L55)

Contributions this lever adds when enabled (≥1).

***

### enabled

> **enabled**: `boolean`

Defined in: [data/dataset-buffs.ts:57](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L57)

Default selection state.

***

### source

> **source**: [`BuffSource`](BuffSource.md)

Defined in: [data/dataset-buffs.ts:59](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L59)

Where the lever came from.

***

### group?

> `optional` **group?**: `string`

Defined in: [data/dataset-buffs.ts:61](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L61)

Id of the mutually-limited [StackableBuffGroup](StackableBuffGroup.md) this belongs to, if any.

***

### groups?

> `optional` **groups?**: `string`[]

Defined in: [data/dataset-buffs.ts:63](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L63)

Additional enclosing pools; every listed cap applies alongside `group`.

***

### cost?

> `optional` **cost?**: `LeverCost`

Defined in: [data/dataset-buffs.ts:65](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L65)

What turning the lever on costs: CP for a Stratagem, points for an Enhancement.

***

### requires?

> `optional` **requires?**: `unknown`[]

Defined in: [data/dataset-buffs.ts:70](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L70)

DSL fragments the player vouches for when turning the lever on (a unit selection's range and
eligibility, a gating roll, the model count a capped bonus needs), in the order they apply.

***

### requiresLever?

> `optional` **requiresLever?**: `string`

Defined in: [data/dataset-buffs.ts:72](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L72)

Id of the lever this one needs on (the Stratagem or Enhancement that provides it).

***

### requiresOption?

> `optional` **requiresOption?**: `string`

Defined in: [data/dataset-buffs.ts:74](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L74)

Id of the stance option lever this one needs on (a rule that applies only under that option).

***

### excludesOption?

> `optional` **excludesOption?**: `string`

Defined in: [data/dataset-buffs.ts:76](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L76)

Id of the stance option lever this one needs off (a rule that does not apply under that option).

***

### raisesCap?

> `optional` **raisesCap?**: `Omit`\<`CapacityRaise`, `"ability"`\> & `object`

Defined in: [data/dataset-buffs.ts:78](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/dataset-buffs.ts#L78)

Turning the lever on raises the cap of the pool `group` by `by` instead of adding buffs.

#### Type Declaration

##### group

> **group**: `string`
