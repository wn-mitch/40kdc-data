[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceCondition

# Interface: ResourceCondition

Defined in: [generated.ts:2483](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2483)

[resource] A resource pool holds at least / at most this much. below_max: fewer uses than its maximum have been spent.

## Properties

### type

> **type**: `"resource"`

Defined in: [generated.ts:2484](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2484)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2485](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2485)

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

> `optional` **owner?**: `"friendly"` \| `"enemy"` \| `"any"`

A definite player: friendly or enemy (an owner other than any).

#### at?

> `optional` **at?**: [`Snapshot`](../type-aliases/Snapshot.md)
