[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / baseLoadout

# Function: baseLoadout()

> **baseLoadout**(`unit`, `modelCount`, `options`, `models?`): [`Loadout`](../interfaces/Loadout.md)

Defined in: [data/loadout.ts:285](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L285)

The base loadout: every model in its out-of-the-box configuration, no swaps
applied. This is the legal default a freshly-added unit ships with. Reads the
composition's recorded `default_weapon_ids` when present (authoritative),
otherwise derives the base set. [maximalLoadout](maximalLoadout.md) starts from this set and
then applies every option at full cap.

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
