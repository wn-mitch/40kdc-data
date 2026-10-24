[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttackIsCondition

# Interface: AttackIsCondition

Defined in: [generated.ts:2090](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2090)

[attack] The attack being resolved matches every filter.

## Properties

### type

> **type**: `"attack-is"`

Defined in: [generated.ts:2091](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2091)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2092](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2092)

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
