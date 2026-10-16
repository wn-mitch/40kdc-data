[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EquippedWeaponCountCondition

# Interface: EquippedWeaponCountCondition

Defined in: [generated.ts:1673](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1673)

[composition] This model carries exactly count weapons matching the shared weapons scope (for example, type melee while excluding a named weapon).

## Properties

### type

> **type**: `"equipped-weapon-count"`

Defined in: [generated.ts:1674](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1674)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1675](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1675)

#### subject

> **subject**: [`UnitRef`](../type-aliases/UnitRef.md)

#### weapons

> **weapons**: [`WeaponScope`](WeaponScope.md)

#### count

> **count**: [`CountBounds`](CountBounds.md)
