[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ChoiceEffect

# Interface: ChoiceEffect

Defined in: [generated.ts:3832](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3832)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "choice-effect".

## Properties

### type

> **type**: `"choice"`

Defined in: [generated.ts:3833](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3833)

***

### options

> **options**: \[[`EffectNode`](../type-aliases/EffectNode.md), [`EffectNode`](../type-aliases/EffectNode.md), `...EffectNode[]`\]

Defined in: [generated.ts:3837](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3837)

#### Min Items

2

***

### choice\_label?

> `optional` **choice\_label?**: `string`

Defined in: [generated.ts:3838](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3838)

***

### choice\_prompt?

> `optional` **choice\_prompt?**: `string`

Defined in: [generated.ts:3839](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3839)

***

### min\_choices?

> `optional` **min\_choices?**: `number`

Defined in: [generated.ts:3843](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3843)

Minimum number of distinct options selected at this activation; defaults to one.

***

### max\_choices?

> `optional` **max\_choices?**: `number`

Defined in: [generated.ts:3847](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3847)

Maximum number of distinct options selected at this activation; defaults to one.
