[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCompareCondition

# Interface: HappenedCompareCondition

Defined in: [generated.ts:2422](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2422)

[history] Compares how many times two events happened (mission cards).

## Properties

### type

> **type**: `"happened-compare"`

Defined in: [generated.ts:2423](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2423)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2424](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2424)

#### left

> **left**: `object`

##### left.event

> **event**: [`GameEvent`](../type-aliases/GameEvent.md)

##### left.subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

##### left.object?

> `optional` **object?**: [`EventTarget`](../type-aliases/EventTarget.md)

##### left.filter?

> `optional` **filter?**: [`EventFilter`](EventFilter.md)

##### left.window

> **window**: [`HistoryWindow`](../type-aliases/HistoryWindow.md)

#### comparison

> **comparison**: [`Comparison`](../type-aliases/Comparison.md)

#### right

> **right**: \{ `event`: [`GameEvent`](../type-aliases/GameEvent.md); `subject?`: [`UnitRef`](../type-aliases/UnitRef.md); `object?`: [`EventTarget`](../type-aliases/EventTarget.md); `filter?`: [`EventFilter`](EventFilter.md); `window`: [`HistoryWindow`](../type-aliases/HistoryWindow.md); \} \| \{ `value`: `number`; \} \| \{ `pool`: `string`; \}
