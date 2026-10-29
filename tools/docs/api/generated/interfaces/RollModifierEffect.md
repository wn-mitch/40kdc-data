[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollModifierEffect

# Interface: RollModifierEffect

Defined in: [generated.ts:3587](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3587)

[roll] Add to or subtract from a roll. cap bounds a stacking modifier; value_from takes the value from an earlier step's roll.

## Properties

### type

> **type**: `"roll-modifier"`

Defined in: [generated.ts:3588](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3588)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3589](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3589)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3590](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3590)

#### roll

> **roll**: [`RollSelector`](../type-aliases/RollSelector.md)

#### operation

> **operation**: `"add"` \| `"subtract"`

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

Defined in: [generated.ts:3599](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3599)
