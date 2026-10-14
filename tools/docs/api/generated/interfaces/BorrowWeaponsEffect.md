[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BorrowWeaponsEffect

# Interface: BorrowWeaponsEffect

Defined in: [generated.ts:6027](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6027)

[ability] The target (a Transport) uses one ranged weapon from each of up to max_models models embarked within it (Firing Deck); those models cannot shoot.

## Properties

### type

> **type**: `"borrow-weapons"`

Defined in: [generated.ts:6028](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6028)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6029](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6029)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6030](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6030)

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

Defined in: [generated.ts:6036](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6036)
