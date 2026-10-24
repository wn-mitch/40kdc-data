[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / baseLoadout

# Function: baseLoadout()

> **baseLoadout**(`unit`, `modelCount`, `options`, `models?`): [`Loadout`](../interfaces/Loadout.md)

Defined in: [data/loadout.ts:286](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/loadout.ts#L286)

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
