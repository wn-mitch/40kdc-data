[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ActOnDeathEffect

# Interface: ActOnDeathEffect

Defined in: [generated.ts:5143](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5143)

[models] A destroyed model can fight or shoot before it is removed.

## Properties

### type

> **type**: `"act-on-death"`

Defined in: [generated.ts:5144](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5144)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5145](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5145)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5146](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5146)

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

Defined in: [generated.ts:5153](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5153)
