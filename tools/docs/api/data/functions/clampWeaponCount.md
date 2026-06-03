[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / clampWeaponCount

# Function: clampWeaponCount()

> **clampWeaponCount**(`bounds`, `id`, `requested`): `number`

Defined in: [data/loadout.ts:143](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/loadout.ts#L143)

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
