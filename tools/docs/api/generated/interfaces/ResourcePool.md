[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourcePool

# Interface: ResourcePool

Defined in: [generated.ts:8567](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8567)

A faction's resource system (Miracle Dice, Pain tokens, Blessings dice pool, etc.).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "resource-pool".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:8568](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8568)

***

### name

> **name**: `string`

Defined in: [generated.ts:8569](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8569)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:8570](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8570)

***

### pool\_type

> **pool\_type**: `"token"` \| `"dice-pool"` \| `"counter"`

Defined in: [generated.ts:8571](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8571)

***

### generation?

> `optional` **generation?**: `object`[]

Defined in: [generated.ts:8572](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8572)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### condition

> **condition**: [`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md)

#### amount

> **amount**: [`StatValue`](../type-aliases/StatValue.md)

***

### max\_size?

> `optional` **max\_size?**: `number` \| `null`

Defined in: [generated.ts:8577](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8577)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:8578](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8578)
