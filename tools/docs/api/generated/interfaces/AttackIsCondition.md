[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttackIsCondition

# Interface: AttackIsCondition

Defined in: [generated.ts:2515](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2515)

[attack] The attack being resolved matches every filter.

## Properties

### type

> **type**: `"attack-is"`

Defined in: [generated.ts:2516](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2516)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2517](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2517)

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
