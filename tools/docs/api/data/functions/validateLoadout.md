[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / validateLoadout

# Function: validateLoadout()

> **validateLoadout**(`unit`, `modelCount`, `options`, `counts`, `models?`): [`Violation`](../interfaces/Violation.md)[]

Defined in: [data/loadout.ts:1453](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/loadout.ts#L1453)

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
