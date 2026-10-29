[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / validateLoadout

# Function: validateLoadout()

> **validateLoadout**(`unit`, `modelCount`, `options`, `counts`, `models?`): [`Violation`](../interfaces/Violation.md)[]

Defined in: [data/loadout.ts:1453](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L1453)

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

### models?

readonly [`LoadoutModel`](../interfaces/LoadoutModel.md)[]

## Returns

[`Violation`](../interfaces/Violation.md)[]
