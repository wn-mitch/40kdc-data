[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ChoiceEffect

# Interface: ChoiceEffect

Defined in: [generated.ts:3477](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3477)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "choice-effect".

## Properties

### type

> **type**: `"choice"`

Defined in: [generated.ts:3478](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3478)

***

### options

> **options**: \[[`EffectNode`](../type-aliases/EffectNode.md), [`EffectNode`](../type-aliases/EffectNode.md), `...EffectNode[]`\]

Defined in: [generated.ts:3482](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3482)

#### Min Items

2

***

### choice\_label?

> `optional` **choice\_label?**: `string`

Defined in: [generated.ts:3483](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3483)

***

### choice\_prompt?

> `optional` **choice\_prompt?**: `string`

Defined in: [generated.ts:3484](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3484)

***

### min\_choices?

> `optional` **min\_choices?**: `number`

Defined in: [generated.ts:3488](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3488)

Minimum number of distinct options selected at this activation; defaults to one.

***

### max\_choices?

> `optional` **max\_choices?**: `number`

Defined in: [generated.ts:3492](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3492)

Maximum number of distinct options selected at this activation; defaults to one.
