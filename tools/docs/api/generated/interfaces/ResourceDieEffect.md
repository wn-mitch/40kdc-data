[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceDieEffect

# Interface: ResourceDieEffect

Defined in: [generated.ts:5730](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5730)

[resource] Add a die to a pool, or substitute a pooled die for a roll.

## Properties

### type

> **type**: `"resource-die"`

Defined in: [generated.ts:5731](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5731)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5732](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5732)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5733](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5733)

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

Defined in: [generated.ts:5745](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5745)
