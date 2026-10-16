[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RangeRef

# Type Alias: RangeRef

> **RangeRef** = [`NonTieredRangeRef`](NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:357](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L357)

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
