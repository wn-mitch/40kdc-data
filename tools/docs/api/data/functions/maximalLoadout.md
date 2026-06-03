[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / maximalLoadout

# Function: maximalLoadout()

> **maximalLoadout**(`unit`, `modelCount`, `options`): [`Loadout`](../interfaces/Loadout.md)

Defined in: [data/loadout.ts:80](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/loadout.ts#L80)

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

## Returns

[`Loadout`](../interfaces/Loadout.md)
