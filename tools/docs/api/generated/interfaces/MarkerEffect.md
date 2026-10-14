[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MarkerEffect

# Interface: MarkerEffect

Defined in: [generated.ts:4959](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4959)

[placement] Place or relocate a marker.

## Properties

### type

> **type**: `"marker"`

Defined in: [generated.ts:4960](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4960)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4961](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4961)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4962](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4962)

#### label

> **label**: `string`

#### operation?

> `optional` **operation?**: `"place"` \| `"relocate"`

#### placement?

> `optional` **placement?**: `string`

#### distance?

> `optional` **distance?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### consume?

> `optional` **consume?**: `"on-use"` \| `"never"`

#### not\_moved\_this\_turn?

> `optional` **not\_moved\_this\_turn?**: `true`

Relocate: only a marker that has not been moved this turn.

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4973](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4973)
