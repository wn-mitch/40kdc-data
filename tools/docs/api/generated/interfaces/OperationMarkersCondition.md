[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / OperationMarkersCondition

# Interface: OperationMarkersCondition

Defined in: [generated.ts:2502](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2502)

[board] Mission: operation markers on the battlefield.

## Properties

### type

> **type**: `"operation-markers"`

Defined in: [generated.ts:2503](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2503)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2504](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2504)

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
