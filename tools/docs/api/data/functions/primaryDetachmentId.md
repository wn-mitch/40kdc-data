[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / primaryDetachmentId

# Function: primaryDetachmentId()

> **primaryDetachmentId**(`roster`): `string` \| `null`

Defined in: [data/roster-resolve.ts:747](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L747)

The resolved entity id of the [primaryDetachment](primaryDetachment.md). `null` when the
roster carries no detachment, or when the primary one failed to resolve to a
known id (the raw name is still retained on the detachment's `ref`).

## Parameters

### roster

`Roster`

## Returns

`string` \| `null`
