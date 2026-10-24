[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ActOnDeathEffect

# Interface: ActOnDeathEffect

Defined in: [generated.ts:4533](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4533)

[models] A destroyed model can fight or shoot before it is removed.

## Properties

### type

> **type**: `"act-on-death"`

Defined in: [generated.ts:4534](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4534)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4535](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4535)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4536](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4536)

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

Defined in: [generated.ts:4543](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4543)
