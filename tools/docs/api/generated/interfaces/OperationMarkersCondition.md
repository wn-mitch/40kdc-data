[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / OperationMarkersCondition

# Interface: OperationMarkersCondition

Defined in: [generated.ts:2185](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2185)

[board] Mission: operation markers on the battlefield.

## Properties

### type

> **type**: `"operation-markers"`

Defined in: [generated.ts:2186](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2186)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2187](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2187)

#### side?

> `optional` **side?**: `"friendly"` \| `"enemy"`

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
