[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCondition

# Interface: HappenedCondition

Defined in: [generated.ts:1956](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1956)

[history] An event happened within `window`: the subject did it, to the object, matching the filter, at least count_min times (default 1).

## Properties

### type

> **type**: `"happened"`

Defined in: [generated.ts:1957](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1957)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1958](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1958)

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

#### count\_min?

> `optional` **count\_min?**: `number`

#### count\_max?

> `optional` **count\_max?**: `number`

#### proximity?

> `optional` **proximity?**: `object`

##### proximity.of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

##### proximity.range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)
