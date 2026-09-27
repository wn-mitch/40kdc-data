[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / NormRoster

# Interface: NormRoster

Defined in: [data/roster-resolve.ts:197](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L197)

Normalised roster input shared by [checkRoster](../functions/checkRoster.md) (from a full Roster)
and the `check_roster_legality` runner op (from a compact spec), so the two
entry points run the exact same checks.

## Properties

### factionId

> **factionId**: `string` \| `null`

Defined in: [data/roster-resolve.ts:198](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L198)

***

### battleSize

> **battleSize**: `BattleSize` \| `null`

Defined in: [data/roster-resolve.ts:199](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L199)

***

### forceDisposition

> **forceDisposition**: `string` \| `null`

Defined in: [data/roster-resolve.ts:200](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L200)

***

### detachmentIds

> **detachmentIds**: `string`[]

Defined in: [data/roster-resolve.ts:201](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L201)

***

### units

> **units**: `NormUnit`[]

Defined in: [data/roster-resolve.ts:202](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L202)
