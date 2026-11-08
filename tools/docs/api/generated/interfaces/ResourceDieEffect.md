[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceDieEffect

# Interface: ResourceDieEffect

Defined in: [generated.ts:6169](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6169)

[resource] Add a die to a pool, or substitute a pooled die for a roll.

## Properties

### type

> **type**: `"resource-die"`

Defined in: [generated.ts:6170](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6170)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6171](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6171)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6172](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6172)

#### pool

> **pool**: `string`

#### operation

> **operation**: `"add"` \| `"substitute"`

#### value?

> `optional` **value?**: `number` \| `"rolled"` \| `"highest"`

#### count?

> `optional` **count?**: [`Quantity`](../type-aliases/Quantity.md)

#### count\_per\_pool?

> `optional` **count\_per\_pool?**: `string`

#### consumes\_pool?

> `optional` **consumes\_pool?**: `true`

#### rolls?

> `optional` **rolls?**: \[[`RollSelector`](../type-aliases/RollSelector.md), `...RollSelector[]`\]

##### Min Items

1

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:6184](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6184)
