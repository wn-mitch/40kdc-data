[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RangeRef

# Type Alias: RangeRef

> **RangeRef** = [`NonTieredRangeRef`](NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:357](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L357)

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
