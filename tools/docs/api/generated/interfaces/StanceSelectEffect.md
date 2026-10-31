[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StanceSelectEffect

# Interface: StanceSelectEffect

Defined in: [generated.ts:3899](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3899)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stance-select-effect".

## Properties

### type

> **type**: `"stance-select"`

Defined in: [generated.ts:3900](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3900)

***

### mode

> **mode**: `"re-selectable"` \| `"consumable"`

Defined in: [generated.ts:3901](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3901)

***

### additive?

> `optional` **additive?**: `true`

Defined in: [generated.ts:3902](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3902)

***

### options

> **options**: \[\{ `id`: `string`; `name`: `string`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, \{ `id`: `string`; `name`: `string`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ id: string; name: string; effect: EffectNode }[]`\]

Defined in: [generated.ts:3906](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3906)

#### Min Items

2

***

### min\_choices?

> `optional` **min\_choices?**: `number`

Defined in: [generated.ts:3923](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3923)

***

### max\_choices?

> `optional` **max\_choices?**: `number`

Defined in: [generated.ts:3924](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3924)

***

### initial?

> `optional` **initial?**: `string`

Defined in: [generated.ts:3928](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3928)

The id of the option in force from the start of the battle, before any selection ("At the start of the battle, that unit enters Aegis Protocol").

***

### or\_random?

> `optional` **or\_random?**: `object`

Defined in: [generated.ts:3932](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3932)

The pick may instead be rolled ("or randomly select two … by rolling two D6"): count dice, each result applying the option whose id faces lists at that number (faces[0] is a 1). A rolled option already active has no additional effect.

#### dice

> **dice**: `"D3"` \| `"D6"`

#### count

> **count**: `number`

#### faces

> **faces**: \[`string`, `string`, `string`\] \| \[`string`, `string`, `string`, `string`\] \| \[`string`, `string`, `string`, `string`, `string`\] \| \[`string`, `string`, `string`, `string`, `string`, `string`\]

##### Min Items

3

##### Max Items

6
