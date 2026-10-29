[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BorrowWeaponsEffect

# Interface: BorrowWeaponsEffect

Defined in: [generated.ts:6696](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6696)

[ability] The target (a Transport) uses one ranged weapon from each of up to max_models models embarked within it (Firing Deck); those models cannot shoot.

## Properties

### type

> **type**: `"borrow-weapons"`

Defined in: [generated.ts:6697](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6697)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6698](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6698)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6699](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6699)

#### from?

> `optional` **from?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### max\_models

> **max\_models**: [`Quantity`](../type-aliases/Quantity.md)

#### until?

> `optional` **until?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:6705](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6705)
