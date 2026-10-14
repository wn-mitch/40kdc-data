[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ClosestCondition

# Interface: ClosestCondition

Defined in: [generated.ts:2059](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2059)

[position] The subject is the closest of `among` to `to` (default the attacker), within `range` if given.

## Properties

### type

> **type**: `"closest"`

Defined in: [generated.ts:2060](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2060)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2061](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2061)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### among

> **among**: [`UnitFilter`](UnitFilter.md) \| `"eligible-targets"`

#### to?

> `optional` **to?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)
