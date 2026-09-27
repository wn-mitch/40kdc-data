[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveAttachedLeader

# Function: resolveAttachedLeader()

> **resolveAttachedLeader**(`roster`, `bodyguardUnitId`): `RosterUnit` \| `undefined`

Defined in: [data/roster-resolve.ts:506](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L506)

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
