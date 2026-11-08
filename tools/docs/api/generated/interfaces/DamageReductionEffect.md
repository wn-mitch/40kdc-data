[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DamageReductionEffect

# Interface: DamageReductionEffect

Defined in: [generated.ts:5361](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5361)

[protection] Reduce the Damage of attacks allocated to the target.

## Properties

### type

> **type**: `"damage-reduction"`

Defined in: [generated.ts:5362](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5362)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5363](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5363)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5364](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5364)

#### reduction

> **reduction**: `number` \| `"half"` \| `"to-zero"`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5368](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5368)
