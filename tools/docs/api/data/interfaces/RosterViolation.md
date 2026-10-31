[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / RosterViolation

# Interface: RosterViolation

Defined in: [data/roster-resolve.ts:179](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L179)

One army-level legality violation.

## Properties

### code

> **code**: [`RosterViolationCode`](../type-aliases/RosterViolationCode.md)

Defined in: [data/roster-resolve.ts:180](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L180)

***

### id

> **id**: `string`

Defined in: [data/roster-resolve.ts:182](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L182)

Offending entity id (enhancement/unit/keyword/tag), or "roster" for army-wide.

***

### message

> **message**: `string`

Defined in: [data/roster-resolve.ts:183](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L183)

***

### unitIndex

> **unitIndex**: `number` \| `null`

Defined in: [data/roster-resolve.ts:185](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L185)

Index into the roster's units for unit-scoped codes; null for army-wide.

***

### severity

> **severity**: `"error"` \| `"warn"`

Defined in: [data/roster-resolve.ts:190](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L190)

`warn` for advisory codes (force disposition — provisional 11e data),
`error` otherwise. A roster is legal iff it has no `error` violations.
