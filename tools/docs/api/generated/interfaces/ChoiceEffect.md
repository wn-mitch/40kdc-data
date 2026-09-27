[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ChoiceEffect

# Interface: ChoiceEffect

Defined in: [generated.ts:2305](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2305)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "choice-effect".

## Indexable

> \[`k`: `string`\]: `unknown`

## Properties

### type

> **type**: `"choice"`

Defined in: [generated.ts:2306](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2306)

***

### options

> **options**: \[[`EffectNode`](../type-aliases/EffectNode.md), [`EffectNode`](../type-aliases/EffectNode.md), `...EffectNode[]`\]

Defined in: [generated.ts:2310](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2310)

#### Min Items

2

***

### choice\_label?

> `optional` **choice\_label?**: `string`

Defined in: [generated.ts:2311](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2311)

***

### choice\_prompt?

> `optional` **choice\_prompt?**: `string`

Defined in: [generated.ts:2312](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2312)

***

### min\_choices?

> `optional` **min\_choices?**: `number`

Defined in: [generated.ts:2316](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2316)

Minimum number of distinct options selected at this activation; defaults to one.

***

### max\_choices?

> `optional` **max\_choices?**: `number`

Defined in: [generated.ts:2320](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2320)

Maximum number of distinct options selected at this activation; defaults to one.
