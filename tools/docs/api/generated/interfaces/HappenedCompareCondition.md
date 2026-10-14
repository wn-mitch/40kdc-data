[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCompareCondition

# Interface: HappenedCompareCondition

Defined in: [generated.ts:1975](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1975)

[history] Compares how many times two events happened (mission cards).

## Properties

### type

> **type**: `"happened-compare"`

Defined in: [generated.ts:1976](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1976)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1977](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1977)

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

> **comparison**: `"greater-than"` \| `"greater-or-equal"`

#### right

> **right**: \{ `event`: [`GameEvent`](../type-aliases/GameEvent.md); `subject?`: [`UnitRef`](../type-aliases/UnitRef.md); `object?`: [`EventTarget`](../type-aliases/EventTarget.md); `filter?`: [`EventFilter`](EventFilter.md); `window`: [`HistoryWindow`](../type-aliases/HistoryWindow.md); \} \| \{ `value`: `number`; \} \| \{ `pool`: `string`; \}
