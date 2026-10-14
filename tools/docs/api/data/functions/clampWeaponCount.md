[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / clampWeaponCount

# Function: clampWeaponCount()

> **clampWeaponCount**(`bounds`, `id`, `requested`): `number`

Defined in: [data/loadout.ts:429](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/loadout.ts#L429)

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
