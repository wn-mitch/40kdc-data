[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / NormRoster

# Interface: NormRoster

Defined in: [data/roster-resolve.ts:214](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L214)

Normalised roster input shared by [checkRoster](../functions/checkRoster.md) (from a full Roster)
and the `check_roster_legality` runner op (from a compact spec), so the two
entry points run the exact same checks.

## Properties

### factionId

> **factionId**: `string` \| `null`

Defined in: [data/roster-resolve.ts:215](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L215)

***

### battleSize

> **battleSize**: `BattleSize` \| `null`

Defined in: [data/roster-resolve.ts:216](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L216)

***

### forceDisposition

> **forceDisposition**: `string` \| `null`

Defined in: [data/roster-resolve.ts:217](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L217)

***

### detachmentIds

> **detachmentIds**: `string`[]

Defined in: [data/roster-resolve.ts:218](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L218)

***

### units

> **units**: `NormUnit`[]

Defined in: [data/roster-resolve.ts:219](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L219)
