[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DicePoolAllocationEffect

# Interface: DicePoolAllocationEffect

Defined in: [generated.ts:841](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L841)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "dice-pool-allocation-effect".

## Indexable

> \[`k`: `string`\]: `unknown`

## Properties

### type

> **type**: `"dice-pool-allocation"`

Defined in: [generated.ts:842](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L842)

***

### pool

> **pool**: `object`

Defined in: [generated.ts:843](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L843)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### count

> **count**: `number`

#### die

> **die**: `string`

***

### max\_activations

> **max\_activations**: `number`

Defined in: [generated.ts:848](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L848)

***

### options

> **options**: \[\{\[`k`: `string`\]: `unknown`; `name`: `string`; `requirement`: \{\[`k`: `string`\]: `unknown`; `type`: `"pair"` \| `"triple"` \| `"single"` \| `"run"`; `min_value`: `number`; \}; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, ...\{ name: string; requirement: \{ type: "pair" \| "triple" \| "single" \| "run"; min\_value: number; \[k: string\]: unknown \}; effect: EffectNode; \[k: string\]: unknown \}\[\]\]

Defined in: [generated.ts:852](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L852)

#### Min Items

1
