[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AuraEffect

# Interface: AuraEffect

Defined in: [generated.ts:2795](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2795)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "aura-effect".

## Properties

### type

> **type**: `"aura"`

Defined in: [generated.ts:2796](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2796)

***

### target

> **target**: `"friendly-within-aura"` \| `"enemy-within-aura"`

Defined in: [generated.ts:2797](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2797)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:2798](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2798)

#### range?

> `optional` **range?**: `number` \| \[`number`, `...number[]`\]

#### range\_bonus?

> `optional` **range\_bonus?**: `number`

#### of?

> `optional` **of?**: `string`

#### effect?

> `optional` **effect?**: [`EffectNode`](../type-aliases/EffectNode.md)

#### eligible?

> `optional` **eligible?**: `object`

##### eligible.required\_keywords?

> `optional` **required\_keywords?**: \[`string`, `...string[]`\]

###### Min Items

1

##### eligible.excluded\_keywords?

> `optional` **excluded\_keywords?**: \[`string`, `...string[]`\]

###### Min Items

1

#### emitter\_filter?

> `optional` **emitter\_filter?**: [`KeywordFilter`](KeywordFilter.md)

#### recipient\_filter?

> `optional` **recipient\_filter?**: [`KeywordFilter`](KeywordFilter.md)
