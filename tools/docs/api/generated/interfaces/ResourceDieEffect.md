[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceDieEffect

# Interface: ResourceDieEffect

Defined in: [generated.ts:5105](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5105)

[resource] Add a die to a pool, or substitute a pooled die for a roll.

## Properties

### type

> **type**: `"resource-die"`

Defined in: [generated.ts:5106](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5106)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5107](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5107)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5108](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5108)

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

Defined in: [generated.ts:5120](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5120)
