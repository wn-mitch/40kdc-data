[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveRosterWargear

# Function: resolveRosterWargear()

> **resolveRosterWargear**(`wargear`, `dataset`): `object`[]

Defined in: [data/roster-resolve.ts:52](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L52)

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
