[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveRosterWargear

# Function: resolveRosterWargear()

> **resolveRosterWargear**(`wargear`, `dataset`): `object`[]

Defined in: [data/roster-resolve.ts:38](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/roster-resolve.ts#L38)

Resolve every wargear entry on a roster unit to a [WeaponView](../classes/WeaponView.md),
keeping each entry's count alongside. Unresolved entries are dropped
silently (matching [resolveRosterUnit](resolveRosterUnit.md)). Useful when the SPA
needs to enumerate firing options after the user picks a roster unit.

## Parameters

### wargear

`RosterWargear`[]

### dataset

[`Dataset`](../classes/Dataset.md)

## Returns

`object`[]
