[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RangeRef

# Type Alias: RangeRef

> **RangeRef** = [`NonTieredRangeRef`](NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:368](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L368)

One reference for every distance. A per_battle_round table is indexed from battle round 1; each later round uses the next entry and the final entry continues for all subsequent rounds. Tier entries are non-tiered range refs, so nested tables are forbidden.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "range-ref".

## Union Members

[`NonTieredRangeRef`](NonTieredRangeRef.md)

***

### Type Literal

\{ `per_battle_round`: \[[`NonTieredRangeRef`](NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

#### per\_battle\_round

> **per\_battle\_round**: \[[`NonTieredRangeRef`](NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]

##### Min Items

1
