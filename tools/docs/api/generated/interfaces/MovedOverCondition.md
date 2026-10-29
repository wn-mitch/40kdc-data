[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MovedOverCondition

# Interface: MovedOverCondition

Defined in: [generated.ts:2583](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2583)

[history] The subject (default the unit being checked) was moved over by `by` during that move (window event) or in the window.

## Properties

### type

> **type**: `"moved-over"`

Defined in: [generated.ts:2584](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2584)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2585](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2585)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### by

> **by**: [`UnitRef`](../type-aliases/UnitRef.md)

#### window?

> `optional` **window?**: [`HistoryWindow`](../type-aliases/HistoryWindow.md)
