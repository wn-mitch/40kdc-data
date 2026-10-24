[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ControlsCondition

# Interface: ControlsCondition

Defined in: [generated.ts:2071](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2071)

[board] A player controls objectives matching the filter. `count` supplies inclusive bounds; `compare` compares the controlling player's count with the named owner's count over the same objective filter; `proportion` compares controlled matching markers with a fraction of all matching markers.

## Properties

### type

> **type**: `"controls"`

Defined in: [generated.ts:2072](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2072)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2073](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2073)

#### by?

> `optional` **by?**: `"friendly"` \| `"enemy"`

#### objective?

> `optional` **objective?**: [`ObjectiveFilter`](ObjectiveFilter.md)

#### count?

> `optional` **count?**: [`CountBounds`](CountBounds.md)

#### compare?

> `optional` **compare?**: `object`

##### compare.owner

> **owner**: `"friendly"` \| `"enemy"`

##### compare.comparison

> **comparison**: [`Comparison`](../type-aliases/Comparison.md)

#### proportion?

> `optional` **proportion?**: `object`

##### proportion.comparison

> **comparison**: [`Comparison`](../type-aliases/Comparison.md)

##### proportion.fraction

> **fraction**: `number`
