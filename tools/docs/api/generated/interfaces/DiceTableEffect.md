[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DiceTableEffect

# Interface: DiceTableEffect

Defined in: [generated.ts:3621](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3621)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "dice-table-effect".

## Properties

### type

> **type**: `"dice-table"`

Defined in: [generated.ts:3622](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3622)

***

### dice

> **dice**: `"D3"` \| `"D6"`

Defined in: [generated.ts:3626](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3626)

One closed die whose faces are covered exactly once by outcomes.

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:3630](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3630)

Roll this many dice and resolve each one on the table.

***

### distinct?

> `optional` **distinct?**: `true`

Defined in: [generated.ts:3634](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3634)

Each outcome applies at most once; a repeated result is re-rolled.

***

### outcomes

> **outcomes**: \[\{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, \{ `results`: \[`number`, `...number[]`\]; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ results: [number, ...number[]]; effect: EffectNode }[]`\]

Defined in: [generated.ts:3638](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3638)

#### Min Items

2
