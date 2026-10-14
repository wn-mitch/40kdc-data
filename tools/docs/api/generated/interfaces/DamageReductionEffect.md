[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DamageReductionEffect

# Interface: DamageReductionEffect

Defined in: [generated.ts:4400](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4400)

[protection] Reduce the Damage of attacks allocated to the target.

## Properties

### type

> **type**: `"damage-reduction"`

Defined in: [generated.ts:4401](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4401)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4402](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4402)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4403](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4403)

#### reduction

> **reduction**: `number` \| `"half"` \| `"to-zero"`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4407](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4407)
