[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ActOnDeathEffect

# Interface: ActOnDeathEffect

Defined in: [generated.ts:5494](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5494)

[models] A destroyed model can fight or shoot before it is removed.

## Properties

### type

> **type**: `"act-on-death"`

Defined in: [generated.ts:5495](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5495)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5496](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5496)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5497](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5497)

#### act

> **act**: `"fight"` \| `"shoot"`

#### resolution?

> `optional` **resolution?**: `string`

#### removal?

> `optional` **removal?**: `string`

#### gate?

> `optional` **gate?**: [`DeathGate`](DeathGate.md)

#### eligibility?

> `optional` **eligibility?**: [`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5504](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5504)
