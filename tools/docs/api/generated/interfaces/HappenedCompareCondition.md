[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCompareCondition

# Interface: HappenedCompareCondition

Defined in: [generated.ts:2003](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2003)

[history] Compares how many times two events happened (mission cards).

## Properties

### type

> **type**: `"happened-compare"`

Defined in: [generated.ts:2004](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2004)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2005](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2005)

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
