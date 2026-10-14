[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / hostUnitPoints

# Function: hostUnitPoints()

> **hostUnitPoints**(`unit`, `modelCount`, `ordinal?`, `hostFaction?`): `number`

Defined in: [data/pricing.ts:111](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/pricing.ts#L111)

[baseUnitPoints](baseUnitPoints.md), but priced from the tier table in effect inside
`hostFaction`'s army (see [hostPointsTiers](hostPointsTiers.md)). With no `hostFaction`
this IS `baseUnitPoints`. Size coverage is identical across tables (allied
tiers reprice the native sizes), so `pointsTierMissing` stays native-only.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### modelCount

`number`

### ordinal?

`number` = `1`

### hostFaction?

[`Faction`](../../generated/interfaces/Faction.md) \| `null`

## Returns

`number`
