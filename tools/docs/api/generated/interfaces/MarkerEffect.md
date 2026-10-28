[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MarkerEffect

# Interface: MarkerEffect

Defined in: [generated.ts:5584](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5584)

[placement] Place or relocate a marker.

## Properties

### type

> **type**: `"marker"`

Defined in: [generated.ts:5585](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5585)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5586](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5586)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5587](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5587)

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

Defined in: [generated.ts:5598](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5598)
