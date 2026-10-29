[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponAbilityGrantEffect

# Interface: WeaponAbilityGrantEffect

Defined in: [generated.ts:3658](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3658)

[ability] Give the target's weapons weapon abilities. if_present: increment raises an ability the weapon already has by the granted rating.

## Properties

### type

> **type**: `"weapon-ability-grant"`

Defined in: [generated.ts:3659](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3659)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3660](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3660)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3661](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3661)

#### removes?

> `optional` **removes?**: \[[`WeaponKeywordSelector`](WeaponKeywordSelector.md), `...WeaponKeywordSelector[]`\]

##### Min Items

1

#### if\_present?

> `optional` **if\_present?**: `"increment"`

#### incoming?

> `optional` **incoming?**: `true`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

#### keywords?

> `optional` **keywords?**: \[[`WeaponKeywordRef`](WeaponKeywordRef.md), `...WeaponKeywordRef[]`\]

##### Min Items

1

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3674](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3674)
