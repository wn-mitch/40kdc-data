[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MovedOverCondition

# Interface: MovedOverCondition

Defined in: [generated.ts:2263](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2263)

[history] The subject (default the unit being checked) was moved over by `by` during that move (window event) or in the window.

## Properties

### type

> **type**: `"moved-over"`

Defined in: [generated.ts:2264](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2264)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2265](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2265)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### by

> **by**: [`UnitRef`](../type-aliases/UnitRef.md)

#### window?

> `optional` **window?**: [`HistoryWindow`](../type-aliases/HistoryWindow.md)
