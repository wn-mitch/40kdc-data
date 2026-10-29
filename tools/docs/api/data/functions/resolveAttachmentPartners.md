[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveAttachmentPartners

# Function: resolveAttachmentPartners()

> **resolveAttachmentPartners**(`roster`, `unitId`): `RosterUnit`[]

Defined in: [data/roster-resolve.ts:687](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L687)

Every roster unit attached to `unitId`, resolved from *either* end of the
attachment. A leader+bodyguard are one combined unit, so a selection UI may
start from either half:
  - `unitId` is the **bodyguard** → the leader(s) whose
    `leader_attachment.bodyguard_ref.id` points at it (body-first, the
    [resolveAttachedLeader](resolveAttachedLeader.md) direction), and
  - `unitId` is a **leader** → its bodyguard and every other leader in the
    same attachment.
Returns the partner RosterUnits (deduped, source order). Empty when
the unit has no attachment in this roster — the common case, since
attachments are optional at game start. Shaped as a list to carry 11th
edition's multi-member attachments without an API change.

## Parameters

### roster

`Roster`

### unitId

`string`

## Returns

`RosterUnit`[]
