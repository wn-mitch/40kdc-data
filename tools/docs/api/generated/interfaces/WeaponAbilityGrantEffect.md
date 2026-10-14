[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponAbilityGrantEffect

# Interface: WeaponAbilityGrantEffect

Defined in: [generated.ts:3323](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3323)

[ability] Give the target's weapons weapon abilities. if_present: increment raises an ability the weapon already has by the granted rating.

## Properties

### type

> **type**: `"weapon-ability-grant"`

Defined in: [generated.ts:3324](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3324)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3325](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3325)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3326](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3326)

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

Defined in: [generated.ts:3339](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3339)
