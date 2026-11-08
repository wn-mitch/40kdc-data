[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceCondition

# Interface: ResourceCondition

Defined in: [generated.ts:2604](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2604)

[resource] A resource pool holds at least / at most this much. below_max: fewer uses than its maximum have been spent.

## Properties

### type

> **type**: `"resource"`

Defined in: [generated.ts:2605](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2605)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2606](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2606)

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
