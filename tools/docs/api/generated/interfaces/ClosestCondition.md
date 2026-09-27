[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ClosestCondition

# Interface: ClosestCondition

Defined in: [generated.ts:2040](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2040)

[position] The subject is the closest of `among` to `to` (default the attacker), within `range` if given.

## Properties

### type

> **type**: `"closest"`

Defined in: [generated.ts:2041](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2041)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2042](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2042)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### among

> **among**: [`UnitFilter`](UnitFilter.md) \| `"eligible-targets"`

#### to?

> `optional` **to?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)
