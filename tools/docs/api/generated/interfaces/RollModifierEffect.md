[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollModifierEffect

# Interface: RollModifierEffect

Defined in: [generated.ts:3252](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3252)

[roll] Add to or subtract from a roll. cap bounds a stacking modifier; value_from takes the value from an earlier step's roll.

## Properties

### type

> **type**: `"roll-modifier"`

Defined in: [generated.ts:3253](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3253)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3254](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3254)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3255](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3255)

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

Defined in: [generated.ts:3264](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3264)
