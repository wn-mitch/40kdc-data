[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DiceTableEffect

# Interface: DiceTableEffect

Defined in: [generated.ts:3977](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3977)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "dice-table-effect".

## Properties

### type

> **type**: `"dice-table"`

Defined in: [generated.ts:3978](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3978)

***

### dice

> **dice**: `"D3"` \| `"D6"`

Defined in: [generated.ts:3982](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3982)

One closed die whose faces are covered exactly once by outcomes.

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:3986](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3986)

Roll this many dice and resolve each one on the table.

***

### distinct?

> `optional` **distinct?**: `true`

Defined in: [generated.ts:3990](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3990)

Each outcome applies at most once; a repeated result is re-rolled.

***

### outcomes

> **outcomes**: \[\{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, \{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ results: [number, ...number[]]; effect: EffectNode }[]`\]

Defined in: [generated.ts:3994](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3994)

#### Min Items

2
