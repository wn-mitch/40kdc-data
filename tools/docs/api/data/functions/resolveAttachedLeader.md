[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveAttachedLeader

# Function: resolveAttachedLeader()

> **resolveAttachedLeader**(`roster`, `bodyguardUnitId`): `RosterUnit` \| `undefined`

Defined in: [data/roster-resolve.ts:664](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L664)

The roster's leader entry attached to `bodyguardUnitId`, if any. Import
stores the inferred (always-provisional) attachment on the *leader's*
RosterUnit, pointing down to its bodyguard via
`leader_attachment.bodyguard_ref`. Selection UIs start from the body unit,
so this scans for the leader whose `bodyguard_ref.id` matches. Returns
`undefined` when no leader in the roster is attached to that unit (the
common case — attachments are optional at game start).

## Parameters

### roster

`Roster`

### bodyguardUnitId

`string`

## Returns

`RosterUnit` \| `undefined`
