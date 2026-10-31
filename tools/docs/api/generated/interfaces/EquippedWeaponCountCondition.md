[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EquippedWeaponCountCondition

# Interface: EquippedWeaponCountCondition

Defined in: [generated.ts:2069](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2069)

[composition] This model carries exactly count weapons matching the shared weapons scope (for example, type melee while excluding a named weapon).

## Properties

### type

> **type**: `"equipped-weapon-count"`

Defined in: [generated.ts:2070](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2070)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2071](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2071)

#### subject

> **subject**: [`UnitRef`](../type-aliases/UnitRef.md)

#### weapons

> **weapons**: [`WeaponScope`](WeaponScope.md)

#### count

> **count**: [`CountBounds`](CountBounds.md)
