[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CountOf

# Interface: CountOf

Defined in: [generated.ts:1209](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1209)

A number equal to how many of `count_of` there are (models in this unit with `keyword`, models equipped with `wargear`, the battle round number, your markers labelled `marker` on the battlefield).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "count-of".

## Properties

### count\_of

> **count\_of**: [`ScalingSource`](../type-aliases/ScalingSource.md) \| `"markers"`

Defined in: [generated.ts:1210](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1210)

***

### keyword?

> `optional` **keyword?**: `string`

Defined in: [generated.ts:1211](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1211)

***

### wargear?

> `optional` **wargear?**: `string`

Defined in: [generated.ts:1212](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1212)

***

### within?

> `optional` **within?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:1216](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1216)

Reach used by count sources that count models or units within a named range.

#### Union Members

[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md)

***

##### Type Literal

\{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

##### per\_battle\_round

> **per\_battle\_round**: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]

###### Min Items

1

***

### marker?

> `optional` **marker?**: `string`

Defined in: [generated.ts:1227](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1227)

Kebab-case identifier
