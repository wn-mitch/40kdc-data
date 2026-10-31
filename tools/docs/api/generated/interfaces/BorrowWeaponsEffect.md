[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BorrowWeaponsEffect

# Interface: BorrowWeaponsEffect

Defined in: [generated.ts:7236](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7236)

[ability] The target (a Transport) uses one ranged weapon from each of up to max_models models embarked within it (Firing Deck); those models cannot shoot.

## Properties

### type

> **type**: `"borrow-weapons"`

Defined in: [generated.ts:7237](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7237)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:7238](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7238)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:7239](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7239)

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

Defined in: [generated.ts:7245](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7245)
