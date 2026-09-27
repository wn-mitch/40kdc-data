[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DiceTableEffect

# Interface: DiceTableEffect

Defined in: [generated.ts:2544](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2544)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "dice-table-effect".

## Properties

### type

> **type**: `"dice-table"`

Defined in: [generated.ts:2545](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2545)

***

### dice

> **dice**: `"D3"` \| `"D6"`

Defined in: [generated.ts:2549](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2549)

One closed die whose faces are covered exactly once by outcomes.

***

### outcomes

> **outcomes**: \[\{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, \{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ results: [number, ...number[]]; effect: EffectNode }[]`\]

Defined in: [generated.ts:2553](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2553)

#### Min Items

2
