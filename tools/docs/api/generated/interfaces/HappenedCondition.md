[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HappenedCondition

# Interface: HappenedCondition

Defined in: [generated.ts:1809](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1809)

[history] An event happened within `window`: the subject did it, to the object, matching the filter, within the optional inclusive `count` bounds (default 1).

## Properties

### type

> **type**: `"happened"`

Defined in: [generated.ts:1810](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1810)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1811](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1811)

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
