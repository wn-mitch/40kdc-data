[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / hostUnitPoints

# Function: hostUnitPoints()

> **hostUnitPoints**(`unit`, `modelCount`, `ordinal?`, `hostFaction?`, `detachmentIds?`): `number`

Defined in: [data/pricing.ts:121](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/pricing.ts#L121)

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
