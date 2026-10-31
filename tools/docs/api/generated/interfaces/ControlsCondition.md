[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ControlsCondition

# Interface: ControlsCondition

Defined in: [generated.ts:2490](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2490)

[board] A player controls objectives matching the filter. `count` supplies inclusive bounds; `compare` compares the controlling player's count with the named owner's count over the same objective filter; `proportion` compares controlled matching markers with a fraction of all matching markers.

## Properties

### type

> **type**: `"controls"`

Defined in: [generated.ts:2491](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2491)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2492](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2492)

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
