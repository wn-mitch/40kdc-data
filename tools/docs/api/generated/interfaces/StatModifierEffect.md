[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StatModifierEffect

# Interface: StatModifierEffect

Defined in: [generated.ts:3640](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3640)

[characteristic] Change a characteristic of the target's models or their weapons. incoming: the change applies to attacks made against the target.

## Properties

### type

> **type**: `"stat-modifier"`

Defined in: [generated.ts:3641](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3641)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3642](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3642)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3643](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3643)

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

Defined in: [generated.ts:3652](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3652)
