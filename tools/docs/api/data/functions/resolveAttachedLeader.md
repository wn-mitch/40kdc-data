[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveAttachedLeader

# Function: resolveAttachedLeader()

> **resolveAttachedLeader**(`roster`, `bodyguardUnitId`): `RosterUnit` \| `undefined`

Defined in: [data/roster-resolve.ts:669](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L669)

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
