[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / baseUnitPoints

# Function: baseUnitPoints()

> **baseUnitPoints**(`unit`, `modelCount`, `ordinal?`): `number`

Defined in: [data/pricing.ts:55](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/pricing.ts#L55)

Base point cost for a unit of `modelCount` models taken as its `ordinal`-th
army copy (1-based; defaults to the 1st copy). Among the tiers whose ordinal
band covers this copy, returns the cost of the highest `models` threshold the
count reaches (lowest tier when none is reached). `models` is the tier's range
floor (a range-priced tier spans `models`..`models_max` at one cost, e.g.
Venatari 4–6 @320), so a count inside a range resolves to that range's cost.
Returns 0 when no tier applies — the caller surfaces a violation rather than
guessing.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### modelCount

`number`

### ordinal?

`number` = `1`

## Returns

`number`
