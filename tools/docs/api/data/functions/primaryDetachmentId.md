[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / primaryDetachmentId

# Function: primaryDetachmentId()

> **primaryDetachmentId**(`roster`): `string` \| `null`

Defined in: [data/roster-resolve.ts:754](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L754)

The resolved entity id of the [primaryDetachment](primaryDetachment.md). `null` when the
roster carries no detachment, or when the primary one failed to resolve to a
known id (the raw name is still retained on the detachment's `ref`).

## Parameters

### roster

`Roster`

## Returns

`string` \| `null`
