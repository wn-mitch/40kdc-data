[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DiceTableEffect

# Interface: DiceTableEffect

Defined in: [generated.ts:4133](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4133)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "dice-table-effect".

## Properties

### type

> **type**: `"dice-table"`

Defined in: [generated.ts:4134](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4134)

***

### dice

> **dice**: `"D3"` \| `"D6"`

Defined in: [generated.ts:4138](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4138)

One closed die whose faces are covered exactly once by outcomes.

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:4142](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4142)

Roll this many dice and resolve each one on the table.

***

### distinct?

> `optional` **distinct?**: `true`

Defined in: [generated.ts:4146](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4146)

Each outcome applies at most once; a repeated result is re-rolled.

***

### outcomes

> **outcomes**: \[\{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, \{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ results: [number, ...number[]]; effect: EffectNode }[]`\]

Defined in: [generated.ts:4150](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4150)

#### Min Items

2
