[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / RosterViolation

# Interface: RosterViolation

Defined in: [data/roster-resolve.ts:178](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L178)

One army-level legality violation.

## Properties

### code

> **code**: [`RosterViolationCode`](../type-aliases/RosterViolationCode.md)

Defined in: [data/roster-resolve.ts:179](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L179)

***

### id

> **id**: `string`

Defined in: [data/roster-resolve.ts:181](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L181)

Offending entity id (enhancement/unit/keyword/tag), or "roster" for army-wide.

***

### message

> **message**: `string`

Defined in: [data/roster-resolve.ts:182](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L182)

***

### unitIndex

> **unitIndex**: `number` \| `null`

Defined in: [data/roster-resolve.ts:184](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L184)

Index into the roster's units for unit-scoped codes; null for army-wide.

***

### severity

> **severity**: `"error"` \| `"warn"`

Defined in: [data/roster-resolve.ts:189](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L189)

`warn` for advisory codes (force disposition — provisional 11e data),
`error` otherwise. A roster is legal iff it has no `error` violations.
