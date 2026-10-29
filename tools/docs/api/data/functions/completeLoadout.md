[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / completeLoadout

# Function: completeLoadout()

> **completeLoadout**(`unit`, `modelCount`, `options`, `models`, `explicitCounts`): [`CompletedLoadout`](../interfaces/CompletedLoadout.md) \| `null`

Defined in: [data/loadout.ts:1219](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L1219)

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
