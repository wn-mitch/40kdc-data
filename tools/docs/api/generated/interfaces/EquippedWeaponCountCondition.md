[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EquippedWeaponCountCondition

# Interface: EquippedWeaponCountCondition

Defined in: [generated.ts:1973](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1973)

[composition] This model carries exactly count weapons matching the shared weapons scope (for example, type melee while excluding a named weapon).

## Properties

### type

> **type**: `"equipped-weapon-count"`

Defined in: [generated.ts:1974](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1974)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1975](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1975)

#### subject

> **subject**: [`UnitRef`](../type-aliases/UnitRef.md)

#### weapons

> **weapons**: [`WeaponScope`](WeaponScope.md)

#### count

> **count**: [`CountBounds`](CountBounds.md)
