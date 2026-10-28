[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / hostUnitPoints

# Function: hostUnitPoints()

> **hostUnitPoints**(`unit`, `modelCount`, `ordinal?`, `hostFaction?`, `detachmentIds?`): `number`

Defined in: [data/pricing.ts:121](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/pricing.ts#L121)

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

### detachmentIds?

readonly `string`[] = `[]`

## Returns

`number`
