[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveAttachedLeader

# Function: resolveAttachedLeader()

> **resolveAttachedLeader**(`roster`, `bodyguardUnitId`): `RosterUnit` \| `undefined`

Defined in: [data/roster-resolve.ts:62](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/roster-resolve.ts#L62)

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
