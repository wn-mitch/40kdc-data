[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StanceSelectEffect

# Interface: StanceSelectEffect

Defined in: [generated.ts:3768](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3768)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stance-select-effect".

## Properties

### type

> **type**: `"stance-select"`

Defined in: [generated.ts:3769](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3769)

***

### mode

> **mode**: `"re-selectable"` \| `"consumable"`

Defined in: [generated.ts:3770](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3770)

***

### additive?

> `optional` **additive?**: `true`

Defined in: [generated.ts:3771](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3771)

***

### options

> **options**: \[\{ `id`: `string`; `name`: `string`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, \{ `id`: `string`; `name`: `string`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ id: string; name: string; effect: EffectNode }[]`\]

Defined in: [generated.ts:3775](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3775)

#### Min Items

2

***

### min\_choices?

> `optional` **min\_choices?**: `number`

Defined in: [generated.ts:3792](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3792)

***

### max\_choices?

> `optional` **max\_choices?**: `number`

Defined in: [generated.ts:3793](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3793)

***

### initial?

> `optional` **initial?**: `string`

Defined in: [generated.ts:3797](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3797)

The id of the option in force from the start of the battle, before any selection ("At the start of the battle, that unit enters Aegis Protocol").
