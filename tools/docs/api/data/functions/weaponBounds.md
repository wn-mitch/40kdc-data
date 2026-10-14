[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / weaponBounds

# Function: weaponBounds()

> **weaponBounds**(`unit`, `modelCount`, `options`, `models?`): `Map`\<`string`, [`WeaponBound`](../interfaces/WeaponBound.md)\>

Defined in: [data/loadout.ts:348](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L348)

Inclusive valid count range for each weapon/wargear id, used to clamp a UI's
per-weapon inputs so invalid loadouts are unreachable. A base weapon ranges
`[modelCount − maxSwapsAway, modelCount]`; an optional (replacement) id ranges
`[0, Σ caps that add it]`.

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

`Map`\<`string`, [`WeaponBound`](../interfaces/WeaponBound.md)\>
