[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCondition

# Interface: HappenedCondition

Defined in: [generated.ts:2112](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2112)

[history] An event happened within `window`: the subject did it, to the object, matching the filter, within the optional inclusive `count` bounds (default 1).

## Properties

### type

> **type**: `"happened"`

Defined in: [generated.ts:2113](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2113)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2114](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2114)

#### event

> **event**: [`GameEvent`](../type-aliases/GameEvent.md)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### object?

> `optional` **object?**: [`EventTarget`](../type-aliases/EventTarget.md)

#### filter?

> `optional` **filter?**: [`EventFilter`](EventFilter.md)

#### window

> **window**: [`HistoryWindow`](../type-aliases/HistoryWindow.md)

#### count?

> `optional` **count?**: [`CountBounds`](CountBounds.md)

#### proximity?

> `optional` **proximity?**: `object`

##### proximity.of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

##### proximity.range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)
