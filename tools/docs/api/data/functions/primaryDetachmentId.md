[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / primaryDetachmentId

# Function: primaryDetachmentId()

> **primaryDetachmentId**(`roster`): `string` \| `null`

Defined in: [data/roster-resolve.ts:569](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L569)

The resolved entity id of the [primaryDetachment](primaryDetachment.md). `null` when the
roster carries no detachment, or when the primary one failed to resolve to a
known id (the raw name is still retained on the detachment's `ref`).

## Parameters

### roster

`Roster`

## Returns

`string` \| `null`
