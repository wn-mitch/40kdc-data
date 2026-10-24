[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / RosterViolation

# Interface: RosterViolation

Defined in: [data/roster-resolve.ts:177](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L177)

One army-level legality violation.

## Properties

### code

> **code**: [`RosterViolationCode`](../type-aliases/RosterViolationCode.md)

Defined in: [data/roster-resolve.ts:178](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L178)

***

### id

> **id**: `string`

Defined in: [data/roster-resolve.ts:180](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L180)

Offending entity id (enhancement/unit/keyword/tag), or "roster" for army-wide.

***

### message

> **message**: `string`

Defined in: [data/roster-resolve.ts:181](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L181)

***

### unitIndex

> **unitIndex**: `number` \| `null`

Defined in: [data/roster-resolve.ts:183](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L183)

Index into the roster's units for unit-scoped codes; null for army-wide.

***

### severity

> **severity**: `"error"` \| `"warn"`

Defined in: [data/roster-resolve.ts:188](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L188)

`warn` for advisory codes (force disposition — provisional 11e data),
`error` otherwise. A roster is legal iff it has no `error` violations.
