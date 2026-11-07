[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / OperationMarkersCondition

# Interface: OperationMarkersCondition

Defined in: [generated.ts:2623](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2623)

[board] Mission: operation markers on the battlefield.

## Properties

### type

> **type**: `"operation-markers"`

Defined in: [generated.ts:2624](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2624)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2625](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2625)

#### side?

> `optional` **side?**: `"friendly"` \| `"enemy"` \| `"any"`

A definite player: friendly or enemy (an owner other than any).

#### count?

> `optional` **count?**: [`CountBounds`](CountBounds.md)

#### friendly\_unit\_in\_same\_terrain\_area?

> `optional` **friendly\_unit\_in\_same\_terrain\_area?**: `true`

#### no\_enemy\_in\_terrain\_area?

> `optional` **no\_enemy\_in\_terrain\_area?**: `true`

#### within?

> `optional` **within?**: `object`

##### within.of

> **of**: [`PlaceRef`](../type-aliases/PlaceRef.md)

##### within.range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)
