[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / clampWeaponCount

# Function: clampWeaponCount()

> **clampWeaponCount**(`bounds`, `id`, `requested`): `number`

Defined in: [data/loadout.ts:463](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L463)

Clamp a single weapon's requested count into its valid range. Ids with no
bound (not part of this unit's loadout) are returned unchanged but floored at
zero.

## Parameters

### bounds

`Map`\<`string`, [`WeaponBound`](../interfaces/WeaponBound.md)\>

### id

`string`

### requested

`number`

## Returns

`number`
