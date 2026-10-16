[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceCondition

# Interface: ResourceCondition

Defined in: [generated.ts:2169](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2169)

[resource] A resource pool holds at least / at most this much. below_max: fewer uses than its maximum have been spent.

## Properties

### type

> **type**: `"resource"`

Defined in: [generated.ts:2170](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2170)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2171](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2171)

#### pool

> **pool**: `string`

#### count?

> `optional` **count?**: [`CountBounds`](CountBounds.md)

#### below\_max?

> `optional` **below\_max?**: `true`

#### source\_ability?

> `optional` **source\_ability?**: `object`

##### source\_ability.ability\_id

> **ability\_id**: `string`

##### source\_ability.owner?

> `optional` **owner?**: `"friendly"` \| `"enemy"`

#### at?

> `optional` **at?**: [`Snapshot`](../type-aliases/Snapshot.md)
