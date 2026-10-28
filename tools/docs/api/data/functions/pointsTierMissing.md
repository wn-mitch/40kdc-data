[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / pointsTierMissing

# Function: pointsTierMissing()

> **pointsTierMissing**(`unit`, `modelCount`, `ordinal?`): `boolean`

Defined in: [data/pricing.ts:138](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/pricing.ts#L138)

True when no points tier covers `modelCount` for this `ordinal` — the count
falls outside every tier's `[models, models_max]` range (below the smallest
tier, above the largest, or in a gap between non-contiguous tiers), or the
ordinal has no banded price. A single-size tier (no `models_max`) covers only
`models`. Mirrors the band filter of [baseUnitPoints](baseUnitPoints.md).

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### modelCount

`number`

### ordinal?

`number` = `1`

## Returns

`boolean`
