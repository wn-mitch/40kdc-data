[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / validateLoadout

# Function: validateLoadout()

> **validateLoadout**(`unit`, `modelCount`, `options`, `counts`): [`Violation`](../interfaces/Violation.md)[]

Defined in: [data/loadout.ts:155](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/loadout.ts#L155)

Report every weapon/wargear count that falls outside its valid range.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### modelCount

`number`

### options

readonly [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

### counts

`Map`\<`string`, `number`\>

## Returns

[`Violation`](../interfaces/Violation.md)[]
