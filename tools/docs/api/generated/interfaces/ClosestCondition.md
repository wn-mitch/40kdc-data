[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ClosestCondition

# Interface: ClosestCondition

Defined in: [generated.ts:2367](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2367)

[position] The subject is the closest of `among` to `to` (default the attacker), within `range` if given.

## Properties

### type

> **type**: `"closest"`

Defined in: [generated.ts:2368](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2368)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2369](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2369)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### among

> **among**: [`UnitFilter`](UnitFilter.md) \| `"eligible-targets"`

#### to?

> `optional` **to?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)
