[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StatModifierEffect

# Interface: StatModifierEffect

Defined in: [generated.ts:3513](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3513)

[characteristic] Change a characteristic of the target's models or their weapons. incoming: the change applies to attacks made against the target.

## Properties

### type

> **type**: `"stat-modifier"`

Defined in: [generated.ts:3514](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3514)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3515](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3515)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3516](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3516)

#### stat

> **stat**: [`Stat`](../type-aliases/Stat.md)

#### operation

> **operation**: `"add"` \| `"subtract"` \| `"set"` \| `"improve"` \| `"worsen"` \| `"multiply"` \| `"halve"`

#### value?

> `optional` **value?**: [`Quantity`](../type-aliases/Quantity.md)

#### incoming?

> `optional` **incoming?**: `true`

#### minimum?

> `optional` **minimum?**: `number`

#### maximum?

> `optional` **maximum?**: `number`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3525](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3525)
