[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ClosestCondition

# Interface: ClosestCondition

Defined in: [generated.ts:2478](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2478)

[position] The subject is the closest of `among` to `to` (default the attacker), within `range` if given.

## Properties

### type

> **type**: `"closest"`

Defined in: [generated.ts:2479](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2479)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2480](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2480)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### among

> **among**: [`UnitFilter`](UnitFilter.md) \| `"eligible-targets"`

#### to?

> `optional` **to?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)
