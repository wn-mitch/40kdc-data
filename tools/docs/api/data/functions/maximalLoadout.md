[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / maximalLoadout

# Function: maximalLoadout()

> **maximalLoadout**(`unit`, `modelCount`, `options`, `models?`): [`Loadout`](../interfaces/Loadout.md)

Defined in: [data/loadout.ts:307](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L307)

The maximal loadout: every base weapon on every model, then each option
applied at its full [optionCap](optionCap.md) (choices take their first branch). Swaps
move count from the replaced id to the added id; add-ons only add.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### modelCount

`number`

### options

readonly [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

### models?

readonly [`LoadoutModel`](../interfaces/LoadoutModel.md)[]

## Returns

[`Loadout`](../interfaces/Loadout.md)
