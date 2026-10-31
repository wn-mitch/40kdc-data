[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollModifierEffect

# Interface: RollModifierEffect

Defined in: [generated.ts:3714](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3714)

[roll] Add to or subtract from a roll, or halve it. cap bounds a stacking modifier; value_from takes the value from an earlier step's roll. halve takes no value, cap or value_from.

## Properties

### type

> **type**: `"roll-modifier"`

Defined in: [generated.ts:3715](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3715)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3716](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3716)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3717](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3717)

#### roll

> **roll**: [`RollSelector`](../type-aliases/RollSelector.md)

#### operation

> **operation**: `"add"` \| `"subtract"` \| `"halve"`

#### value?

> `optional` **value?**: [`Quantity`](../type-aliases/Quantity.md)

#### cap?

> `optional` **cap?**: `number`

#### value\_from?

> `optional` **value\_from?**: `"previous-roll"`

#### incoming?

> `optional` **incoming?**: `true`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3726](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3726)
