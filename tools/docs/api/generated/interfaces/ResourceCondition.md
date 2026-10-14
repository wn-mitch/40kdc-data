[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceCondition

# Interface: ResourceCondition

Defined in: [generated.ts:2170](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2170)

[resource] A resource pool holds at least / at most this much. below_max: fewer uses than its maximum have been spent.

## Properties

### type

> **type**: `"resource"`

Defined in: [generated.ts:2171](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2171)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2172](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2172)

#### pool

> **pool**: `string`

#### at\_least?

> `optional` **at\_least?**: `number`

#### at\_most?

> `optional` **at\_most?**: `number`

#### below\_max?

> `optional` **below\_max?**: `true`

#### source\_ability?

> `optional` **source\_ability?**: `object`

##### source\_ability.ability\_id

> **ability\_id**: `string`

##### source\_ability.owner?

> `optional` **owner?**: `"friendly"` \| `"enemy"`

#### at?

> `optional` **at?**: `"now"` \| `"opponents-previous-turn-end"`
