[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttackIsCondition

# Interface: AttackIsCondition

Defined in: [generated.ts:2404](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2404)

[attack] The attack being resolved matches every filter.

## Properties

### type

> **type**: `"attack-is"`

Defined in: [generated.ts:2405](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2405)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2406](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2406)

#### attack\_type?

> `optional` **attack\_type?**: [`AttackType`](../type-aliases/AttackType.md)

#### shooting\_type?

> `optional` **shooting\_type?**: `"normal"` \| `"assault"` \| `"close-quarters"` \| `"indirect"` \| `"snap"`

#### fight\_type?

> `optional` **fight\_type?**: `"normal"` \| `"overrun"`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

#### all\_target\_same\_unit?

> `optional` **all\_target\_same\_unit?**: `true`
