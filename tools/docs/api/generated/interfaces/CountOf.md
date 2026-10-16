[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CountOf

# Interface: CountOf

Defined in: [generated.ts:1165](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1165)

A number equal to how many of `count_of` there are (models in this unit with `keyword`, models equipped with `wargear`, the battle round number).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "count-of".

## Properties

### count\_of

> **count\_of**: [`ScalingSource`](../type-aliases/ScalingSource.md)

Defined in: [generated.ts:1166](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1166)

***

### keyword?

> `optional` **keyword?**: `string`

Defined in: [generated.ts:1167](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1167)

***

### wargear?

> `optional` **wargear?**: `string`

Defined in: [generated.ts:1168](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1168)

***

### within?

> `optional` **within?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:1172](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1172)

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
