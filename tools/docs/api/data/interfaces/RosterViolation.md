[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / RosterViolation

# Interface: RosterViolation

Defined in: [data/roster-resolve.ts:161](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L161)

One army-level legality violation.

## Properties

### code

> **code**: [`RosterViolationCode`](../type-aliases/RosterViolationCode.md)

Defined in: [data/roster-resolve.ts:162](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L162)

***

### id

> **id**: `string`

Defined in: [data/roster-resolve.ts:164](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L164)

Offending entity id (enhancement/unit/keyword/tag), or "roster" for army-wide.

***

### message

> **message**: `string`

Defined in: [data/roster-resolve.ts:165](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L165)

***

### unitIndex

> **unitIndex**: `number` \| `null`

Defined in: [data/roster-resolve.ts:167](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L167)

Index into the roster's units for unit-scoped codes; null for army-wide.

***

### severity

> **severity**: `"error"` \| `"warn"`

Defined in: [data/roster-resolve.ts:172](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L172)

`warn` for advisory codes (force disposition — provisional 11e data),
`error` otherwise. A roster is legal iff it has no `error` violations.
