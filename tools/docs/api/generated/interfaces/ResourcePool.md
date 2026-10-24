[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourcePool

# Interface: ResourcePool

Defined in: [generated.ts:7311](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7311)

A faction's resource system (Miracle Dice, Pain tokens, Blessings dice pool, etc.).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "resource-pool".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:7312](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7312)

***

### name

> **name**: `string`

Defined in: [generated.ts:7313](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7313)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:7314](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7314)

***

### pool\_type

> **pool\_type**: `"token"` \| `"dice-pool"` \| `"counter"`

Defined in: [generated.ts:7315](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7315)

***

### generation?

> `optional` **generation?**: `object`[]

Defined in: [generated.ts:7316](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7316)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### condition

> **condition**: [`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md)

#### amount

> **amount**: [`StatValue`](../type-aliases/StatValue.md)

***

### max\_size?

> `optional` **max\_size?**: `number` \| `null`

Defined in: [generated.ts:7321](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7321)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7322](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7322)
