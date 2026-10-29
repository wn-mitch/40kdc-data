[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCompareCondition

# Interface: HappenedCompareCondition

Defined in: [generated.ts:2311](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2311)

[history] Compares how many times two events happened (mission cards).

## Properties

### type

> **type**: `"happened-compare"`

Defined in: [generated.ts:2312](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2312)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2313](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2313)

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
