[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceGainEffect

# Interface: ResourceGainEffect

Defined in: [generated.ts:6077](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6077)

[resource] Add to a resource pool.

## Properties

### type

> **type**: `"resource-gain"`

Defined in: [generated.ts:6078](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6078)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6079](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6079)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6080](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6080)

#### pool

> **pool**: `string`

#### amount

> **amount**: [`Quantity`](../type-aliases/Quantity.md) \| \{ `pool`: `string`; \}

#### set?

> `optional` **set?**: `true`

The pool becomes the amount instead of gaining it ('you must pledge a number'); amount any is a number the player picks.

#### label?

> `optional` **label?**: `string`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:6094](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6094)
