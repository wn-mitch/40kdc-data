[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / StackableBuff

# Type Alias: StackableBuff

> **StackableBuff** = `object`

Defined in: [data/dataset-buffs.ts:52](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L52)

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

Defined in: [data/dataset-buffs.ts:54](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L54)

Stable toggle id (stable across re-enumeration of the same input).

***

### label

> **label**: `string`

Defined in: [data/dataset-buffs.ts:56](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L56)

Human label for the lever.

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [data/dataset-buffs.ts:58](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L58)

Contributions this lever adds when enabled (≥1).

***

### enabled

> **enabled**: `boolean`

Defined in: [data/dataset-buffs.ts:60](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L60)

Default selection state.

***

### source

> **source**: [`BuffSource`](BuffSource.md)

Defined in: [data/dataset-buffs.ts:62](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L62)

Where the lever came from.

***

### group?

> `optional` **group?**: `string`

Defined in: [data/dataset-buffs.ts:64](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L64)

Id of the mutually-limited [StackableBuffGroup](StackableBuffGroup.md) this belongs to, if any.

***

### groups?

> `optional` **groups?**: `string`[]

Defined in: [data/dataset-buffs.ts:66](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L66)

Additional enclosing pools; every listed cap applies alongside `group`.

***

### cost?

> `optional` **cost?**: `LeverCost`

Defined in: [data/dataset-buffs.ts:68](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L68)

What turning the lever on costs: CP for a Stratagem, points for an Enhancement.

***

### requires?

> `optional` **requires?**: `unknown`[]

Defined in: [data/dataset-buffs.ts:73](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L73)

DSL fragments the player vouches for when turning the lever on (a unit selection's range and
eligibility, a gating roll, the model count a capped bonus needs), in the order they apply.

***

### requiresLever?

> `optional` **requiresLever?**: `string`

Defined in: [data/dataset-buffs.ts:75](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L75)

Id of the lever this one needs on (the Stratagem or Enhancement that provides it).

***

### requiresOption?

> `optional` **requiresOption?**: `string`

Defined in: [data/dataset-buffs.ts:77](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L77)

Id of the stance option lever this one needs on (a rule that applies only under that option).

***

### excludesOption?

> `optional` **excludesOption?**: `string`

Defined in: [data/dataset-buffs.ts:79](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L79)

Id of the stance option lever this one needs off (a rule that does not apply under that option).

***

### raisesCap?

> `optional` **raisesCap?**: `Omit`\<`CapacityRaise`, `"ability"`\> & `object`

Defined in: [data/dataset-buffs.ts:81](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-buffs.ts#L81)

Turning the lever on raises the cap of the pool `group` by `by` instead of adding buffs.

#### Type Declaration

##### group

> **group**: `string`
