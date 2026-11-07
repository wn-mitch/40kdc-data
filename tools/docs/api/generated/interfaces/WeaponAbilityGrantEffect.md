[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponAbilityGrantEffect

# Interface: WeaponAbilityGrantEffect

Defined in: [generated.ts:3785](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3785)

[ability] Give the target's weapons weapon abilities. if_present: increment raises an ability the weapon already has by the granted rating.

## Properties

### type

> **type**: `"weapon-ability-grant"`

Defined in: [generated.ts:3786](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3786)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3787](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3787)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3788](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3788)

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

Defined in: [generated.ts:3801](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3801)
