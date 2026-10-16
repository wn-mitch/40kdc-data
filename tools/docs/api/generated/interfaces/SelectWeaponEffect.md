[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / SelectWeaponEffect

# Interface: SelectWeaponEffect

Defined in: [generated.ts:6041](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6041)

[ability] Pick one of the target's weapons (count of them) and bind it; weapon-qualified effects refer to the bound weapon reference.

## Properties

### type

> **type**: `"select-weapon"`

Defined in: [generated.ts:6042](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6042)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6043](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6043)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6044](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6044)

#### count?

> `optional` **count?**: `number`

#### bind\_as

> **bind\_as**: `string`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:6049](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6049)
