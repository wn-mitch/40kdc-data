[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / validateLoadout

# Function: validateLoadout()

> **validateLoadout**(`unit`, `modelCount`, `options`, `counts`, `models?`): [`Violation`](../interfaces/Violation.md)[]

Defined in: [data/loadout.ts:1247](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/loadout.ts#L1247)

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
