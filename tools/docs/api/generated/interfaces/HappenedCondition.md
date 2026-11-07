[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCondition

# Interface: HappenedCondition

Defined in: [generated.ts:2212](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2212)

[history] An event happened within `window`: the subject did it, to the object, matching the filter, within the optional inclusive `count` bounds (default 1).

## Properties

### type

> **type**: `"happened"`

Defined in: [generated.ts:2213](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2213)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2214](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2214)

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
