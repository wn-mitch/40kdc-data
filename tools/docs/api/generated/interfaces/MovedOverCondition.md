[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MovedOverCondition

# Interface: MovedOverCondition

Defined in: [generated.ts:2704](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2704)

[history] The subject (default the unit being checked) was moved over by `by` during that move (window event) or in the window.

## Properties

### type

> **type**: `"moved-over"`

Defined in: [generated.ts:2705](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2705)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2706](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2706)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### by

> **by**: [`UnitRef`](../type-aliases/UnitRef.md)

#### window?

> `optional` **window?**: [`HistoryWindow`](../type-aliases/HistoryWindow.md)
