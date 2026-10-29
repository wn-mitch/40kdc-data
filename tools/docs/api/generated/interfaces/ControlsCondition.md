[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ControlsCondition

# Interface: ControlsCondition

Defined in: [generated.ts:2379](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2379)

[board] A player controls objectives matching the filter. `count` supplies inclusive bounds; `compare` compares the controlling player's count with the named owner's count over the same objective filter; `proportion` compares controlled matching markers with a fraction of all matching markers.

## Properties

### type

> **type**: `"controls"`

Defined in: [generated.ts:2380](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2380)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2381](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2381)

#### by?

> `optional` **by?**: `"friendly"` \| `"enemy"` \| `"any"`

A definite player: friendly or enemy (an owner other than any).

#### objective?

> `optional` **objective?**: [`ObjectiveFilter`](ObjectiveFilter.md)

#### count?

> `optional` **count?**: [`CountBounds`](CountBounds.md)

#### compare?

> `optional` **compare?**: `object`

##### compare.owner

> **owner**: `"friendly"` \| `"enemy"` \| `"any"`

A definite player: friendly or enemy (an owner other than any).

##### compare.comparison

> **comparison**: [`Comparison`](../type-aliases/Comparison.md)

#### proportion?

> `optional` **proportion?**: `object`

##### proportion.comparison

> **comparison**: [`Comparison`](../type-aliases/Comparison.md)

##### proportion.fraction

> **fraction**: `number`
