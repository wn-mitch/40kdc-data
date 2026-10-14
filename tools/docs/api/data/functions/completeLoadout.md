[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / completeLoadout

# Function: completeLoadout()

> **completeLoadout**(`unit`, `modelCount`, `options`, `models`, `explicitCounts`): [`CompletedLoadout`](../interfaces/CompletedLoadout.md) \| `null`

Defined in: [data/loadout.ts:1085](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L1085)

Complete a partial source loadout without inventing optional selections.

Roster text commonly omits weapons every model carries implicitly. For each
valid composition allocation, this searches the same legal per-model
candidates as [groupLoadout](groupLoadout.md), but permits each item up to the greater
of its explicit count and its aggregate default count. Items absent from both
the source and the defaults remain forbidden. The result therefore fills
only defaults displaced as required by explicitly printed swaps.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### modelCount

`number`

### options

readonly [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

### models

readonly [`LoadoutModel`](../interfaces/LoadoutModel.md)[] \| `undefined`

### explicitCounts

`Map`\<`string`, `number`\>

## Returns

[`CompletedLoadout`](../interfaces/CompletedLoadout.md) \| `null`
