[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / primaryDetachment

# Function: primaryDetachment()

> **primaryDetachment**(`roster`): `RosterDetachment` \| `undefined`

Defined in: [data/roster-resolve.ts:745](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L745)

The roster's **primary detachment** — the first in source order. 11th
edition rosters may field several detachments under a detachment-point cap,
but single-detachment consumers (and every pre-11e list) just want "the"
detachment. This names that choice so callers stop reaching into
`detachments[0]` directly. Returns `undefined` only when the roster carries
no detachment at all (the source declared none, or none parsed).

## Parameters

### roster

`Roster`

## Returns

`RosterDetachment` \| `undefined`
